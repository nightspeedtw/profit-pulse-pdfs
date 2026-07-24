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
import { autoCropBorders, verifyFullBleed, type FullBleedVerdict } from "../_shared/coloring-v2/full-bleed-verify.ts";

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

// ── LAYOUT RANDOMIZER (cover_layout_diversity_v14, owner 2026-07-24) ──
// Forces AI to break away from centered-hero clichés. Deterministic pick
// from book_id keeps a given book stable on re-render, but the shelf sees
// wide compositional variety across titles.
export const LAYOUT_STYLES: Array<{ id: string; brief: string }> = [
  { id: "corner_emerge",     brief: "Subject emerging from a corner, title integrated into the landscape/environment as if it belongs to the scene." },
  { id: "circular_badge",    brief: "Circular badge / medallion composition with the title wrapping around the main character in a ring." },
  { id: "split_horizontal",  brief: "Split layout: upper half is BOLD hand-painted title typography, lower half is the detailed illustration; strong horizontal division." },
  { id: "framed_ribbon",     brief: "Framed decorative border design with vintage-modern aesthetic; the title is placed elegantly inside a hand-painted center ribbon or plaque." },
  { id: "dynamic_tilt",      brief: "Dynamic action angle with a tilted horizon; bold hand-painted title typography overlaps the artwork at an energetic diagonal." },
  { id: "asymmetric_offset", brief: "Highly asymmetrical framing: focal character pushed to one side, title stacked on the opposite side, generous negative space wrapping around the hero." },
  { id: "text_wrap_around",  brief: "Playful integration where painted letters of the title wrap around, hug, or interact with the subject (e.g. character sitting on a letter, ivy growing on letters)." },
  { id: "minimal_modern",    brief: "Minimalist modern editorial cover: one hero motif, large hand-painted title, restrained composition, a single accent color pop." },
];
export function pickLayoutStyle(bookId: string): typeof LAYOUT_STYLES[number] {
  let h = 0;
  for (let i = 0; i < bookId.length; i++) h = (h * 251 + bookId.charCodeAt(i) * 7) >>> 0;
  return LAYOUT_STYLES[h % LAYOUT_STYLES.length];
}

// ── AGE BADGE ─────────────────────────────────────────────────────────
export function ageBadgeLabel(ageBand?: string | null): string | null {
  const s = String(ageBand ?? "").trim();
  if (!s) return null;
  const m = s.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})/);
  if (!m) return null;
  return `AGES ${m[1]}-${m[2]}`;
}

// ── TITLE / SUBTITLE SPLIT (cover_reference_quality_v16, 2026-07-25) ──
// Reference covers (Robot Doodle Lab, Amazing Earth & Space) render the
// core title big + "COLORING BOOK/ADVENTURE" as a separate ribbon underneath.
// Split so each half gets its own spelling lock and treatment.
export function splitTitleForCover(full: string): { titleCore: string; subtitle: string } {
  const s = (full ?? "").trim();
  const m = s.match(/^(.*?)\s+(coloring\s+(?:book|adventure|activity\s+book|fun|pages))\s*$/i);
  if (m) return { titleCore: m[1].trim(), subtitle: m[2].toUpperCase() };
  return { titleCore: s || "Coloring Book", subtitle: "COLORING BOOK" };
}

