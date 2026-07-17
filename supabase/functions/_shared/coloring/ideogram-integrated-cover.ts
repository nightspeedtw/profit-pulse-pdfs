// Tier-1 cover generator for OWNER LAW `coloring_cover_verified_typography_v2`.
//
// Calls fal.ai `fal-ai/ideogram/v3` to produce a full-color kids scene with
// hand-lettered title, subtitle, and age badge baked INTO the composition
// (like the beloved Sneeze-Powered Sock Sorter cover). Ideogram excels at
// integrated typography; ~90% per-attempt text accuracy plus 3 verified
// attempts → ~97% success within the tier.
//
// The output MUST be passed to `cover-text-transcription.verifyExactCoverText`
// before it is trusted. Any missing/extra/misspelled word → discard and retry.
// Never publish an Ideogram result without a passing verifier.

// @ts-nocheck  Deno edge runtime

const FAL_KEY = Deno.env.get("FAL_KEY") ?? Deno.env.get("FAL_API_KEY");

export const IDEOGRAM_INTEGRATED_COVER_VERSION = "coloring_cover_ideogram_v3_integrated_v1";

export interface IdeogramCoverRequest {
  categoryName: string;
  heroSubjects: string[];
  title: string;
  subtitle: string;
  ageBadge: string;
  ageMin: number;
  ageMax: number;
  totalPages: number;
  /**
   * Category-appropriate scene guidance. `backgroundHint` describes the ONLY
   * environment the model may paint (e.g. "enchanted forest with soft
   * meadow"). `forbiddenBackgrounds` is a hard negative list (e.g. ocean
   * waves, coral reef) so cross-category templates cannot leak in — this is
   * the fix for the "unicorn standing on ocean waves" defect class.
   */
  backgroundHint?: string;
  forbiddenBackgrounds?: string[];
  forbiddenSubjects?: string[];
}

export interface IdeogramCoverResult {
  bytes: Uint8Array;
  provider: "fal_ideogram_v3";
  prompt: string;
  seed?: number;
  request_id?: string | null;
}

// Category-family → allowed background clause. Used to positively steer the
// scene when the caller hasn't supplied an explicit backgroundHint.
export function defaultBackgroundHintFor(categoryName: string): string {
  const c = (categoryName ?? "").toLowerCase();
  if (/ocean|sea|mermaid|underwater|reef|marine/.test(c)) return "soft underwater seascape with gentle wavy water, coral hints, bubbles";
  if (/farm|woodland|forest|barn/.test(c)) return "sunny farm meadow or cozy woodland clearing with grass, trees, wooden fence — NO water";
  if (/dinosaur|prehistoric/.test(c)) return "prehistoric jungle or volcanic plain with ferns and rocks — NO ocean, NO waves, NO water";
  if (/unicorn|fairy|princess|fantasy|magic|mermaid/.test(c) && !/mermaid|ocean/.test(c)) return "enchanted magical meadow, rainbow sky, sparkles, distant castle or flower field — NO ocean, NO waves";
  if (/pet|cat|dog|puppy|kitten/.test(c)) return "cozy home yard, living room, or park lawn — NO ocean, NO wild jungle";
  if (/safari|wild|jungle/.test(c)) return "African savanna or jungle with acacia trees, grass, rocks — NO ocean, NO snow";
  if (/space|astronaut|planet/.test(c)) return "starry outer space with planets and nebulae — NO ocean, NO forest";
  if (/holiday|christmas|halloween|season/.test(c)) return "seasonal indoor/outdoor holiday scene appropriate to the theme — NO ocean waves";
  if (/floral|flower|botanical|garden/.test(c)) return "flower garden with leaves, petals, butterflies — NO ocean, NO waves";
  if (/preschool|toddler/.test(c)) return "simple friendly playroom or meadow scene — NO ocean unless a specific sea hero is shown";
  return "a scene environment that clearly belongs to the book's category — NO ocean waves for non-ocean books, NO castles for non-fantasy, NO snow for non-winter";
}

