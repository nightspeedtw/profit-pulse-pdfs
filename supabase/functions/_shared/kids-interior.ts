// Kids interior illustration generator.
//
// Strategy:
//   A. Reference-conditioned (preferred): if a coverReferenceUrl is supplied,
//      call Lovable AI Gateway's Gemini image model with the cover pinned to
//      every spread call so Luna + palette + line quality lock across pages.
//   B. Text-only fallback: if reference conditioning is unavailable or fails,
//      fall back to Fal Flux Schnell using the same locked-style paragraph on
//      every call.
//
// Dedupe guard: after generation we compare sha256 of each spread's bytes.
// Any duplicate/collision triggers up to 2 reroll attempts per page (with
// added scene-specific detail and, for reference-conditioned, a small nudge
// in composition guidance).

import { falFluxSchnell } from "./fal.ts";
import { generateWithReference } from "./kids-image-gen.ts";

export interface SceneRecord {
  index: number;
  page_number: number;
  scene: string;
  prompt: string;
  url: string;
  path: string;
  model: string;
  bytes: number;
  hash: string;
}

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

async function callGemini(prompt: string, system: string): Promise<string> {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: `${system}\n\nCRITICAL: English only. JSON only. No markdown fences.` },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!r.ok) throw new Error(`gemini ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  return (j.choices?.[0]?.message?.content ?? "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface BuildScenePlanOpts {
  title: string;
  manuscript_md: string;
  min_scenes: number;
}
export interface ScenePlan {
  scenes: Array<{ scene: string; emotion: string; setting: string }>;
}

export async function buildScenePlan(opts: BuildScenePlanOpts): Promise<ScenePlan> {
  const target = Math.max(opts.min_scenes, 12);
  const raw = await callGemini(
    `Story title: "${opts.title}"
Story text:
"""
${opts.manuscript_md.slice(0, 8000)}
"""

Split this children's picture book into exactly ${target} illustration beats in reading order.
For each beat, describe: (a) what visually happens, (b) the emotional beat, (c) the setting.
Return JSON: {"scenes":[{"scene":"...","emotion":"...","setting":"..."}, ...]}
Return exactly ${target} scenes.`,
    "You are a picture book art director segmenting a story into illustration beats.",
  );
  const parsed = JSON.parse(raw) as ScenePlan;
  if (!Array.isArray(parsed.scenes) || parsed.scenes.length < target) {
    const paras = opts.manuscript_md.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
    const chunkSize = Math.max(1, Math.ceil(paras.length / target));
    parsed.scenes = [];
    for (let i = 0; i < target; i++) {
      const chunk = paras.slice(i * chunkSize, (i + 1) * chunkSize).join(" ");
      parsed.scenes.push({
        scene: chunk.slice(0, 240) || `Story beat ${i + 1}`,
        emotion: "warm", setting: "storybook world",
      });
    }
  }
  return parsed;
}

export interface RenderInteriorOpts {
  ebookId: string;
  db: {
    storage: {
      from: (bucket: string) => {
        upload: (path: string, data: Uint8Array, opts?: unknown) => Promise<{ error?: unknown }>;
        createSignedUrl: (path: string, expiresIn: number) => Promise<{ data: { signedUrl: string } | null }>;
      };
    };
  };
  characterDescription: string;
  styleSuffix: string;
  negativePrompt: string;
  scenes: ScenePlan["scenes"];
  startPageNumber: number;
  concurrency?: number;
  /** When set, use reference-conditioned Gemini image model with this cover
   *  URL pinned to every spread call. If the call fails, that page falls back
   *  to Fal Flux Schnell text-only. */
  coverReferenceUrl?: string | null;
  /** Optional additional reference (e.g. a locked Luna character sheet). */
  extraReferenceUrls?: string[];
}

function buildScenePrompt(
  s: ScenePlan["scenes"][number],
  charDesc: string,
  styleSuffix: string,
  extraNudge = "",
): string {
  return [
    `Whimsical illustrated children's picture book interior illustration.`,
    `Hero character (must remain visually identical to the attached reference on every page): ${charDesc}.`,
    `Scene: ${s.scene}`,
    `Setting: ${s.setting}. Emotional beat: ${s.emotion}.`,
    `Composition: character clearly visible, warm painterly lighting, cozy storybook mood, generous negative space at the bottom for caption text.`,
    `Style lock (do not deviate): ${styleSuffix}.`,
    `ABSOLUTELY NO TEXT of any kind — no letters, no words, no captions, no speech bubbles.`,
    `Avoid AI clichés: no six-finger hands, no melted faces, no glossy 3d blobs, no stock photography look.`,
    extraNudge,
  ].filter(Boolean).join(" ").slice(0, 1900);
}

