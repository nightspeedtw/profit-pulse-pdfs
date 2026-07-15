// One-shot cover repair that PINS the actual interior pages as character +
// style reference, so the cover shows the SAME kid drawn in the SAME style
// as the story. Bakes the title INTO the artwork (hand-lettered) — no SVG
// overlay, so there can never be double-text. Then splices the new cover
// as PDF page 1 (leaves interior pages intact).
//
// Owner order (2026-07-14): fix "The Sneeze-Powered Sock Sorter" cover and
// enshrine "cover generated from interior reference" as a permanent skill.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { PDFDocument, rgb } from 'npm:pdf-lib@1.17.1';
import { geminiDirectImageWithMeta, hasGeminiDirect } from '../_shared/gemini-direct.ts';
import { qcCoverLettering } from '../_shared/qc/kids-cover-lettering-qc.ts';
import { uploadAndSignImage, versionedKidsAssetPath, storagePathFromUrl, IMAGE_SIGNED_TTL_SECONDS } from '../_shared/versioned-assets.ts';
import { generateLiveImage } from '../_shared/image-luminance.ts';
import { renderKidsTitleTreatment } from '../_shared/covers/kids-title-treatment.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function signPath(db: ReturnType<typeof createClient>, bucket: string, path: string): Promise<string> {
  const { data, error } = await db.storage.from(bucket).createSignedUrl(path, IMAGE_SIGNED_TTL_SECONDS);
  if (error || !data?.signedUrl) throw new Error(`sign ${path}: ${error?.message ?? 'no url'}`);
  return data.signedUrl;
}

async function downloadBytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

async function transcribeAllText(imageBytes: Uint8Array): Promise<string> {
  const key = Deno.env.get('LOVABLE_API_KEY');
  if (!key) return '';
  let s = ''; const c = 0x8000;
  for (let i = 0; i < imageBytes.length; i += c) s += String.fromCharCode(...imageBytes.subarray(i, i + c));
  const dataUrl = `data:image/png;base64,${btoa(s)}`;
  try {
    const r = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'Transcribe EVERY piece of text, letter, word, label, signage, and lettering visible anywhere in the image. Include in-scene labels, basket tags, onomatopoeia, signs, everything. Return one plain string of all detected text, space-separated. No JSON, no explanation.' },
          { role: 'user', content: [
            { type: 'text', text: 'List every text element in this image.' },
            { type: 'image_url', image_url: { url: dataUrl } },
          ] },
        ],
        max_tokens: 300,
      }),
    });
    if (!r.ok) return '';
    const j = await r.json();
    return String(j.choices?.[0]?.message?.content ?? '').trim();
  } catch { return ''; }
}


async function gatewayImageWithRefs(opts: { prompt: string; referenceUrls: string[] }): Promise<Uint8Array> {
  const key = Deno.env.get('LOVABLE_API_KEY');
  if (!key) throw new Error('LOVABLE_API_KEY missing');
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: opts.prompt }];
  for (const u of opts.referenceUrls) content.push({ type: 'image_url', image_url: { url: u } });
  const r = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'google/gemini-3.1-flash-image',
      messages: [{ role: 'user', content }],
      modalities: ['image', 'text'],
    }),
  });
  if (!r.ok) throw new Error(`gateway ${r.status}: ${(await r.text()).slice(0, 400)}`);
  const j = await r.json() as {
    choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string } }> } }>;
  };
  const url = j.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) throw new Error(`gateway: no image in response: ${JSON.stringify(j).slice(0, 300)}`);
  if (url.startsWith('data:')) {
    const b64 = url.split(',')[1] ?? '';
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  }
  const dl = await fetch(url);
  return new Uint8Array(await dl.arrayBuffer());
}

interface RepairOpts {
  ebook_id: string;
  max_attempts?: number;
  splice_pdf?: boolean;
  hero_moment_override?: string; // owner directive: e.g. "Pip centered, holding magnifying glass and detective bag"
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    const { ebook_id, max_attempts = 3, splice_pdf = true, hero_moment_override } = (await req.json()) as RepairOpts;
    if (!ebook_id) return json({ ok: false, error: 'ebook_id required' }, 400);
    if (!hasGeminiDirect()) return json({ ok: false, error: 'GEMINI_API_KEY required for reference-conditioned generation' }, 500);

    const { data: eb, error: ebErr } = await db.from('ebooks_kids').select('*').eq('id', ebook_id).single();
    if (ebErr || !eb) return json({ ok: false, error: 'ebook not found' }, 404);

