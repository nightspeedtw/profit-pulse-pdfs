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

import { hasOpenAIDirect, openaiDirectImage } from "../openai-direct.ts";
import { coerceForProviderPayload } from "./payload-guard.ts";

// gpt-image-1 medium 1024x1536 ≈ $0.04/image (benchmark 2026-07-18).
const GPT_IMAGE_COVER_COST_USD = 0.04;
// Auto-degrade thresholds: if we have at least N attempts and pass-rate
// falls below FLOOR, prefer Ideogram until GPT Image recovers. Matches the
// provider-resilience-single-funded-path doctrine registered 2026-07-17.
const GPT_IMAGE_MIN_SAMPLE = 20;
const GPT_IMAGE_PASS_FLOOR = 0.75;
const GPT_IMAGE_STATS_WINDOW_HOURS = 72;
const DISABLE_GPT_IMAGE = (Deno.env.get("COLORING_COVER_DISABLE_GPT_IMAGE") ?? "0") === "1";

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
  /**
   * Interior-page reference URLs (up to 3). When present, the cover model is
   * conditioned on the SAME character designs the interior already rendered
   * so the cover cast matches the book cast (owner law: interior-first,
   * cover-last, character-continuity permanent).
   */
  referenceImageURLs?: string[];
}

export interface IdeogramCoverResult {
  bytes: Uint8Array;
  provider: "fal_ideogram_v3" | "openai_gpt_image_1";
  prompt: string;
  seed?: number;
  request_id?: string | null;
}

/**
 * Decide whether the next cover attempt should try GPT Image first or fall
 * back to Ideogram. Reads recent `coloring_book_events` rows written by the
 * cover worker after each attempt outcome; if GPT Image's rolling pass rate
 * on ≥ GPT_IMAGE_MIN_SAMPLE attempts drops below GPT_IMAGE_PASS_FLOOR,
 * Ideogram is preferred. Any DB error → default to GPT Image (fail-open;
 * cheap path is presumed healthy until evidence says otherwise).
 */
