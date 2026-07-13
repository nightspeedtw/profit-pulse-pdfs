// Kids interior illustration generator.
//
// Given a manuscript, character bible, style bible, and cover master URL,
// this module:
//   1. Splits the manuscript into N scene beats (>= 12 for high illustration
//      intensity picture books).
//   2. Builds a strict, style-locked prompt per scene that repeats the
//      invariant character description and style suffix on every call.
//   3. Renders each illustration via Fal (Flux Schnell for speed/consistency).
//   4. Uploads results to ebook-covers storage and returns a structured
//      records array suitable for persisting to
//      ebooks_kids.interior_illustrations.

import { falFluxSchnell } from "./fal.ts";

export interface SceneRecord {
  index: number;         // 1-based
  page_number: number;   // page in the final book (starts at 3 after cover+title)
  scene: string;         // one-sentence scene summary
  prompt: string;        // full prompt sent to the model
  url: string;           // signed URL of the uploaded PNG
  path: string;          // storage path
  model: string;         // model identifier
  bytes: number;         // asset size
  hash: string;          // sha-256 hex of bytes
}

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

async function callGemini(prompt: string, system: string): Promise<string> {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
    },
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
    // Fallback: pad by splitting the manuscript deterministically.
    const paras = opts.manuscript_md.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
    const chunkSize = Math.max(1, Math.ceil(paras.length / target));
    parsed.scenes = [];
    for (let i = 0; i < target; i++) {
      const chunk = paras.slice(i * chunkSize, (i + 1) * chunkSize).join(" ");
      parsed.scenes.push({
        scene: chunk.slice(0, 240) || `Story beat ${i + 1}`,
        emotion: "warm",
        setting: "storybook world",
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
  characterDescription: string;   // e.g. "small brown owl named Luna wearing a blue scarf"
  styleSuffix: string;            // shared style directive locked from the style bible
  negativePrompt: string;
  scenes: ScenePlan["scenes"];
  startPageNumber: number;        // page in the final PDF where interior begins
}

export async function renderInteriorIllustrations(opts: RenderInteriorOpts): Promise<SceneRecord[]> {
  const records: SceneRecord[] = [];
  for (let i = 0; i < opts.scenes.length; i++) {
    const s = opts.scenes[i];
    const prompt = [
      `Whimsical illustrated children's picture book interior illustration.`,
      `Hero character (must remain visually identical every page): ${opts.characterDescription}.`,
      `Scene: ${s.scene}`,
      `Setting: ${s.setting}. Emotional beat: ${s.emotion}.`,
      `Composition: character clearly visible, warm painterly lighting, cozy storybook mood, generous negative space at the bottom for caption text.`,
      `Style lock (do not deviate): ${opts.styleSuffix}.`,
      `ABSOLUTELY NO TEXT of any kind — no letters, no words, no captions, no speech bubbles.`,
      `Avoid AI clichés: no six-finger hands, no melted faces, no glossy 3d blobs, no stock photography look.`,
    ].join(" ").slice(0, 1900);

    const bytes = await falFluxSchnell({
      prompt,
      image_size: "landscape_4_3",
      negative_prompt: `${opts.negativePrompt}, text, letters, words, caption, watermark, logo, deformed hands, six fingers, extra fingers, off-model character`,
    });
    const hash = await sha256Hex(bytes);
    const path = `kids/${opts.ebookId}/interior/page-${String(i + 1).padStart(2, "0")}.png`;
    const up = await opts.db.storage.from("ebook-covers").upload(path, bytes, {
      contentType: "image/png", upsert: true,
    });
    if (up.error) throw up.error;
    const { data: signed } = await opts.db.storage.from("ebook-covers")
      .createSignedUrl(path, 60 * 60 * 24 * 365);
    if (!signed?.signedUrl) throw new Error(`no signed url for ${path}`);
    records.push({
      index: i + 1,
      page_number: opts.startPageNumber + i,
      scene: s.scene,
      prompt,
      url: signed.signedUrl,
      path,
      model: "fal-ai/flux/schnell",
      bytes: bytes.length,
      hash,
    });
  }
  return records;
}
