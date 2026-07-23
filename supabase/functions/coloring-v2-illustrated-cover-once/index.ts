// One-off illustrated cover regenerator.
//
// Owner directive 2026-07-22: "ต้องวาด" — the cover must be a fully painted
// illustration where the title (if any) is HAND-LETTERED as part of the
// artwork, not overlaid via server-side typography, and NO logo.
//
// This bypasses the deterministic-typography compositor (cover_v2_...):
//   1. Call gpt-image-1 with an "illustrated cover, hand-painted title
//      integrated into the art" prompt at 1024x1024 (SQUARE-FIRST law).
//   2. Upload raw JPEG as coloring_v2_assets.kind='cover_final'.
//   3. Update approved_cover_asset_id on coloring_v2_books.
//   4. Update ebooks_kids.cover_url + thumbnail_url with a long-lived
//      signed URL.
//
// Scope: single-book repair endpoint. Not part of the autopilot ladder.
// @ts-nocheck
import { corsHeaders, db, fetchBook, json, signedUrl, uploadAsset } from "../_shared/coloring-v2/state.ts";
import { openaiDirectImage } from "../_shared/openai-direct.ts";
import { geminiDirectImageWithMeta } from "../_shared/gemini-direct.ts";

declare const Deno: any;

function ensureColoringBookInTitle(t: string): string {
  const s = (t ?? "").trim();
  if (!s) return "Coloring Book";
  return /coloring/i.test(s) ? s : `${s} Coloring Book`;
}

async function jpegEncode(pngBytes: Uint8Array): Promise<Uint8Array> {
  // gpt-image-1 returns PNG. We keep bytes as-is and upload with .jpg is a
  // mismatch. Instead, keep extension aligned with actual bytes: PNG.
  return pngBytes;
}