export async function pickCoverPrimaryProvider(
  db: any | null | undefined,
): Promise<{ primary: "gpt_image" | "ideogram"; reason: string; sample: number; pass_rate: number | null }> {
  if (DISABLE_GPT_IMAGE || !hasOpenAIDirect()) {
    return { primary: "ideogram", reason: DISABLE_GPT_IMAGE ? "flag_disabled" : "openai_key_missing", sample: 0, pass_rate: null };
  }
  if (!db) return { primary: "gpt_image", reason: "no_db_fail_open", sample: 0, pass_rate: null };
  try {
    const since = new Date(Date.now() - GPT_IMAGE_STATS_WINDOW_HOURS * 3600 * 1000).toISOString();
    const { data } = await db
      .from("coloring_book_events")
      .select("metadata")
      .eq("event_type", "cover_provider_attempt")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(120);
    const gpt = (data ?? []).filter((r: any) => r?.metadata?.provider === "openai_gpt_image_1");
    if (gpt.length < GPT_IMAGE_MIN_SAMPLE) {
      return { primary: "gpt_image", reason: `insufficient_sample(${gpt.length}/${GPT_IMAGE_MIN_SAMPLE})`, sample: gpt.length, pass_rate: null };
    }
    const passed = gpt.filter((r: any) => r?.metadata?.pass === true).length;
    const rate = passed / gpt.length;
    if (rate < GPT_IMAGE_PASS_FLOOR) {
      return { primary: "ideogram", reason: `gpt_image_pass_rate_below_floor(${rate.toFixed(2)}<${GPT_IMAGE_PASS_FLOOR})`, sample: gpt.length, pass_rate: rate };
    }
    return { primary: "gpt_image", reason: `gpt_image_healthy(${rate.toFixed(2)})`, sample: gpt.length, pass_rate: rate };
  } catch (_e) {
    return { primary: "gpt_image", reason: "stats_query_failed_fail_open", sample: 0, pass_rate: null };
  }
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
    (input.referenceImageURLs && input.referenceImageURLs.length > 0)
      ? "CHARACTER CONTINUITY — the attached reference images are pages from THIS book's interior. Reuse the SAME characters (same species, same proportions, same friendly faces, same palette family) so the cover cast matches the interior cast exactly. Do NOT invent new characters or restyle them."
      : "",
    "Full-color painterly illustration, thick crayon-textured line art, soft warm palette, cozy natural light, clean uncluttered background, generous negative space at the top for the title.",
    // Integrated typography (this is what Ideogram excels at)
    "INTEGRATED HAND-LETTERED TYPOGRAPHY baked into the composition — MODEST, COMPACT scale (never oversized):",
    `- The main title reads EXACTLY: "${input.title}"`,
    `- Rendered as a COMPACT arched playful hand-lettered logo across the top third,`,
    `  puffy rounded display lettering with thick dark outline, warm cream/yellow fill,`,
    `  subtle drop shadow, per-letter bounce. NO decorative sub-words, NO sparkle text, NO theme labels, NO fake letters mixed into ornaments — ornaments must be purely graphic (stars, dots, small shapes), never letter-shaped.`,
    `- The title block MUST occupy AT MOST 55% of the frame width and AT MOST 30% of the frame height. Break long titles onto 2-3 balanced lines so no line runs edge-to-edge. Never let a single word span more than 55% of the frame width — shrink the font before letting a letter approach the margin.`,
    `- Directly beneath, a smaller line reads EXACTLY: "${input.subtitle}"`,
    `  in soft rounded lowercase script, calm dark color, single line, at most 45% of the frame width.`,
    `- A small round badge in a lower corner reads EXACTLY: "${input.ageBadge}"`,
    `  puffy sticker style, warm color-block, clearly legible, diameter AT MOST 14% of the frame width, fully inside the safe area, not clipped by the edge.`,
    `SPELLING CONTRACT — every visible glyph must spell one of the exact approved strings above, letter-for-letter. The title MUST read exactly "${input.title}" — count the letters and check twice. Do NOT invent, drop, duplicate, transpose, hyphenate, split, join, or append any letter (no "Bookl", "Colorng", "Book-Fname", "Kdis", etc.). If a letter cannot be rendered cleanly, RE-RENDER it — never approximate.`,
    "STRICT TEXT CONTRACT — render ONLY the exact approved title and subtitle (and age-badge) text listed above. NO additional words, labels, banners, captions, taglines, credits, publisher names, page-count numbers, price tags, decorative headline chrome (e.g. \"COLORING BOOK\", \"FUN!\", \"NEW\", \"LOVE\", \"YAY\", \"WOW\", \"ROAR\"), watermarks, sound-effect words, signatures, character-name captions, or ANY letter-shaped ornament of any kind may appear anywhere in the image.",
    "If uncertain, LEAVE A WORD OUT rather than invent one. Only the three approved text elements above may appear anywhere in the image. Every ornament must be a pure graphic shape (star, dot, leaf, paw-print) — never a letter, glyph, or word-like scribble.",

    // SAFE-AREA RULE (tightened 2026-07-17: covers were still clipping title strokes and age badges).
    "SAFE-AREA RULE — every letter, glyph, stroke, ornament AND the age-badge circle MUST sit entirely inside the central 78% of the frame (i.e. leave an 11% clear margin on every side). Nothing text-like may touch or overlap that outer 11% band. Prefer to SHRINK the title and badge rather than push them toward the edge.",
    "Hero subjects must also stay inside the central 86% of the frame — no animal or character may be cropped by the edge. Prefer fewer, smaller heroes with room to breathe over a crowded edge-to-edge group.",
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

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER ROUTING — Ideogram 3.0 via Runware.
//
// The direct fal.ai path (`fal-ai/ideogram/v3`, keyed by FAL_KEY) is retired
// as the default. Fal's Ideogram sits on a separately-billed account whose
// silent exhaustion caused today's `ideogram_only_park:provider_billing_exhausted`
// class of stall. Runware aggregates the same Ideogram 3.0 model under AIR id
// `ideogram:4@1` and shares the funded RUNWARE_API_KEY that already powers
// interior generation — one funded path for every image the coloring lane
// makes.
//
// The fal path remains as a strictly LAST-RESORT emergency override, gated on
// the `COLORING_COVER_ALLOW_FAL_IDEOGRAM=1` env flag. It is off by default and
// stays off unless the owner deliberately re-enables it.
// ─────────────────────────────────────────────────────────────────────────────

const RUNWARE_API_KEY = Deno.env.get("RUNWARE_API_KEY");
const ALLOW_FAL_FALLBACK = (Deno.env.get("COLORING_COVER_ALLOW_FAL_IDEOGRAM") ?? "0") === "1";
const RUNWARE_IDEOGRAM_MODEL = "ideogram:4@1"; // Ideogram 3.0 text-to-image
// Ideogram 3.0 on Runware only accepts a fixed grid of portrait dimensions.
// 832x1088 is the closest ~3:4 portrait that the endpoint actually honors
// (smoke-tested; the 864x1152 combo advertised in the docs is rejected).
const RUNWARE_IDEOGRAM_WIDTH = 832;
const RUNWARE_IDEOGRAM_HEIGHT = 1088;

async function generateViaRunware(
  request: IdeogramCoverRequest,
  opts: { timeoutMs?: number; seed?: number },
): Promise<IdeogramCoverResult> {
  if (!RUNWARE_API_KEY) throw new Error("provider_unconfigured:RUNWARE_API_KEY_missing");
  const prompt = buildIdeogramIntegratedCoverPrompt(request);
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const taskUUID = (crypto as any)?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const refs = (request.referenceImageURLs ?? []).filter(Boolean).slice(0, 3);
  const task = {
    taskType: "imageInference",
    taskUUID,
    positivePrompt: prompt.slice(0, 3000),
    model: RUNWARE_IDEOGRAM_MODEL,
    width: RUNWARE_IDEOGRAM_WIDTH,
    height: RUNWARE_IDEOGRAM_HEIGHT,
    numberResults: 1,
    outputType: ["URL"],
    outputFormat: "JPEG",
    includeCost: true,
    ...(refs.length > 0 ? { referenceImages: refs } : {}),
    ...(opts.seed != null ? { seed: opts.seed } : {}),
  };
  try {
    const safeTask = coerceForProviderPayload(task, "runware_ideogram_cover");
    const res = await fetch("https://api.runware.ai/v1", {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${RUNWARE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify([safeTask]),
    });
    const bodyText = await res.text();
    if (!res.ok) {
      // 402/insufficient-credit style responses → billing exhausted
      if (res.status === 402 || /balance|credit|insufficient|billing|payment required/i.test(bodyText)) {
        throw new Error(`provider_billing_exhausted:runware_ideogram:${bodyText.slice(0, 200)}`);
      }
      throw new Error(`runware_ideogram_http_${res.status}:${bodyText.slice(0, 300)}`);
    }
    // deno-lint-ignore no-explicit-any
    let j: any;
    try { j = JSON.parse(bodyText); }
    catch { throw new Error(`runware_ideogram_non_json:${bodyText.slice(0, 200)}`); }
    if (Array.isArray(j?.errors) && j.errors.length > 0) {
      const msg = j.errors.map((e: any) => e.message || e.code || JSON.stringify(e)).join("; ");
      if (/balance|credit|insufficient|billing|payment/i.test(msg)) {
        throw new Error(`provider_billing_exhausted:runware_ideogram:${msg.slice(0, 200)}`);
      }
      throw new Error(`runware_ideogram_errors:${msg.slice(0, 300)}`);
    }
    const first = (j?.data ?? [])[0];
    if (!first?.imageURL) throw new Error(`runware_ideogram_no_image:${bodyText.slice(0, 200)}`);
    const imgRes = await fetch(first.imageURL);
    if (!imgRes.ok) throw new Error(`runware_ideogram_download_http_${imgRes.status}`);
    const bytes = new Uint8Array(await imgRes.arrayBuffer());

    // Best-effort cost logging — runware billing lives in the same key so
    // this shows up in the same cost_log stream as interior generation.
    try {
      const { logAiCost, costDb } = await import("../cost-log.ts");
      logAiCost(costDb(), {
        ebook_id: (request as any).ebook_id,
        step: "coloring_cover_ideogram",
        model: RUNWARE_IDEOGRAM_MODEL,
        images: 1,
        cost_usd: Number(first.cost ?? 0) || 0,
        provider: "runware_ideogram_cover",
      });
    } catch (_e) { /* non-fatal */ }

    return {
      bytes,
      provider: "fal_ideogram_v3", // kept for scorecard back-compat; actual host is runware
      prompt,
      seed: first?.seed ?? opts.seed,
      request_id: taskUUID,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function generateViaFalEmergency(
  request: IdeogramCoverRequest,
  opts: { timeoutMs?: number; seed?: number },
): Promise<IdeogramCoverResult> {
  if (!FAL_KEY) throw new Error("provider_unconfigured:FAL_KEY_missing");
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const prompt = buildIdeogramIntegratedCoverPrompt(request);
  const body = {
    prompt, aspect_ratio: "3:4", rendering_speed: "BALANCED", style: "AUTO",
    expand_prompt: false, num_images: 1,
    ...(opts.seed != null ? { seed: opts.seed } : {}),
  };
  const submitRes = await fetch("https://queue.fal.run/fal-ai/ideogram/v3", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Key ${FAL_KEY}` },
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
    bytes, provider: "fal_ideogram_v3", prompt,
    seed: completed?.seed ?? opts.seed, request_id: queue.request_id ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GPT IMAGE (OpenAI-direct) — Tier-1 cover model as of 2026-07-18.
//
// Owner order 2026-07-18: gpt-image-1 tested 3/3 on complex titles at ~$0.04/img
// (33% cheaper than Ideogram at $0.06). Promoted to Tier-1 with automatic
// fallback to Runware/Ideogram if the rolling pass-rate on real books drops
// below 75% over ≥20 attempts (pickCoverPrimaryProvider). Same prompt is fed
// to both models so results are directly comparable.
// ─────────────────────────────────────────────────────────────────────────────

async function generateViaGptImage(
  request: IdeogramCoverRequest,
  opts: { timeoutMs?: number },
): Promise<IdeogramCoverResult> {
  if (!hasOpenAIDirect()) throw new Error("provider_unconfigured:OPENAI_API_KEY_missing");
  const prompt = buildIdeogramIntegratedCoverPrompt(request);
  // NOTE: gpt-image-1 does not accept `referenceImageURLs` via /v1/images/generations.
  // Character continuity comes from the prompt's CHARACTER CONTINUITY clause,
  // which already describes the interior cast in text form. If the rolling
  // pass-rate on continuity drops, the auto-degrade to Ideogram (which does
  // accept refs) takes over.
  const { bytes, model } = await openaiDirectImage({
    prompt: prompt.slice(0, 3000),
    model: "gpt-image-1",
    size: "1024x1536",
    quality: "medium",
    timeoutMs: opts.timeoutMs ?? 90_000,
  });
  try {
    const { logAiCost, costDb } = await import("../cost-log.ts");
    logAiCost(costDb(), {
      ebook_id: (request as any).ebook_id,
      step: "coloring_cover_gpt_image",
      model: `openai/${model}`,
      images: 1,
      cost_usd: GPT_IMAGE_COVER_COST_USD,
      provider: "openai_gpt_image_cover",
    });
  } catch (_e) { /* non-fatal */ }
  return { bytes, provider: "openai_gpt_image_1", prompt, seed: undefined, request_id: null };
}

export async function generateIdeogramIntegratedCover(
  request: IdeogramCoverRequest,
  opts: { timeoutMs?: number; seed?: number; db?: any; preferProvider?: "gpt_image" | "ideogram" } = {},
): Promise<IdeogramCoverResult> {
  // Tier-1 selection: consult recent pass-rate stats unless the caller
  // pinned a specific provider (e.g. retry after the primary just failed).
  const decision = opts.preferProvider
    ? { primary: opts.preferProvider, reason: "caller_pinned", sample: 0, pass_rate: null }
    : await pickCoverPrimaryProvider(opts.db);

  const tryGpt = async () => generateViaGptImage(request, { timeoutMs: opts.timeoutMs });
  const tryIdeogram = async () => generateViaRunware(request, opts);

  if (decision.primary === "gpt_image") {
    try {
      return await tryGpt();
    } catch (e: any) {
      console.warn(`[cover] gpt-image-1 primary failed (${decision.reason}): ${String(e?.message ?? e).slice(0, 200)} — falling back to Ideogram/Runware`);
      // Fall through to Ideogram.
    }
  }

  // Ideogram path (either the picked primary, or the fallback from GPT Image).
  try {
    return await tryIdeogram();
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const runwareBillingExhausted = /provider_billing_exhausted/.test(msg);
    // Last-resort: if we haven't tried GPT Image yet AND we have the key,
    // try it before giving up.
    if (decision.primary === "ideogram" && hasOpenAIDirect() && !DISABLE_GPT_IMAGE) {
      try { return await tryGpt(); } catch (ge: any) {
        throw new Error(`${msg} | gpt_image_fallback_also_failed:${String(ge?.message ?? ge).slice(0, 160)}`);
      }
    }
    if (!ALLOW_FAL_FALLBACK || runwareBillingExhausted) throw e;
    try {
      return await generateViaFalEmergency(request, opts);
    } catch (fe: any) {
      throw new Error(`${msg} | fal_fallback_also_failed:${String(fe?.message ?? fe).slice(0, 160)}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// INPAINT-ONLY TEXT RETRY (owner order 2026-07-17)
//
// On a `text_rejected` failure, re-rolling the WHOLE cover from scratch throws
// away artwork that already passed category/hero/uniqueness checks and pays
// full price ($0.06) for a fresh gamble. Instead, mask ONLY the text regions
// (top ~40% band where the title/subtitle live, plus the bottom-left age
// badge) and let Ideogram re-render just those pixels on top of the prior
// accepted base image. Character/scene continuity is preserved by construction.
//
// Runware imageInference supports `seedImage` + `maskImage` for inpainting;
// white pixels in the mask = regenerate, black = keep. Ideogram 3.0 (AIR id
// `ideogram:4@1`) supports this path.
// ─────────────────────────────────────────────────────────────────────────────

import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

async function buildTextRegionMaskPng(width: number, height: number): Promise<Uint8Array> {
  const img = new Image(width, height);
  // ImageScript setPixelAt expects an unsigned 32-bit *Number* RGBA packed
  // color. NEVER pass a BigInt literal (0x...n) — the library does numeric
  // bitwise ops on the input and Deno throws "Cannot convert a BigInt value
  // to a number". Use `>>> 0` to force an unsigned Number.
  const BLACK = (0x000000ff) >>> 0;      // keep
  const WHITE = (0xffffffff) >>> 0;      // regenerate
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) img.setPixelAt(x + 1, y + 1, BLACK);
  }
  const topBand = Math.floor(height * 0.4);
  for (let y = 0; y < topBand; y++) {
    for (let x = 0; x < width; x++) img.setPixelAt(x + 1, y + 1, WHITE);
  }
  const badgeR = Math.floor(Math.min(width, height) * 0.14);
  const cx = Math.floor(width * 0.18);
  const cy = Math.floor(height * 0.86);
  for (let y = Math.max(0, cy - badgeR); y < Math.min(height, cy + badgeR); y++) {
    for (let x = Math.max(0, cx - badgeR); x < Math.min(width, cx + badgeR); x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= badgeR * badgeR) img.setPixelAt(x + 1, y + 1, WHITE);
    }
  }
  return await img.encode();
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export interface IdeogramInpaintRequest extends IdeogramCoverRequest {
  baseImageBytes: Uint8Array;
}

export async function generateIdeogramTextInpaint(
  request: IdeogramInpaintRequest,
  opts: { timeoutMs?: number; seed?: number } = {},
): Promise<IdeogramCoverResult> {
  if (!RUNWARE_API_KEY) throw new Error("provider_unconfigured:RUNWARE_API_KEY_missing");
  const prompt = buildIdeogramIntegratedCoverPrompt(request);
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const taskUUID = (crypto as any)?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // Ensure the base image matches the Ideogram grid (832x1088).
  const decoded = await Image.decode(request.baseImageBytes);
  let baseBytes = request.baseImageBytes;
  if (decoded.width !== RUNWARE_IDEOGRAM_WIDTH || decoded.height !== RUNWARE_IDEOGRAM_HEIGHT) {
    decoded.resize(RUNWARE_IDEOGRAM_WIDTH, RUNWARE_IDEOGRAM_HEIGHT);
    baseBytes = await decoded.encode();
  }
  const maskBytes = await buildTextRegionMaskPng(RUNWARE_IDEOGRAM_WIDTH, RUNWARE_IDEOGRAM_HEIGHT);

  const task = {
    taskType: "imageInference",
    taskUUID,
    positivePrompt: prompt.slice(0, 3000),
    model: RUNWARE_IDEOGRAM_MODEL,
    width: RUNWARE_IDEOGRAM_WIDTH,
    height: RUNWARE_IDEOGRAM_HEIGHT,
    numberResults: 1,
    outputType: ["URL"],
    outputFormat: "JPEG",
    includeCost: true,
    seedImage: `data:image/png;base64,${toBase64(baseBytes)}`,
    maskImage: `data:image/png;base64,${toBase64(maskBytes)}`,
    strength: 0.95,
    ...(opts.seed != null ? { seed: opts.seed } : {}),
  };
  try {
    const res = await fetch("https://api.runware.ai/v1", {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${RUNWARE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify([task]),
    });
    const bodyText = await res.text();
    if (!res.ok) {
      if (res.status === 402 || /balance|credit|insufficient|billing|payment required/i.test(bodyText)) {
        throw new Error(`provider_billing_exhausted:runware_ideogram_inpaint:${bodyText.slice(0, 200)}`);
      }
      throw new Error(`runware_ideogram_inpaint_http_${res.status}:${bodyText.slice(0, 300)}`);
    }
    let j: any;
    try { j = JSON.parse(bodyText); }
    catch { throw new Error(`runware_ideogram_inpaint_non_json:${bodyText.slice(0, 200)}`); }
    if (Array.isArray(j?.errors) && j.errors.length > 0) {
      const msg = j.errors.map((e: any) => e.message || e.code || JSON.stringify(e)).join("; ");
      throw new Error(`runware_ideogram_inpaint_errors:${msg.slice(0, 300)}`);
    }
    const first = (j?.data ?? [])[0];
    if (!first?.imageURL) throw new Error(`runware_ideogram_inpaint_no_image:${bodyText.slice(0, 200)}`);
    const imgRes = await fetch(first.imageURL);
    if (!imgRes.ok) throw new Error(`runware_ideogram_inpaint_download_http_${imgRes.status}`);
    const bytes = new Uint8Array(await imgRes.arrayBuffer());
    try {
      const { logAiCost, costDb } = await import("../cost-log.ts");
      logAiCost(costDb(), {
        ebook_id: (request as any).ebook_id,
        step: "coloring_cover_ideogram_inpaint",
        model: RUNWARE_IDEOGRAM_MODEL,
        images: 1,
        cost_usd: Number(first.cost ?? 0) || 0,
        provider: "runware_ideogram_cover_inpaint",
      });
    } catch (_e) { /* non-fatal */ }
    return {
      bytes,
      provider: "fal_ideogram_v3",
      prompt,
      seed: first?.seed ?? opts.seed,
      request_id: taskUUID,
    };
  } finally {
    clearTimeout(timer);
  }
}

