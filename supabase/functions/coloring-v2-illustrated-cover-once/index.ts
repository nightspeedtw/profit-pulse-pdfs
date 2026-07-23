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

// 2026 art-direction mood pool. Deterministic pick from book_id hash so
// covers spread visually across the shelf instead of clustering on one look.
const COVER_ART_MOODS: Array<{ id: string; palette: string; energy: string }> = [
  { id: "neon-pop",     palette: "hot pink, electric yellow, cyan, violet", energy: "glossy risograph pop-art, bold shape language, playful marks" },
  { id: "sunset-blaze", palette: "coral, marigold, magenta, warm violet",   energy: "sunset gradient sky, warm cinematic glow, joyful energy" },
  { id: "candy-bright", palette: "blush pink, mint, lemon, sky blue",       energy: "stickery pastel-highlighter poster feel, crisp cheerful shapes" },
  { id: "vapor-chrome", palette: "iridescent pastels + chrome accents",     energy: "Y2K/2026 futurism, glossy holographic highlights, poster energy" },
  { id: "tropical-hifi",palette: "turquoise, lime, hibiscus red, sunshine", energy: "saturated jungle-print energy, high-chroma tropical picture-book" },
  { id: "dreamy-holo",  palette: "soft holographic pastels with sparkles",  energy: "dreamy iridescent sheen, twinkle highlights, magical poster feel" },
];
function pickMood(bookId: string): typeof COVER_ART_MOODS[number] {
  let h = 0;
  for (let i = 0; i < bookId.length; i++) h = (h * 31 + bookId.charCodeAt(i)) >>> 0;
  return COVER_ART_MOODS[h % COVER_ART_MOODS.length];
}

// ── LETTERING STYLES (cover_illustrated_lettering_v13) ───────────────
// Each style is a hand-illustrated title treatment inspired by best-selling
// kids-book covers. Chosen deterministically per book so a re-render of the
// same book keeps the same lettering identity, but the shelf shows variety.
export const LETTERING_STYLES: Array<{ id: string; brief: string }> = [
  {
    id: "chunky_puffy_multicolor",
    brief: "CHUNKY PUFFY MULTICOLOR letters: each letter thick, rounded, three-dimensional, painted a DIFFERENT bright color (red, orange, yellow, green, blue, purple rotating), thick dark outline around every letter, chunky drop-shadow, tiny stars/sparkles bursting between letters, joyful energetic poster feel.",
  },
  {
    id: "cracked_metal_epic",
    brief: "CRACKED METAL EPIC letters: bold blocky capitals with a chrome/metal painted surface, subtle cracks and shattered-glass highlights across the face, dramatic edge glow, electric energy leaking from the letters, cinematic graphic-novel poster energy.",
  },
  {
    id: "arcade_chrome_neon",
    brief: "ARCADE CHROME NEON letters: bold retro-arcade capitals with a mirror-chrome painted face, thick neon-outline glow (electric cyan or magenta), soft light bloom around each letter, gamer/2026 esports-poster aesthetic.",
  },
  {
    id: "hand_painted_storybook",
    brief: "HAND-PAINTED STORYBOOK letters: warm brush-lettered title with slightly irregular baseline, gouache texture inside each letter, gentle drop-shadow, painted highlight on the top edge of every letter, classic premium picture-book cover feel.",
  },
  {
    id: "balloon_bubble_gradient",
    brief: "BALLOON BUBBLE GRADIENT letters: super round bubble letters, glossy gradient fill on each (sunset, candy, or sky gradient), bright specular highlight on the top of every letter, tiny cast shadow, ultra-friendly picture-book feel.",
  },
  {
    id: "wood_carved_adventure",
    brief: "WOOD-CARVED ADVENTURE letters: chunky letters painted to look like carved / burnished wood plaque, warm amber gradient, gold rim, hand-painted grain texture, small decorative accents tucked around the letters, adventure-storybook feel.",
  },
];
export function pickLetteringStyle(bookId: string): typeof LETTERING_STYLES[number] {
  let h = 0;
  for (let i = 0; i < bookId.length; i++) h = (h * 137 + bookId.charCodeAt(i)) >>> 0;
  return LETTERING_STYLES[h % LETTERING_STYLES.length];
}