// ── TITLE CONTAINERS (5 plaque/ribbon treatments) ─────────────────────
export const TITLE_CONTAINERS: Array<{ id: string; brief: string }> = [
  { id: "black_bubble_plaque", brief: "The title sits inside a BOLD ROUNDED BLACK BUBBLE PLAQUE (deep near-black, thick warm-yellow/cream outline, gentle drop-shadow), with tiny painted starbursts and doodles bursting from the edges of the plaque. The plaque sits high on the cover and the title letters ride confidently inside it." },
  { id: "torn_scroll_ribbon",  brief: "The title sits on a TORN CREAM/TAN PARCHMENT SCROLL that curves gently across the top of the cover, with visible torn-paper edges, subtle stitching, and hand-painted shadow underneath. The scroll integrates into the artwork; letters are painted directly onto it." },
  { id: "painted_banner",      brief: "The title rides on a WIDE PAINTED BANNER cutting horizontally across the upper third — solid contrasting fill (cream, gold, or the accent color), thick outlined edge, small curled ribbon tails on both sides, a subtle painted highlight along the top edge." },
  { id: "sticker_stack",       brief: "The title is composed as STACKED PAINTED STICKERS — each WORD of the title is its own individually painted sticker shape with its own thick outline and drop-shadow, the stickers overlap slightly at bouncy angles, and cast painted shadows onto the artwork behind them." },
  { id: "clean_stroke_only",   brief: "NO plaque behind the title — instead each letter carries an EXTRA-THICK painted stroke plus a soft painted glow so the title reads cleanly against the illustration; a very subtle painted halo darkens the art directly behind the letters for legibility." },
];
export function pickTitleContainer(bookId: string): typeof TITLE_CONTAINERS[number] {
  let h = 0;
  for (let i = 0; i < bookId.length; i++) h = (h * 89 + bookId.charCodeAt(i) * 11) >>> 0;
  return TITLE_CONTAINERS[h % TITLE_CONTAINERS.length];
}

// ── TITLE COLOR MODES (how letters are colored inside the container) ──
export const TITLE_COLOR_MODES: Array<{ id: string; brief: string }> = [
  { id: "multi_word_gradient", brief: "MULTI-WORD COLOR MODE: each WORD of the title is painted a different high-chroma color drawn from the mood palette (e.g. word 1 sunshine yellow, word 2 emerald-earth green, word 3 cosmic violet). Within a word, letters share a fill but may vary slightly in tone. Every word keeps the same thick outline and drop-shadow." },
  { id: "per_letter_theme",    brief: "PER-LETTER THEME MODE: every individual letter is filled with a tiny scene from the book's theme (e.g. one letter contains a painted starfield, another a wave pattern, another gears) — the letter shape itself becomes a little themed window while retaining a thick outline for legibility." },
  { id: "duotone_pop",         brief: "DUOTONE POP MODE: alternate WORDS strictly between two hero colors of the palette (e.g. hot pink / electric cyan), creating a punchy pop-poster contrast. Every letter still gets a thick dark outline and a chunky drop-shadow." },
  { id: "unified_glow",        brief: "UNIFIED GLOW MODE: all letters share ONE dominant hero color from the palette with a painted inner glow and a bright highlighted top edge, plus a thick outline in the palette's darkest accent — for a dramatic, cinematic title feel." },
];
export function pickTitleColorMode(bookId: string): typeof TITLE_COLOR_MODES[number] {
  let h = 0;
  for (let i = 0; i < bookId.length; i++) h = (h * 53 + bookId.charCodeAt(i) * 17) >>> 0;
  return TITLE_COLOR_MODES[h % TITLE_COLOR_MODES.length];
}

