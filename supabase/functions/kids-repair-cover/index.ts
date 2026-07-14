// Kids cover title repair.
// 1. Generate a fresh TEXTLESS cover master via Fal (extra-strict no-text prompt).
// 2. Composite the exact title + subtitle deterministically via Browserless.
// 3. Upload both master and composed final; update bibles and ebook.
//
// Never bakes text via the AI — title spelling is now guaranteed by HTML/CSS.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { falRecraftV3 } from '../_shared/fal.ts';
import { composeCoverTitle } from '../_shared/cover-title-overlay.ts';
import { uploadAndSignImage, versionedKidsAssetPath } from '../_shared/versioned-assets.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    const { ebook_id, regenerate_master = true } = await req.json();
    if (!ebook_id) return json({ ok: false, error: 'ebook_id required' }, 400);

    const { data: eb } = await db.from('ebooks_kids').select('*').eq('id', ebook_id).single();
    if (!eb) return json({ ok: false, error: 'ebook not found' }, 404);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: bible } = await (db.from('kids_book_bibles') as any).select('*').eq('ebook_id', ebook_id).maybeSingle();

    const cb = (bible?.character_bible_json ?? {}) as Record<string, string>;
    const charDesc = [
      cb.name && `named ${cb.name}`,
      cb.species && `(${cb.species})`,
      cb.hair && `${cb.hair} hair`,
      cb.eyes && `${cb.eyes} eyes`,
      cb.skin && `${cb.skin} skin`,
      cb.outfit && `wearing ${cb.outfit}`,
      cb.accessory && `with ${cb.accessory}`,
    ].filter(Boolean).join(', ');

    // ----- Step 1: textless master (Recraft caps prompt at 1000 chars) -----
    let masterUrl: string | null = bible?.cover_master_url ?? null;
    if (regenerate_master || !masterUrl) {
      const hero = charDesc || 'a friendly child in cozy pajamas';
      const heroShort = hero.length > 300 ? hero.slice(0, 300) : hero;
      const masterPrompt = [
        `Whimsical illustrated children's picture book cover artwork — full-bleed background scene only.`,
        `Hero: ${heroShort}.`,
        `Warm painterly storybook illustration, soft golden lighting, cozy atmosphere, rich background, expressive character face.`,
        `Portrait orientation. Reserve the top 25% as calm sky so a title can be added later.`,
        `Textless artwork only — no letters, no words, no title, no signage, no writing anywhere.`,
      ].join(' ').slice(0, 990);
      const masterBytes = await falRecraftV3({
        prompt: masterPrompt,
        image_size: 'portrait_4_3',
        negative_prompt: 'text, letters, numbers, words, title, subtitle, typography, watermark, logo, signature, caption, book, sign, writing, speech bubble, calligraphy, gibberish, garbled text, deformed hands, six fingers, extra fingers, stock photo, glossy 3d blob',
      });
      const masterPath = versionedKidsAssetPath(ebook_id, 'cover-master');
      const signed = await uploadAndSignImage(db, 'ebook-covers', masterPath, masterBytes);
      masterUrl = signed.signedUrl;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db.from('kids_book_bibles') as any).update({ cover_master_url: masterUrl }).eq('ebook_id', ebook_id);
    }

    if (!masterUrl) throw new Error('no cover master URL after upload');

    // ----- Step 2: deterministic title overlay -----
    const composed = await composeCoverTitle({
      coverImageUrl: masterUrl,
      title: eb.title as string,
      subtitle: (eb.subtitle as string | null) ?? null,
      width: 800,
      height: 1200,
      titlePosition: 'top',
    });
    const finalPath = versionedKidsAssetPath(ebook_id, 'cover');
    const finalSigned = await uploadAndSignImage(db, 'ebook-covers', finalPath, composed);

    await db.from('ebooks_kids').update({
      cover_url: finalSigned.signedUrl,
      thumbnail_url: finalSigned.signedUrl,
    }).eq('id', ebook_id);

    return json({
      ok: true,
      ebook_id,
      cover_master_url: masterUrl,
      cover_url: finalSigned.signedUrl,
      regenerated_master: regenerate_master,
    });
  } catch (e) {
    console.error('kids-repair-cover error', e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