    const title = String(eb.title ?? '').trim();
    const subtitle = String(eb.subtitle ?? '').trim();
    const illos = Array.isArray(eb.interior_illustrations) ? eb.interior_illustrations as Array<{ path: string; prompt?: string }> : [];
    if (illos.length === 0) return json({ ok: false, error: 'no interior_illustrations to reference' }, 400);

    // ── Pin FIRST 2 interior pages as character + style reference ──
    const refPaths = illos.slice(0, 2).map((i) => i.path).filter(Boolean);
    const refUrls: string[] = [];
    for (const p of refPaths) refUrls.push(await signPath(db, 'ebook-covers', p));

    // Derive character description from the first interior prompt (if present) —
    // the reference IMAGE is authoritative, this is belt-and-suspenders text.
    const firstPrompt = String(illos[0]?.prompt ?? '');
    const charDesc = (() => {
      // Extract "named X, ... perched..." blob if present.
      const m = firstPrompt.match(/named[^.]*perched[^.]*\./i) ?? firstPrompt.match(/Hero character[^.]*\./i);
      return (m?.[0] ?? '').slice(0, 500);
    })();

    // Derive the joyful hero moment from the actual concept brief (or accept
    // an owner override). Never hardcode a scene from a different book.
    const conceptBrief = ((eb.storefront_meta as Record<string, unknown> | null)?.concept_brief
      ?? (eb.storefront_meta as Record<string, unknown> | null)?.locked_concept
      ?? {}) as Record<string, unknown>;
    const heroName = String(conceptBrief.hero ?? conceptBrief.hero_name ?? 'the hero').trim();
    const heroMoment = String(
      hero_moment_override
        ?? conceptBrief.cover_hero_moment
        ?? conceptBrief.final_page_payoff
        ?? `${heroName} centered/upper-middle in a joyful key moment from the story, story-defining prop or object in-hand`,
    ).trim();

    const basePrompt = [
      `Whimsical children's picture-book cover artwork, SQUARE 1:1 format.`,
      `Use the two attached interior illustrations as the DEFINITIVE reference for the hero character's identity (face, skin, hair, glasses, freckles, outfit, proportions) AND for the overall art style (line quality, palette, lighting, texture). The cover MUST show the SAME hero drawn in the SAME style — no restyling, no different character, no species drift.`,
      charDesc ? `Character notes: ${charDesc}` : ``,
      `Composition: ${heroMoment}. Warm painterly lighting, generous space in the upper third for the title.`,
      `TYPOGRAPHY (must be drawn INTO the artwork as hand-lettered painted title): the ONLY text visible on the cover is the exact title "${title}"${subtitle ? ` and the subtitle "${subtitle}" underneath in a smaller hand-lettered style` : ''}. The lettering must be chunky, playful, bouncy baseline, watercolor-style, sitting in the upper third with clear readability armor (soft outline or shadow) so it survives at 100×160 thumbnail size.`,
      `ABSOLUTE RULES: (1) The ONLY text anywhere on the entire canvas is the title${subtitle ? ' + subtitle' : ''} above. Do NOT draw any in-scene labels, basket tags, sign text, box labels, onomatopoeia, speech bubbles, tag-lines, author lines, publisher marks, badges, or signatures. If a container appears in the scene, it must be UNLABELED. (2) Spell the title EXACTLY: "${title}". (3) No glossy 3D, no stock photo, no six-finger hands, no generic purple gradient. (4) Square 1:1 aspect ratio.`,
    ].filter(Boolean).join(' ');

    let lastReason = '';
    let bestBytes: Uint8Array | null = null;
    let bestReport: unknown = null;
    let usedRenderer: 'baked-lettering@1' | 'kids-title-treatment@1' = 'baked-lettering@1';
    let titleTreatmentMeta: Record<string, unknown> | null = null;