async function renderOneReference(
  s: ScenePlan["scenes"][number],
  charDesc: string,
  styleSuffix: string,
  refs: string[],
  attempt: number,
): Promise<{ bytes: Uint8Array; model: string; prompt: string }> {
  const nudge = attempt > 0
    ? `Vary the camera angle, distance, and framing significantly from any previous page. Emphasize: ${s.scene}.`
    : "";
  const prompt = buildScenePrompt(s, charDesc, styleSuffix, nudge);
  const bytes = await generateWithReference({
    prompt, referenceUrls: refs, model: "google/gemini-3.1-flash-image",
  });
  return { bytes, model: "google/gemini-3.1-flash-image", prompt };
}

async function renderOneFal(
  s: ScenePlan["scenes"][number],
  charDesc: string,
  styleSuffix: string,
  negativePrompt: string,
  attempt: number,
): Promise<{ bytes: Uint8Array; model: string; prompt: string }> {
  const nudge = attempt > 0
    ? `Distinct composition ${attempt + 1}: unique camera angle and framing, unique background details for: ${s.scene}.`
    : "";
  const prompt = buildScenePrompt(s, charDesc, styleSuffix, nudge);
  const bytes = await falFluxSchnell({
    prompt, image_size: "landscape_4_3",
    negative_prompt: `${negativePrompt}, text, letters, words, caption, watermark, logo, deformed hands, six fingers, extra fingers, off-model character`,
  });
  return { bytes, model: "fal-ai/flux/schnell", prompt };
}

export async function renderInteriorIllustrations(opts: RenderInteriorOpts): Promise<SceneRecord[]> {
  const records: SceneRecord[] = new Array(opts.scenes.length);
  const conc = Math.max(1, Math.min(4, opts.concurrency ?? 3));
  let cursor = 0;

  const refs = opts.coverReferenceUrl
    ? [opts.coverReferenceUrl, ...(opts.extraReferenceUrls ?? [])]
    : [];
  const useReference = refs.length > 0;

  async function generateOne(i: number, attempt: number): Promise<{ bytes: Uint8Array; model: string; prompt: string }> {
    const s = opts.scenes[i];
    if (useReference) {
      try {
        return await renderOneReference(s, opts.characterDescription, opts.styleSuffix, refs, attempt);
      } catch (e) {
        console.warn(`ref-gen page ${i + 1} failed, falling back to fal:`, (e as Error).message);
        return await renderOneFal(s, opts.characterDescription, opts.styleSuffix, opts.negativePrompt, attempt);
      }
    }
    return await renderOneFal(s, opts.characterDescription, opts.styleSuffix, opts.negativePrompt, attempt);
  }

  async function persistOne(i: number, bytes: Uint8Array, model: string, prompt: string, hash: string) {
    const s = opts.scenes[i];
    const path = `kids/${opts.ebookId}/interior/page-${String(i + 1).padStart(2, "0")}.png`;
    const up = await opts.db.storage.from("ebook-covers").upload(path, bytes, {
      contentType: "image/png", upsert: true,
    });
    if (up.error) throw up.error;
    const { data: signed } = await opts.db.storage.from("ebook-covers").createSignedUrl(path, 60 * 60 * 24 * 365);
    if (!signed?.signedUrl) throw new Error(`no signed url for ${path}`);
    records[i] = {
      index: i + 1, page_number: opts.startPageNumber + i, scene: s.scene,
      prompt, url: signed.signedUrl, path, model, bytes: bytes.length, hash,
    };
  }

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= opts.scenes.length) return;
      let attempt = 0;
      // First pass — no dedupe yet, just generate.
      const first = await generateOne(i, attempt);
      const hash = await sha256Hex(first.bytes);
      await persistOne(i, first.bytes, first.model, first.prompt, hash);
    }
  }
  await Promise.all(Array.from({ length: conc }, () => worker()));

  // ---- Dedupe reroll pass ----
  // After all pages exist, detect any duplicate hashes and reroll those pages
  // up to 2 times each with progressively stronger scene-differentiating nudges.
  for (let round = 0; round < 2; round++) {
    const byHash: Record<string, number[]> = {};
    for (const r of records) (byHash[r.hash] ??= []).push(r.index - 1);
    const dupIdxs: number[] = [];
    for (const idxs of Object.values(byHash)) {
      if (idxs.length > 1) {
        // Keep the first, reroll the rest.
        for (const i of idxs.slice(1)) dupIdxs.push(i);
      }
    }
    if (dupIdxs.length === 0) break;
    console.log(`dedupe round ${round + 1}: rerolling pages ${dupIdxs.map((i) => i + 1).join(",")}`);
    for (const i of dupIdxs) {
      try {
        const attempt = round + 1;
        const regen = await generateOne(i, attempt);
        const h = await sha256Hex(regen.bytes);
        await persistOne(i, regen.bytes, regen.model, regen.prompt, h);
      } catch (e) {
        console.warn(`dedupe reroll page ${i + 1} failed:`, (e as Error).message);
      }
    }
  }

  return records;
}
