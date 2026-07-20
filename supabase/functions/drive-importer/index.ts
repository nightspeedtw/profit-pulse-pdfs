import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const GATEWAY = 'https://connector-gateway.lovable.dev/google_drive/drive/v3';
const LOVABLE_KEY = Deno.env.get('LOVABLE_API_KEY')!;
const DRIVE_KEY = Deno.env.get('GOOGLE_DRIVE_API_KEY')!;
const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SUPA_SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function driveHeaders() {
  return {
    Authorization: `Bearer ${LOVABLE_KEY}`,
    'X-Connection-Api-Key': DRIVE_KEY,
  };
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/\.pdf$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `pdf-${Date.now()}`;
}

function categorize(folderName: string | null | undefined): 'coloring' | 'storybook' | null {
  const n = (folderName || '').toLowerCase();
  if (n.includes('color')) return 'coloring';
  if (n.includes('story') || n.includes('tale')) return 'storybook';
  return null;
}

function prettyTitle(fileName: string): string {
  return fileName
    .replace(/\.pdf$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\bPREMIUM\b|\bMatter Design( V\d+)?\b|\b\d+\.?\d*x\d+\.?\d*\b|\bV\d+\b|\bGraphic Novel\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim() || 'Untitled';
}

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  parents?: string[];
};

async function listFolder(folderId: string): Promise<DriveFile[]> {
  const all: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${GATEWAY}/files`);
    url.searchParams.set('q', `'${folderId}' in parents and trashed=false`);
    url.searchParams.set(
      'fields',
      'nextPageToken, files(id,name,mimeType,modifiedTime,size,parents)',
    );
    url.searchParams.set('pageSize', '200');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const r = await fetch(url, { headers: driveHeaders() });
    if (!r.ok) throw new Error(`drive list ${folderId}: ${r.status} ${await r.text()}`);
    const j = await r.json();
    all.push(...(j.files || []));
    pageToken = j.nextPageToken;
  } while (pageToken);
  return all;
}

async function getFolderName(folderId: string): Promise<string> {
  const r = await fetch(`${GATEWAY}/files/${folderId}?fields=name`, { headers: driveHeaders() });
  if (!r.ok) return '';
  return (await r.json()).name || '';
}

async function downloadPdf(fileId: string): Promise<Uint8Array> {
  const r = await fetch(`${GATEWAY}/files/${fileId}?alt=media`, { headers: driveHeaders() });
  if (!r.ok) throw new Error(`drive download ${fileId}: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supa = createClient(SUPA_URL, SUPA_SVC);
  const summary = { scanned: 0, imported: 0, updated: 0, skipped: 0, errors: [] as string[] };

  try {
    const { data: cfg, error: cfgErr } = await supa
      .from('drive_import_config')
      .select('*')
      .eq('id', true)
      .maybeSingle();
    if (cfgErr) throw cfgErr;
    if (!cfg || !cfg.enabled) {
      return new Response(JSON.stringify({ ok: false, reason: 'disabled' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Recursive walk. Each queue entry carries the category inherited from
    // the nearest ancestor whose name matched a category keyword — so a PDF
    // inside "coloring book/subfolder/foo.pdf" is still tagged 'coloring'.
    const rootName = await getFolderName(cfg.root_folder_id);
    const queue: { id: string; name: string; category: 'coloring' | 'storybook' | null }[] = [
      { id: cfg.root_folder_id, name: rootName, category: categorize(rootName) },
    ];
    const pdfs: { file: DriveFile; parentName: string; category: 'coloring' | 'storybook' }[] = [];

    while (queue.length) {
      const cur = queue.shift()!;
      const children = await listFolder(cur.id);
      for (const c of children) {
        if (c.mimeType === 'application/vnd.google-apps.folder') {
          const childCat = categorize(c.name) ?? cur.category;
          queue.push({ id: c.id, name: c.name, category: childCat });
        } else if (c.mimeType === 'application/pdf') {
          pdfs.push({
            file: c,
            parentName: cur.name,
            category: cur.category ?? categorize(cur.name) ?? 'storybook',
          });
        }
      }
    }
    summary.scanned = pdfs.length;

    for (const { file, parentName, category } of pdfs) {
      try {
        const { data: existing } = await supa
          .from('drive_products')
          .select('id, drive_modified_time, sha256')
          .eq('drive_file_id', file.id)
          .maybeSingle();

        if (existing && existing.drive_modified_time === file.modifiedTime) {
          summary.skipped++;
          continue;
        }

        const bytes = await downloadPdf(file.id);
        const hash = await sha256(bytes);
        if (existing && existing.sha256 === hash) {
          await supa
            .from('drive_products')
            .update({ drive_modified_time: file.modifiedTime })
            .eq('id', existing.id);
          summary.skipped++;
          continue;
        }

        const storagePath = `drive/${file.id}.pdf`;
        const { error: upErr } = await supa.storage
          .from('ebook-pdfs')
          .upload(storagePath, bytes, { contentType: 'application/pdf', upsert: true });
        if (upErr) throw upErr;

        const { data: signed } = await supa.storage
          .from('ebook-pdfs')
          .createSignedUrl(storagePath, 60 * 60 * 24 * 365 * 5);

        const title = file.name.replace(/\.pdf$/i, '').trim() || 'Untitled';
        const baseSlug = slugify(file.name);
        const category = categorize(parentName);

        const row = {
          drive_file_id: file.id,
          drive_modified_time: file.modifiedTime,
          drive_parent_folder_id: file.parents?.[0] ?? null,
          drive_parent_folder_name: parentName,
          category,
          title,
          slug: existing ? undefined : `${baseSlug}-${file.id.slice(0, 6)}`,
          price_cents: cfg.default_price_cents,
          pdf_url: signed?.signedUrl ?? null,
          pdf_storage_path: storagePath,
          file_size_bytes: file.size ? Number(file.size) : bytes.length,
          sha256: hash,
          status: 'live',
          import_error: null,
        };

        if (existing) {
          await supa.from('drive_products').update(row).eq('id', existing.id);
          summary.updated++;
        } else {
          await supa.from('drive_products').insert(row);
          summary.imported++;
        }
      } catch (e) {
        const msg = `${file.name}: ${e instanceof Error ? e.message : String(e)}`;
        summary.errors.push(msg);
        console.error('[drive-importer]', msg);
      }
    }

    await supa
      .from('drive_import_config')
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: summary.errors.length ? 'partial' : 'ok',
        last_sync_message: JSON.stringify(summary).slice(0, 800),
      })
      .eq('id', true);

    return new Response(JSON.stringify({ ok: true, ...summary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[drive-importer] fatal', msg);
    await supa
      .from('drive_import_config')
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: 'error',
        last_sync_message: msg.slice(0, 800),
      })
      .eq('id', true);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