    for (let attempt = 1; attempt <= max_attempts; attempt++) {
      let bytes: Uint8Array;
      const prompt = basePrompt + (attempt > 1 ? ` (Previous attempt failed: ${lastReason} — fix that specifically.)` : '');
      try {
        const live = await generateLiveImage({
          label: 'cover_from_interior',
          attempts: 3,
          gen: async (inner) => {
            const jitter = inner === 1
              ? ''
              : inner === 2
                ? ' Slight variation: shift lighting warmer and pose energy higher.'
                : ' Retry with a fresh composition: different camera angle, brighter palette.';
            const refs = inner === 2 && refUrls.length > 1
              ? [...refUrls].reverse()
              : refUrls;
            const seed = 1000 * attempt + inner * 37;
            try {
              const { bytes: b, meta } = await geminiDirectImageWithMeta({
                prompt: prompt + jitter,
                referenceUrls: refs,
                model: 'google/gemini-3.1-flash-image',
                seed,
              });
              return { bytes: b, meta };
            } catch (direct) {
              console.warn(`gemini-direct failed (${(direct as Error).message.slice(0, 120)}) — falling back to gateway`);
              const b = await gatewayImageWithRefs({ prompt: prompt + jitter, referenceUrls: refs });
              return { bytes: b, meta: { provider: 'google_direct', model: 'google/gemini-3.1-flash-image', partCount: 1, bytesLen: b.length, finishReason: 'gateway_fallback', safetyRatings: null } };
            }
          },
        });
        bytes = live.bytes;
      } catch (e) {
        lastReason = (e as Error).message.slice(0, 400);
        console.error(`attempt ${attempt} gen/dead-image error`, lastReason);
        if (attempt === max_attempts) break; // fall through to composite fallback
        continue;
      }

      const qc = await qcCoverLettering({ expectedTitle: title, imageBytes: bytes });
      const detected = String(qc.detected_title_text ?? '').trim();
      const titleNorm = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
      const subNorm = subtitle.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
      const allowed = new Set((titleNorm + ' ' + subNorm).split(' ').filter((w) => w.length >= 3));
      const allText = await transcribeAllText(bytes);
      const allTokens = allText.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter((w) => w.length >= 3);
      const extraWords = Array.from(new Set(allTokens.filter((w) => !allowed.has(w))));
      const extraneous = extraWords.length > 0;

      const passReport = {
        attempt, qc, detected,
        luminance: { note: 'live_verified_at_birth' },
        all_text_detected: allText,
        extraneous_words: extraWords,
      };
      bestReport = passReport;
      bestBytes = bytes;

      if (qc.passed && !extraneous) {
        console.log('cover repaired attempt', attempt, 'title=', detected);
        // Persist title_treatment metadata so the downstream KIDS_TITLE_TREATMENT_INVALID
        // gate can verify title spelling. The renderer is "baked-lettering@1"
        // (title drawn into the AI artwork rather than SVG overlay).
        titleTreatmentMeta = {
          title,
          subtitle: subtitle || null,
          lines: [title],
          renderer: 'baked-lettering@1',
          rendered_at: new Date().toISOString(),
          source: 'interior_reference_v1',
          detected_title_text: detected,
        };
        break;
      }
      lastReason = qc.reasons.concat(extraneous ? [`extraneous_text:${extraWords.slice(0, 3).join(',')}`] : []).join('; ') || 'unknown';
    }

    // ── GUARANTEED COMPOSITE FALLBACK ──
    // If baked-lettering QC failed on all attempts (or generation failed),
    // switch to the text-free character master + SVG title overlay path.
    // This CANNOT misspell (SVG is exact glyphs) and produces valid
    // title_treatment metadata. A book must never retire on title typography.
    if (!titleTreatmentMeta) {
      console.warn(`baked-lettering failed after ${max_attempts} attempts — switching to composite fallback`);
      try {
        const textFreePrompt = [
          `Whimsical children's picture-book cover artwork, SQUARE 1:1 format.`,
          `Use the two attached interior illustrations as the DEFINITIVE reference for the hero character's identity AND for the overall art style.`,
          charDesc ? `Character notes: ${charDesc}` : ``,
          `Composition: ${heroMoment}. Warm painterly lighting.`,
          `CRITICAL: The cover MUST be COMPLETELY TEXT-FREE. Do NOT draw ANY letters, words, title, subtitle, labels, signs, tags, badges, onomatopoeia, or writing of any kind anywhere on the canvas. Reserve the upper third as clean sky/space for a title to be composited on top later. Square 1:1.`,
        ].filter(Boolean).join(' ');
        const live = await generateLiveImage({
          label: 'cover_textfree_fallback',
          attempts: 3,
          gen: async (inner) => {
            const seed = 9000 + inner * 41;
            try {
              const { bytes: b, meta } = await geminiDirectImageWithMeta({
                prompt: textFreePrompt,
                referenceUrls: refUrls,
                model: 'google/gemini-3.1-flash-image',
                seed,
              });
              return { bytes: b, meta };
            } catch {
              const b = await gatewayImageWithRefs({ prompt: textFreePrompt, referenceUrls: refUrls });
              return { bytes: b, meta: { provider: 'google_direct', model: 'google/gemini-3.1-flash-image', partCount: 1, bytesLen: b.length, finishReason: 'gateway_fallback', safetyRatings: null } };
            }
          },
        });
        const treatment = await renderKidsTitleTreatment({
          coverBg: live.bytes,
          title,
          subtitle: subtitle || null,
        });
        bestBytes = treatment.png;
        titleTreatmentMeta = treatment.metadata as unknown as Record<string, unknown>;
        usedRenderer = 'kids-title-treatment@1';
        bestReport = {
          attempt: 'composite_fallback',
          renderer: 'kids-title-treatment@1',
          note: 'baked-lettering QC failed — used guaranteed SVG-overlay composite',
          last_bake_reason: lastReason,
        };
        console.log('composite fallback succeeded');
      } catch (e) {
        return json({
          ok: false,
          error: `cover_repair_qc_failed_and_composite_fallback_failed`,
          last_reason: lastReason,
          composite_error: String((e as Error).message ?? e).slice(0, 400),
          report: bestReport,
        }, 422);
      }
    }
    if (!bestBytes) return json({ ok: false, error: 'no cover bytes produced' }, 500);