export function buildIdeogramIntegratedCoverPrompt(input: IdeogramCoverRequest): string {
  const heroes = (input.heroSubjects ?? []).filter(Boolean).slice(0, 6).join(", ");
  const bgHint = (input.backgroundHint ?? "").trim() || defaultBackgroundHintFor(input.categoryName);
  const forbiddenBg = (input.forbiddenBackgrounds ?? []).filter(Boolean).slice(0, 10);
  const forbiddenSubj = (input.forbiddenSubjects ?? []).filter(Boolean).slice(0, 12);
  const parts = [
    // Composition
    `A joyful children's coloring-book cover for ages ${input.ageMin}-${input.ageMax}, "${input.categoryName}" theme.`,
    heroes ? `Front and center: charming friendly ${heroes}, warm playful expressions, storybook composition.` : "",
    `SCENE / BACKGROUND — ${bgHint}. The background MUST match the "${input.categoryName}" category. Do NOT reuse a generic ocean/water strip or template from other books.`,
    forbiddenBg.length ? `NEGATIVE SCENE — do NOT include: ${forbiddenBg.join(", ")}.` : "",
    forbiddenSubj.length ? `NEGATIVE SUBJECTS — do NOT include any of: ${forbiddenSubj.join(", ")}.` : "",
    "Full-color painterly illustration, thick crayon-textured line art, soft warm palette, cozy natural light, clean uncluttered background, generous negative space at the top for the title.",
    // Integrated typography (this is what Ideogram excels at)
    "INTEGRATED HAND-LETTERED TYPOGRAPHY baked into the composition:",
    `- The main title reads EXACTLY: "${input.title}"`,
    `- Rendered as a large arched playful hand-lettered logo across the top third,`,
    `  puffy rounded display lettering with thick dark outline, warm cream/yellow fill,`,
    `  subtle drop shadow, per-letter bounce, decorative flourishes matching the theme.`,
    `- Directly beneath, a smaller line reads EXACTLY: "${input.subtitle}"`,
    `  in soft rounded lowercase script, calm dark color, single line.`,
    `- A small round badge in a lower corner reads EXACTLY: "${input.ageBadge}"`,
    `  puffy sticker style, warm color-block, clearly legible.`,
    "Spelling must be pixel-perfect. Do NOT paraphrase or abbreviate any word.",
    "Do NOT invent extra words, captions, taglines, credits, publisher names, page numbers, or watermarks.",
    "Only the three text elements above may appear anywhere in the image.",
    // SAFE-AREA RULE (round_1 fix: baked-title clipping class).
    "SAFE-AREA RULE — all lettering, glyphs and title strokes MUST sit inside the central 80% of the frame. Nothing (no letter, no stroke, no ornament) may touch or overlap the outer 10% band on any side. Leave a clean margin so the title reads whole even if trimmed 6% at print.",
    "Hero subjects must also stay inside the central 88% of the frame — no animal or character may be cropped by the edge.",
    // Style
    "Style reference: modern picture-book cover, gouache texture, ideogram-integrated lettering, Crayola beauty, Sneeze-Powered Sock Sorter aesthetic.",
    "Aspect ratio 3:4 portrait, matches printed 8.5x11 book cover. High resolution, sharp lettering.",
  ].filter(Boolean);
  return parts.join(" ");
}

interface FalQueueResponse {
  request_id: string;
  status_url: string;
  response_url: string;
}

interface FalIdeogramImage {
  url: string;
  width?: number;
  height?: number;
  content_type?: string;
}

async function pollFalQueue(statusUrl: string, responseUrl: string, deadlineMs: number): Promise<any> {
  while (Date.now() < deadlineMs) {
    const s = await fetch(statusUrl, {
      headers: { Authorization: `Key ${FAL_KEY}` },
    });
    if (!s.ok) throw new Error(`fal_status_http_${s.status}:${(await s.text()).slice(0, 200)}`);
    const j = await s.json();
    const status = String(j?.status ?? "").toUpperCase();
    if (status === "COMPLETED") {
      const r = await fetch(responseUrl, { headers: { Authorization: `Key ${FAL_KEY}` } });
      if (!r.ok) throw new Error(`fal_response_http_${r.status}:${(await r.text()).slice(0, 200)}`);
      return await r.json();
    }
    if (status === "FAILED" || status === "CANCELLED" || status === "ERROR") {
      throw new Error(`fal_ideogram_${status.toLowerCase()}:${JSON.stringify(j?.logs ?? j).slice(0, 300)}`);
    }
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error(`fal_ideogram_poll_deadline_exceeded`);
}

export async function generateIdeogramIntegratedCover(
  request: IdeogramCoverRequest,
  opts: { timeoutMs?: number; seed?: number } = {},
): Promise<IdeogramCoverResult> {
  if (!FAL_KEY) throw new Error("provider_unconfigured:FAL_KEY_missing");
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const prompt = buildIdeogramIntegratedCoverPrompt(request);
  const body = {
    prompt,
    aspect_ratio: "3:4",
    rendering_speed: "BALANCED",
    style: "AUTO",
    expand_prompt: false,
    num_images: 1,
    ...(opts.seed != null ? { seed: opts.seed } : {}),
  };

  const submitRes = await fetch("https://queue.fal.run/fal-ai/ideogram/v3", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${FAL_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!submitRes.ok) {
    const txt = (await submitRes.text()).slice(0, 400);
    throw new Error(`fal_ideogram_submit_http_${submitRes.status}:${txt}`);
  }
  const queue = (await submitRes.json()) as FalQueueResponse;
  const deadline = Date.now() + timeoutMs;
  const completed = await pollFalQueue(queue.status_url, queue.response_url, deadline);
  const image: FalIdeogramImage | undefined = completed?.images?.[0];
  if (!image?.url) throw new Error(`fal_ideogram_no_image:${JSON.stringify(completed).slice(0, 200)}`);
  const imgRes = await fetch(image.url);
  if (!imgRes.ok) throw new Error(`fal_ideogram_download_http_${imgRes.status}`);
  const bytes = new Uint8Array(await imgRes.arrayBuffer());
  return {
    bytes,
    provider: "fal_ideogram_v3",
    prompt,
    seed: completed?.seed ?? opts.seed,
    request_id: queue.request_id ?? null,
  };
}
