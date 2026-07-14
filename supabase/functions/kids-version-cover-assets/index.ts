import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  storagePathFromUrl,
  uploadAndSignImage,
  versionedKidsAssetPath,
} from '../_shared/versioned-assets.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

type Result = {
  ebook_id: string;
  title?: string | null;
  source_path: string;
  cover_path: string;
  bytes: number;
  cover_url: string;
  thumbnail_url: string;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    const body = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body.ebook_ids)
      ? body.ebook_ids.filter((x: unknown): x is string => typeof x === 'string' && x.length > 8)
      : (typeof body.ebook_id === 'string' ? [body.ebook_id] : []);
    if (ids.length === 0) return json({ ok: false, error: 'ebook_id or ebook_ids required' }, 400);

    const results: Result[] = [];
    for (const ebookId of ids) {
      const { data: ebook, error: ebookErr } = await db
        .from('ebooks_kids')
        .select('id,title,cover_url,thumbnail_url')
        .eq('id', ebookId)
        .single();
      if (ebookErr || !ebook) throw new Error(`ebook not found: ${ebookId}`);

      const sourcePath = storagePathFromUrl(ebook.cover_url as string | null, 'ebook-covers')
        ?? `kids/${ebookId}/cover.png`;
      const dl = await db.storage.from('ebook-covers').download(sourcePath);
      if (dl.error || !dl.data) throw new Error(`download failed for ${ebookId}: ${dl.error?.message ?? 'not found'}`);
      const bytes = new Uint8Array(await dl.data.arrayBuffer());
      if (bytes.length < 30_000) throw new Error(`cover source too small for ${ebookId}: ${bytes.length} bytes`);

      const coverPath = versionedKidsAssetPath(ebookId, 'cover');
      const signed = await uploadAndSignImage(db, 'ebook-covers', coverPath, bytes);
      await db.from('ebooks_kids').update({
        cover_url: signed.signedUrl,
        thumbnail_url: signed.signedUrl,
        updated_at: new Date().toISOString(),
      }).eq('id', ebookId);

      results.push({
        ebook_id: ebookId,
        title: ebook.title as string | null,
        source_path: sourcePath,
        cover_path: coverPath,
        bytes: bytes.length,
        cover_url: signed.signedUrl,
        thumbnail_url: signed.signedUrl,
      });
    }

    return json({ ok: true, results });
  } catch (e) {
    console.error('kids-version-cover-assets error', e);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}