// ── AGE BADGE ─────────────────────────────────────────────────────────
export function ageBadgeLabel(ageBand?: string | null): string | null {
  const s = String(ageBand ?? "").trim();
  if (!s) return null;
  const m = s.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})/);
  if (!m) return null;
  return `AGES ${m[1]}-${m[2]}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  try {
    const { book_id, ebook_id } = await req.json().catch(() => ({}));
    if (!book_id) return json({ error: "book_id required" }, 400);

    const book = await fetchBook(book_id);
    const title = ensureColoringBookInTitle(book.title ?? "Coloring Book");
    const sceneClause = await buildSceneClause(book_id, title);
    const mood = pickMood(book_id);
    const lettering = pickLetteringStyle(book_id);
    const ageLabel = ageBadgeLabel(book.age_band);

    const ageBadgeClause = ageLabel
      ? `Include a PAINTED CIRCULAR AGE BADGE in the TOP-RIGHT corner of the cover: a bright circular sticker/seal (yellow, orange, or red — choose whichever contrasts best with the background), thick dark outline, subtle drop-shadow, with the EXACT text "${ageLabel}" hand-lettered inside in bold rounded capitals. The badge is part of the painting, not a font overlay. Size roughly 15-18% of the cover width. Do NOT place any other text near it.`
      : `Do NOT add any age badge, age indicator, or age-range text anywhere on the cover.`;

    const prompt = [
      `Beautiful full-color hand-painted children's coloring-book COVER illustration for "${title}".`,
      `Art direction — MOOD "${mood.id}": palette = ${mood.palette}; energy = ${mood.energy}.`,
      `BRIGHT, SATURATED, MODERN 2026 picture-book aesthetic. High-chroma joyful palette, fresh shelf-release feel, poster-punchy at 160px thumbnail size. Bold shape language and one clear focal hero.`,
      `Do NOT look muted, retro, vintage, sepia, dusty, faded, brown, tea-stained, or watercolor-washed. Reject any "old storybook" feeling. Reject muddy neutrals.`,
      `Square 1:1 composition, FULL-BLEED edge-to-edge: painted color must extend all the way to every edge of the canvas — top, bottom, left, right. NO white background, NO white margin, NO empty paper showing, NO vignette fade to white, NO inner border, NO outer frame, NO passe-partout. Every pixel of the 1024x1024 canvas is painted illustration.`,
      `Premium picture-book cover: gouache + digital-brush feel with glossy playful mark-making, expressive and vivid, high production value. Fill the background completely with a rich painted environment that reaches all four edges.`,
      sceneClause,
      `Every creature/character MUST be anatomically complete and non-deformed: correct number of legs, one head, one tail, complete limbs, no severed or floating body parts, no fused bodies, no extra heads, no missing features. Canonical proportions.`,
      `TITLE TREATMENT — style "${lettering.id}": ${lettering.brief} The title "${title}" MUST appear as HAND-ILLUSTRATED CUSTOM LETTERING that is PART OF THE PAINTING — every letter drawn individually by the illustrator with texture, highlight, and shadow painted in. Absolutely NO system font, NO flat digital typography, NO clean vector text. The title should occupy roughly 40-50% of the cover area, placed prominently in the upper half, arced, stacked, or on a painted banner that is part of the scene.`,
      ageBadgeClause,
      `Do NOT include: any logo, any watermark, any URL, any subtitle, any extra text besides the title and the age badge (if requested above), any UI element, any book mockup, any border, any frame, any white padding, any decorative edge strip.`,
      `Spelling of the title MUST be exact. If an age badge is requested, its spelling MUST be exact.`,
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