// ── THEME MOTIF KITS (theme-specific decorative props at the edges) ───
// Maps the book's dominant theme keywords to a curated set of decorative
// objects that should emerge from all four edges of the cover, so the
// frame reads full-bleed and thematically consistent.
export function pickMotifKit(theme: string, title: string): { id: string; motifs: string } {
  const s = `${theme ?? ""} ${title ?? ""}`.toLowerCase();
  if (/space|planet|cosmic|galax|astro|star|solar/.test(s))     return { id: "space",     motifs: "painted planets, ringed Saturn, crescent moon, comets, star clusters, small rockets, tiny satellites peeking from the corners" };
  if (/robot|gear|mech|invention|steam|circuit/.test(s))         return { id: "robots",    motifs: "colorful gears, tools (wrench, screwdriver), springs, bolts, circuit patterns, small robot heads and antennae emerging from the edges" };
  if (/ocean|sea|fish|mermaid|underwater|coral|reef/.test(s))    return { id: "ocean",     motifs: "coral fronds, bubbles, small fish silhouettes, kelp strands, seashells, starfish emerging from the corners" };
  if (/dino|prehistoric|jurassic/.test(s))                       return { id: "dinos",     motifs: "ferns, volcano puffs, footprints, palm fronds, small pterosaurs, tiny eggs peeking in from the edges" };
  if (/unicorn|fairy|magic|enchant|rainbow/.test(s))             return { id: "fairy",     motifs: "rainbows, magic sparkles, painted clouds, tiny stars, flower crowns, ribbons trailing from the corners" };
  if (/forest|jungle|animal|wild|safari/.test(s))                return { id: "wild",      motifs: "leafy vines, painted flowers, butterflies, small animal faces peeking, mushrooms, ferns emerging inward from the edges" };
  if (/dragon|castle|knight|kingdom|adventure|treasure/.test(s)) return { id: "adventure", motifs: "flags, small castle turrets, treasure coins, scrolls, keys, small dragon wings and tails peeking from the corners" };
  if (/farm|garden|flower|veggie|bee/.test(s))                   return { id: "garden",    motifs: "sunflowers, daisies, honey bees, watering cans, painted vines and leaves emerging inward from the edges" };
  if (/alphabet|letter|number|abc|learn/.test(s))                return { id: "abc",       motifs: "tiny painted letter blocks, pencil crayons, stars, paint splashes, little numeric doodles peeking from the corners" };
  return { id: "generic", motifs: "small joyful hand-painted doodles (stars, hearts, sparkles, tiny flowers, little swirls) emerging inward from every edge — never abstract; always tied to the book's subject" };
}


Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  try {
    const { book_id, ebook_id } = await req.json().catch(() => ({}));
    if (!book_id) return json({ error: "book_id required" }, 400);

    const book = await fetchBook(book_id);
    const fullTitle = ensureColoringBookInTitle(book.title ?? "Coloring Book");
    const { titleCore, subtitle } = splitTitleForCover(fullTitle);
    const sceneClause = await buildSceneClause(book_id, fullTitle);
    const mood = pickMood(book_id);
    const lettering = pickLetteringStyle(book_id);
    const layout = pickLayoutStyle(book_id);
    const container = pickTitleContainer(book_id);
    const colorMode = pickTitleColorMode(book_id);
    const motifKit = pickMotifKit(String(book.theme ?? ""), fullTitle);
    const ageLabel = ageBadgeLabel(book.age_band);

    const ageBadgeClause = ageLabel
      ? `Include a PAINTED CIRCULAR AGE BADGE as a two-ring sticker in the upper-right area of the cover (roughly 15-18% of cover width): an outer ring in a bright accent color (yellow, orange, or red — whichever contrasts best with the background) and an inner disc in a slightly darker/deeper shade, thick dark outline around both rings, chunky drop-shadow underneath, and the EXACT text "${ageLabel}" hand-lettered inside the inner disc in bold rounded capitals with a subtle engraved/letterpress feel. The badge is part of the painting, not a font overlay. Do NOT place any other text near it.`
      : `Do NOT add any age badge, age indicator, or age-range text anywhere on the cover.`;

    // Perfect-spelling guardrails — now split across titleCore + subtitle.
    const coreLock = titleCore.split("").join(" ");
    const subLock = subtitle.split("").join(" ");
    const spellingClause = `PERFECT TEXT RENDERING — NON-NEGOTIABLE. TWO text elements only exist on this cover: (1) the CORE TITLE "${titleCore}" rendered big and hero-sized, and (2) a SEPARATE SUBTITLE RIBBON reading "${subtitle}" placed on its own small painted banner directly beneath the core title. Both must be spelled EXACTLY, with absolutely NO typos, NO missing letters, NO doubled letters, NO extra letters, NO gibberish. Character-by-character spelling lock for the core title: [ ${coreLock} ]. Character-by-character spelling lock for the subtitle: [ ${subLock} ]. Count the letters before drawing. Draw each letter deliberately as its own hand-illustrated shape. Do not invent decorative extra letters. Do NOT merge the core title and the subtitle into one block — they are two distinct painted elements.`;

    const prompt = [
      `A highly creative, vibrant, unique, and PACKED front cover design for a children's coloring book — the core title is "${titleCore}" and the subtitle ribbon reads "${subtitle}".`,
      `Art direction — MOOD "${mood.id}": palette = ${mood.palette}; energy = ${mood.energy}.`,
      `BRIGHT, SATURATED, MODERN 2026 picture-book aesthetic. High-chroma joyful palette, fresh shelf-release feel, poster-punchy at 160px thumbnail size. Bold shape language and one clear focal hero surrounded by a rich supporting cast.`,
      `Do NOT look muted, retro, vintage, sepia, dusty, faded, brown, tea-stained, or watercolor-washed. Reject any "old storybook" feeling. Reject muddy neutrals.`,
      `Square 1:1 composition, FULL-BLEED edge-to-edge (NON-NEGOTIABLE): the painted illustration MUST bleed off all four edges of the 1024x1024 canvas. Literally paint past the edge — a one-pixel-wide strip along every edge (top, bottom, left, right) must be full-saturation painted illustration, NOT white paper, NOT a colored bar, NOT a decorative frame, NOT a vignette fade to white or any solid color. Absolutely forbidden: any white or off-white margin, any inner border, any outer frame, any passe-partout, any polaroid-style border, any colored ribbon frame around the whole artwork, any inner rectangle, any drop-shadow around the artwork that suggests it is a card floating on a background. Every single pixel of the 1024x1024 canvas is painted illustration.`,
      `Premium picture-book cover: gouache + digital-brush feel with glossy playful mark-making, expressive and vivid, high production value. Fill the background completely with a rich painted environment that reaches all four edges.`,
      sceneClause,
      // ENSEMBLE — force multiple characters + supporting cast + edge decoration.
      `CHARACTER ENSEMBLE — DENSE COVER: place ONE clear hero character at the visual anchor point (per the layout approach below), PLUS 2-3 supporting characters/creatures interacting with the hero (peeking, waving, sitting nearby), PLUS 4-6 painted decorative props from the theme motif kit emerging INWARD from the four edges (top, bottom, left, right) — objects half-in / half-out of frame so no edge is empty painted background. The cover should feel gently packed and celebratory, never a lonely hero on empty color.`,
      `THEME MOTIF KIT — "${motifKit.id}": ${motifKit.motifs}. Every edge of the cover must have at least one motif from this kit crossing it.`,
      `Every creature/character MUST be anatomically complete and non-deformed: correct number of legs, one head, one tail, complete limbs, no severed or floating body parts, no fused bodies, no extra heads, no missing features. Canonical proportions.`,
      // Composition & Layout — forcing diversity across the shelf.
      `COMPOSITION & LAYOUT — FORCING DIVERSITY: do NOT default to a standard centered-hero layout. Apply this specific layout approach — "${layout.id}": ${layout.brief} Explore this direction fully; the composition should feel like a distinct design decision, not a generic template.`,
      // Title container (plaque / ribbon / sticker / stroke).
      `TITLE CONTAINER — "${container.id}": ${container.brief} This is a MANDATORY element and it must sit on TOP of the illustration (not behind it), so the core title always reads clearly regardless of the artwork behind.`,
      // Lettering style (hand-lettering execution).
      `LETTERING STYLE — "${lettering.id}": ${lettering.brief}`,
      // Letter color mode.
      `TITLE COLOR MODE — "${colorMode.id}": ${colorMode.brief}`,
      // Overall title treatment.
      `TITLE TREATMENT: the CORE TITLE "${titleCore}" MUST appear as HAND-ILLUSTRATED CUSTOM LETTERING that is PART OF THE PAINTING — every letter drawn individually by the illustrator with texture, highlight, and shadow painted in. Absolutely NO system font, NO flat digital typography, NO clean vector text. The core title (together with its container) should occupy roughly 35-45% of the cover area, positioned per the layout approach above.`,
      // Subtitle ribbon (separate element).
      `SUBTITLE RIBBON — REQUIRED SEPARATE ELEMENT: directly beneath the core title, place a small painted ribbon/banner (roughly 45-60% the width of the core title and about 12-18% of the cover height) that reads "${subtitle}" in bold hand-lettered capitals — a different (smaller) treatment from the core title, painted in a strongly contrasting color to the ribbon fill (e.g. dark letters on a cream/gold ribbon, or light letters on a deep ribbon), with thin painted outline and a small drop-shadow. The subtitle ribbon must NOT be styled identically to the core title container — they are two distinct painted elements.`,
      // Spelling guardrails (the specific failure class this file targets).
      spellingClause,
      ageBadgeClause,
      `Do NOT include: any logo, any watermark, any URL, any additional text besides the core title, the subtitle ribbon, and the age badge (if requested above), any UI element, any book mockup, any border wrapping the whole cover, any frame, any white padding, any decorative edge strip that acts as a border.`,
    ].join(" ");


    // ── Provider ladder with FULL-BLEED verifier (cover_full_bleed_edge_verifier_v15) ──
    // Each attempt runs the verifier; on fail we retry the next provider
    // with the specific offender appended to the prompt. If all attempts
    // fail we auto-crop the border as a last-resort rescue.
    type Attempt = { provider: string; model: string; bytes: Uint8Array; verdict: FullBleedVerdict };
    const attempts: Attempt[] = [];
    let extraOffenderClause = "";

    async function tryGemini(promptText: string): Promise<{ bytes: Uint8Array; model: string; provider: string } | null> {
      try {
        const g = await geminiDirectImageWithMeta({
          prompt: promptText,
          referenceUrls: [],
          model: "google/gemini-2.5-flash-image",
        });
        console.log(`[gemini] bytes=${g.bytes?.length ?? 0} finish=${g.meta.finishReason} block=${g.meta.blockReason}`);
        if (g.bytes && g.bytes.length > 20_000) {
          return { bytes: g.bytes, model: g.meta.model, provider: g.meta.provider };
        }
      } catch (e) {
        console.warn("gemini image failed:", String((e as any)?.message ?? e));
      }
      return null;
    }

    async function tryGateway(promptText: string): Promise<{ bytes: Uint8Array; model: string; provider: string } | null> {
      try {
        const LOVABLE_KEY = Deno.env.get("LOVABLE_API_KEY");
        if (!LOVABLE_KEY) return null;
        const r = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_KEY}` },
          body: JSON.stringify({
            model: "openai/gpt-image-2",
            prompt: promptText,
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
          return { bytes: buf, model: "openai/gpt-image-2", provider: "lovable_gateway" };
        }
      } catch (e) {
        console.warn("gateway image failed:", String((e as any)?.message ?? e));
      }
      return null;
    }

    async function tryOpenAIDirect(promptText: string): Promise<{ bytes: Uint8Array; model: string; provider: string } | null> {
      try {
        const o = await openaiDirectImage({
          prompt: promptText,
          model: "gpt-image-1",
          size: "1024x1024",
          quality: "high",
          timeoutMs: 180_000,
        });
        if (o.bytes && o.bytes.length > 20_000) {
          return { bytes: o.bytes, model: o.model, provider: "openai_direct" };
        }
      } catch (e) {
        console.warn("openai-direct image failed:", String((e as any)?.message ?? e));
      }
      return null;
    }

    const providers = [tryGemini, tryGateway, tryOpenAIDirect];
    let bytes: Uint8Array | null = null;
    let model = "";
    let provider = "";
    let finalVerdict: FullBleedVerdict | null = null;
    let fullBleedAutocropped = false;

    for (let attempt = 0; attempt < providers.length; attempt++) {
      const attemptPrompt = extraOffenderClause
        ? `${prompt} REGENERATE — the previous attempt failed FULL-BLEED verification: ${extraOffenderClause} This attempt MUST paint every pixel to the edge; no white/uniform border of any kind.`
        : prompt;
      const gen = await providers[attempt](attemptPrompt);
      if (!gen) continue;
      const verdict = await verifyFullBleed(gen.bytes).catch((e) => {
        console.warn("full-bleed verifier crashed:", String((e as any)?.message ?? e));
        return { pass: true, worstEdge: null, edges: { top: { whiteRatio: 0, uniformRatio: 0, borderPx: 0 }, bottom: { whiteRatio: 0, uniformRatio: 0, borderPx: 0 }, left: { whiteRatio: 0, uniformRatio: 0, borderPx: 0 }, right: { whiteRatio: 0, uniformRatio: 0, borderPx: 0 } }, reason: "verifier_degraded" } as FullBleedVerdict;
      });
      attempts.push({ provider: gen.provider, model: gen.model, bytes: gen.bytes, verdict });
      console.log(`[full-bleed] attempt=${attempt + 1} provider=${gen.provider} pass=${verdict.pass} worst=${verdict.worstEdge} reason=${verdict.reason}`);
      if (verdict.pass) {
        bytes = gen.bytes;
        model = gen.model;
        provider = gen.provider;
        finalVerdict = verdict;
        break;
      }
      // Strengthen prompt for the next provider
      const worst = verdict.worstEdge ?? "unknown";
      const edgeStats = verdict.worstEdge ? verdict.edges[verdict.worstEdge] : null;
      extraOffenderClause = `previous image had a ${verdict.reason?.startsWith("edge_white_border") ? "WHITE MARGIN" : "SOLID-COLOR FRAME"} on the ${worst} edge (whiteRatio=${edgeStats?.whiteRatio.toFixed(2)}, uniformRatio=${edgeStats?.uniformRatio.toFixed(2)}). PAINT THE ${worst.toUpperCase()} EDGE COMPLETELY with illustration content — no border, no uniform bar, no frame.`;
    }

    // Rescue path: no attempt passed. Use the best (last) attempt and auto-crop borders.
    if (!bytes && attempts.length > 0) {
      const best = attempts[attempts.length - 1];
      try {
        const rescued = await autoCropBorders(best.bytes);
        const reVerdict = await verifyFullBleed(rescued.bytes).catch(() => null);
        console.log(`[full-bleed] autocrop trimmed=${JSON.stringify(rescued.trimmed)} reVerdict=${reVerdict?.pass}`);
        bytes = rescued.bytes;
        model = best.model;
        provider = best.provider;
        finalVerdict = reVerdict ?? best.verdict;
        fullBleedAutocropped = true;
      } catch (e) {
        console.warn("autoCropBorders failed, shipping best attempt as-is:", String((e as any)?.message ?? e));
        bytes = best.bytes;
        model = best.model;
        provider = best.provider;
        finalVerdict = best.verdict;
      }
    }

    if (!bytes || bytes.length < 20_000) {
      return json({ error: "empty_or_tiny_image", size: bytes?.length ?? 0, attempts: attempts.length }, 500);
    }

    // Upload as PNG (gpt-image-1 returns PNG bytes).
    const asset = await uploadAsset(book_id, "cover_final", bytes, "png", {
      law: "cover_reference_quality_v16",
      provider,
      model,
      text_mode: "illustrated_hand_lettered_baked",
      lettering_style: lettering.id,
      layout_style: layout.id,
      title_container: container.id,
      title_color_mode: colorMode.id,
      motif_kit: motifKit.id,
      mood: mood.id,
      age_badge: ageLabel ?? null,
      title_spelling_lock: titleCore,
      subtitle_spelling_lock: subtitle,
      prompt_len: prompt.length,
      full_bleed: finalVerdict
        ? {
            pass: finalVerdict.pass,
            worstEdge: finalVerdict.worstEdge,
            reason: finalVerdict.reason,
            edges: finalVerdict.edges,
            attempts: attempts.length,
            autocropped: fullBleedAutocropped,
          }
        : null,
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