// Subject-aware cover scene. The old version was hard-coded for ocean
// creatures, which shipped an ocean cover on unicorn books. We now infer
// the scene from the book title + concept.hero_subjects + concept.motif_inventory
// so covers match the actual interior subject matter.
async function buildSceneClause(book_id: string, title: string): Promise<string> {
  try {
    const c = db();
    const { data: concept } = await c.from("coloring_v2_assets")
      .select("meta").eq("book_id", book_id).eq("kind", "concept").maybeSingle();
    const heroes: string[] = Array.isArray(concept?.meta?.hero_subjects) ? concept.meta.hero_subjects.slice(0, 3) : [];
    const motifs: string[] = Array.isArray(concept?.meta?.motif_inventory) ? concept.meta.motif_inventory.slice(0, 6) : [];
    if (heroes.length) {
      const heroText = heroes.join("; ");
      const motifText = motifs.length ? ` Motifs to include: ${motifs.join(", ")}.` : "";
      return `Depict a charming scene featuring: ${heroText}. Polished, print-ready art.${motifText}`;
    }
  } catch (_) { /* fall through */ }
  // Title-based inference as last resort.
  const t = title.toLowerCase();
  if (/unicorn/.test(t)) return "Depict charming cartoon unicorns — each with FOUR legs, ONE horn, ONE tail, correct proportions — playing among stars, rainbows, and sparkles. Every unicorn anatomically complete and non-deformed.";
  if (/dragon/.test(t)) return "Depict charming cartoon dragons — each with 4 legs, 2 wings, 1 tail — playing among clouds and treasure.";
  if (/mermaid/.test(t)) return "Depict charming cartoon mermaids — each with 2 arms, 1 tail-fin, complete anatomy — playing among coral and bubbles.";
  if (/ocean|sea|fish/.test(t)) return "Depict charming cartoon ocean creatures (fish, octopus, turtle, dolphins) among coral and kelp.";
  if (/dino/.test(t)) return "Depict charming cartoon dinosaurs — each anatomically complete — playing among volcanoes and ferns.";
  return "Depict charming cartoon subjects from the book, each anatomically complete and non-deformed, in a playful storybook scene.";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  try {
    const { book_id, ebook_id } = await req.json().catch(() => ({}));
    if (!book_id) return json({ error: "book_id required" }, 400);

    const book = await fetchBook(book_id);
    const title = ensureColoringBookInTitle(book.title ?? "Coloring Book");
    const sceneClause = await buildSceneClause(book_id, title);

    const prompt = [
      `Beautiful full-color hand-painted children's coloring-book COVER illustration for "${title}".`,
      `Square 1:1 composition, FULL-BLEED edge-to-edge: painted color must extend all the way to every edge of the canvas — top, bottom, left, right. NO white background, NO white margin, NO empty paper showing, NO vignette fade to white, NO inner border, NO outer frame, NO passe-partout. Every pixel of the 1024x1024 canvas is painted illustration.`,
      `Warm cheerful storybook style — premium picture-book cover, gouache + watercolor feel, expressive, playful, high production value. Fill the background completely with a rich painted environment (sky/water/scenery) that reaches all four edges.`,
      sceneClause,
      `Every creature/character MUST be anatomically complete and non-deformed: correct number of legs, one head, one tail, complete limbs, no severed or floating body parts, no fused bodies, no extra heads, no missing features. Canonical proportions.`,
      `The title "${title}" MUST appear as HAND-LETTERED PAINTED TYPOGRAPHY integrated INTO the artwork itself — drawn by the illustrator as part of the painting (bubble-letter or brushed-script style, playful, colorful, with soft shadow and highlight painted in). NOT a font overlay, NOT flat text — it must look painted by hand.`,
      `Place the title in the upper third of the cover, arced or on a soft painted ribbon that is part of the scene. The ribbon/banner (if used) sits INSIDE the painted scene — it does NOT touch the canvas edges and does NOT create a white border around the artwork.`,
      `Do NOT include: any logo, any watermark, any URL, any age badge, any subtitle, any extra text besides the title, any UI element, any book mockup, any border, any frame, any white padding, any decorative edge strip.`,
      `Spelling of the title MUST be exact.`,
    ].join(" ");


    let bytes: Uint8Array | null = null;
    let model = "";
    let provider = "";

    // Try Gemini direct first.
    try {
      const g = await geminiDirectImageWithMeta({
        prompt,
        referenceUrls: [],
        model: "google/gemini-2.5-flash-image",
      });
      console.log(`[gemini] bytes=${g.bytes?.length ?? 0} finish=${g.meta.finishReason} block=${g.meta.blockReason}`);
      if (g.bytes && g.bytes.length > 20_000) {
        bytes = g.bytes;
        model = g.meta.model;
        provider = g.meta.provider;
      }
    } catch (e) {
      console.warn("gemini image failed:", String((e as any)?.message ?? e));
    }

    // Fall back to Lovable AI Gateway with openai/gpt-image-2.
    if (!bytes) {
      try {
        const LOVABLE_KEY = Deno.env.get("LOVABLE_API_KEY");
        if (!LOVABLE_KEY) throw new Error("LOVABLE_API_KEY missing");
        const r = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_KEY}` },
          body: JSON.stringify({
            model: "openai/gpt-image-2",
            prompt,
            size: "1024x1024",
            quality: "high",
            n: 1,
          }),
        });
        if (!r.ok) throw new Error(`lovable gateway ${r.status}: ${(await r.text()).slice(0, 300)}`);
        const j = await r.json() as { data?: Array<{ b64_json?: string }> };
        const b64 = j.data?.[0]?.b64_json;
        if (b64) {
          const bin = atob(b64);
          const buf = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
          bytes = buf;
          model = "openai/gpt-image-2";
          provider = "lovable_gateway";
        }
      } catch (e) {
        console.warn("gateway image failed:", String((e as any)?.message ?? e));
      }
    }

    // Final fallback: OpenAI direct (may hit billing limit).
    if (!bytes) {
      const o = await openaiDirectImage({
        prompt,
        model: "gpt-image-1",
        size: "1024x1024",
        quality: "high",
        timeoutMs: 180_000,
      });
      bytes = o.bytes;
      model = o.model;
      provider = "openai_direct";
    }

    if (!bytes || bytes.length < 20_000) {
      return json({ error: "empty_or_tiny_image", size: bytes?.length ?? 0 }, 500);
    }

    // Upload as PNG (gpt-image-1 returns PNG bytes).
    const asset = await uploadAsset(book_id, "cover_final", bytes, "png", {
      law: "cover_illustrated_hand_lettered_once_v1",
      provider,
      model,
      text_mode: "illustrated_hand_lettered_baked",
      prompt_len: prompt.length,
    });

    await db().from("coloring_v2_books").update({ approved_cover_asset_id: asset.id }).eq("id", book_id);

    // Public-ish signed URL (10y) for storefront.
    const publicSigned = await signedUrl(asset.storage_path, 60 * 60 * 24 * 365 * 10);

    if (ebook_id) {
      await db().from("ebooks_kids").update({
        cover_url: publicSigned,
        thumbnail_url: publicSigned,
        updated_at: new Date().toISOString(),
      }).eq("id", ebook_id);
    }

    return json({
      ok: true,
      book_id,
      ebook_id: ebook_id ?? null,
      asset_id: asset.id,
      cover_url: publicSigned,
      bytes: bytes.length,
    });
  } catch (e: any) {
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