    // ── Upload versioned cover ──
    const coverPath = versionedKidsAssetPath(ebook_id, 'cover');
    const { signedUrl: coverUrl } = await uploadAndSignImage(db, 'ebook-covers', coverPath, bestBytes);

    // ── Splice PDF page 1 (keep everything else) ──
    let pdfUrlOut: string | null = null;
    if (splice_pdf && eb.pdf_url) {
      try {
        const pdfPath = storagePathFromUrl(eb.pdf_url as string, 'ebook-pdfs');
        if (!pdfPath) throw new Error('cannot resolve pdf storage path');
        const signedPdf = await signPath(db, 'ebook-pdfs', pdfPath);
        const existingPdf = await downloadBytes(signedPdf);
        const doc = await PDFDocument.load(existingPdf);
        // Preserve original page 1 size (this book is legacy 612×792).
        const page0 = doc.getPage(0);
        const { width: w0, height: h0 } = page0.getSize();
        // Insert new cover page at index 0, then remove old page 1 (now index 1).
        const newPage = doc.insertPage(0, [w0, h0]);
        const img = await doc.embedPng(bestBytes);
        // FIT-INSIDE (letterbox) instead of full-bleed crop, so a square cover
        // in a portrait/landscape legacy page doesn't clip the title text.
        // Fill background with a warm off-white to match storybook aesthetic.
        newPage.drawRectangle({ x: 0, y: 0, width: w0, height: h0, color: rgb(0.98, 0.95, 0.88) });
        const scale = Math.min(w0 / img.width, h0 / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        newPage.drawImage(img, { x: (w0 - dw) / 2, y: (h0 - dh) / 2, width: dw, height: dh });
        doc.removePage(1);
        const rebuilt = await doc.save();
        // Upload versioned PDF path
        const newPdfPath = `kids/${ebook_id}/book-${Date.now()}-repaired.pdf`;
        const up = await db.storage.from('ebook-pdfs').upload(newPdfPath, rebuilt, {
          contentType: 'application/pdf', upsert: false,
        });
        if (up.error) throw up.error;
        const { data: signed } = await db.storage.from('ebook-pdfs').createSignedUrl(newPdfPath, IMAGE_SIGNED_TTL_SECONDS);
        pdfUrlOut = signed?.signedUrl ?? null;
      } catch (e) {
        console.error('pdf splice failed', e);
      }
    }

    const existingMeta = (eb.storefront_meta as Record<string, unknown> | null) ?? {};
    const patch: Record<string, unknown> = {
      cover_url: coverUrl,
      thumbnail_url: coverUrl,
      storefront_meta: {
        ...existingMeta,
        cover_source: usedRenderer === 'kids-title-treatment@1'
          ? 'composite_fallback_v1'
          : 'interior_reference_v1',
        cover_repaired_at: new Date().toISOString(),
        cover_qc_report: bestReport,
        title_treatment: titleTreatmentMeta,
        legacy_format: (page_count_is_legacy(eb.page_count as number | null) ? true : (existingMeta.legacy_format ?? false)),
      },
    };
    if (pdfUrlOut) patch.pdf_url = pdfUrlOut;
    await db.from('ebooks_kids').update(patch).eq('id', ebook_id);


    return json({
      ok: true,
      ebook_id,
      cover_url: coverUrl,
      pdf_url: pdfUrlOut,
      report: bestReport,
    });
  } catch (e) {
    console.error('kids-repair-cover-from-interior error', e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});

function page_count_is_legacy(n: number | null | undefined): boolean {
  if (!n) return false;
  return n < 20; // pre-standard 32-40p book
}
