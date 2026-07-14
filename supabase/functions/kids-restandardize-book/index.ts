// One-shot: re-render an existing legacy-format kids book to the 8.5×8.5
// (612×612 pt) standard using the EXISTING cover + interior art + manuscript.
// Owner order (2026-07-14): "ภาพทุกอย่างดีแล้ว แค่ re-dimension" — no regen of
// content, only re-splice at the standard trim so every page is full-bleed
// picture-book at the store standard, and clear the legacy_format flag.
//
// Body: { ebook_id: string }
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  buildPicturePdf,
  splitManuscriptForSpreads,
} from '../_shared/kids-picture-pdf.ts';
import {
  uploadAndSignImage,
  versionedKidsAssetPath,
  IMAGE_SIGNED_TTL_SECONDS,
} from '../_shared/versioned-assets.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function dl(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status} for ${url.slice(0, 80)}`);
  return new Uint8Array(await r.arrayBuffer());
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { ebook_id } = await req.json();
    if (!ebook_id) return json({ error: 'ebook_id required' }, 400);

    const db = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: book, error } = await db.from('ebooks_kids')
      .select('id, title, subtitle, cover_url, interior_illustrations, manuscript_md, storefront_meta')
      .eq('id', ebook_id).maybeSingle();
    if (error || !book) return json({ error: `book not found: ${error?.message}` }, 404);

    const illustrations = Array.isArray(book.interior_illustrations)
      ? (book.interior_illustrations as any[]).slice().sort(
          (a, b) => (a.page_number ?? a.index ?? 0) - (b.page_number ?? b.index ?? 0),
        )
      : [];
    if (illustrations.length === 0) return json({ error: 'no interior illustrations' }, 400);

    const coverBytes = await dl(book.cover_url!);
    const spreadImgs: Uint8Array[] = [];
    for (const it of illustrations) {
      const url = it?.url;
      if (!url) throw new Error(`page ${it?.page_number} missing url`);
      spreadImgs.push(await dl(url));
    }

    const captions = splitManuscriptForSpreads(book.manuscript_md ?? '', illustrations.length);
    const spreads = spreadImgs.map((imagePng, i) => ({
      caption: captions[i] ?? '',
      imagePng,
    }));

    const pdfBytes = await buildPicturePdf({
      title: book.title,
      subtitle: book.subtitle ?? null,
      coverPng: coverBytes,
      spreads,
    });

    // Upload versioned PDF
    const path = versionedKidsAssetPath(ebook_id, 'book-restandardized', 'pdf');
    const up = await db.storage.from('ebook-pdfs').upload(path, pdfBytes, {
      contentType: 'application/pdf', upsert: false,
    });
    if (up.error) throw up.error;
    const { data: signed, error: signErr } = await db.storage
      .from('ebook-pdfs').createSignedUrl(path, IMAGE_SIGNED_TTL_SECONDS);
    if (signErr || !signed?.signedUrl) throw new Error(`sign: ${signErr?.message}`);

    // Build preview_pairs (6 spreads, image + text)
    const previewPairs = illustrations.slice(0, 6).map((it: any, i: number) => ({
      page: (it.page_number ?? i + 3) as number,
      image_url: it.url as string,
      text: captions[i] ?? '',
    }));

    const meta = (book.storefront_meta ?? {}) as Record<string, unknown>;
    meta.legacy_format = false;
    meta.restandardized_at = new Date().toISOString();
    meta.preview_pairs = previewPairs;

    const { error: upErr } = await db.from('ebooks_kids').update({
      pdf_url: signed.signedUrl,
      storefront_meta: meta,
      page_count: illustrations.length + 4, // cover+title+copyright + N + closing
    }).eq('id', ebook_id);
    if (upErr) throw upErr;

    return json({
      ok: true,
      ebook_id,
      pdf_url: signed.signedUrl,
      pages_rendered: illustrations.length,
      preview_pairs_count: previewPairs.length,
    });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
