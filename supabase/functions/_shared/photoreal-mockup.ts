// Photoreal book mockup: takes a flat cover face PNG (bytes) and asks
// Gemini 3 Pro Image (via Lovable AI Gateway) to place it as-is onto a
// realistic hardcover book on a white/off-white studio background.

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

export interface PhotorealResult {
  bytes: Uint8Array;
  model: string;
  prompt: string;
}

const BASE_PROMPT = `Take the provided flat book cover artwork and place it EXACTLY as-is onto the front cover of a premium hardcover book, then photograph it as a realistic ecommerce product photo.

BOOK GEOMETRY — STRICT:
- Cover aspect ratio LOCKED to 1:1.5 (standard trade hardcover, width:height). Do NOT stretch, elongate, or squash.
- Camera: straight-on front view, rotated approximately 12 degrees to the right around the vertical axis so the spine and page edge on the left side are just visible. Camera at cover-center height. No tilt, no fisheye, no exaggerated perspective, no foreshortening beyond that angle.
- Spine thickness: 6-8% of cover width. Visible page block on the right edge with realistic uniform paper layers.
- Cover corners square and equal. No warping, no barrel/pincushion distortion, no floating book.
- Book fills 82-90% of the frame height, centered.

COVER ARTWORK — STRICT:
- Reproduce the provided front-cover artwork PIXEL-FOR-PIXEL: every letter, badge, illustration, color, and layout. Do NOT crop, re-layout, translate, restyle, add, or remove any text or element on the front face. Every word from the source must be fully visible and readable — no clipping at any edge.

BACKGROUND & LIGHTING:
- Bright cool off-white studio background, hex approximately #f6f4ef. Clean, neutral, luminous. No warm cream, no beige, no tint.
- DISTINCT SOFT CONTACT SHADOW pooling directly beneath the base of the book, clearly visible, fading outward, so the book is grounded on the surface.
- Crisp bright studio lighting, matte cover texture, subtle bevels, tack-sharp focus.

NEGATIVES: no stretched or elongated book, no tall narrow proportions, no warped cover, no fisheye, no exaggerated perspective, no floating book, no dark or warm-cream background, no added text/watermark/logo/price/sticker/UI, no flat poster or vector template look, no cartoon.`;

const REPAIR_HINTS: Record<string, string> = {
  too_small: " The book must be LARGE — fill at least 84% of the frame height. Zoom in.",
  dark_bg: " Background MUST be bright cool off-white #f6f4ef — not warm cream, not beige, not tinted. Neutral and luminous.",
  distorted_text: " Preserve the cover artwork EXACTLY. Do not regenerate any text. Every word must be fully visible with no clipping.",
  flat: " Show real 3D depth — visible spine thickness (6-8% of cover width), page edge with uniform paper layers.",
  no_shadow: " Add a DISTINCT soft contact shadow pooling directly beneath the base of the book, clearly visible, fading outward. The book must look grounded on the surface.",
  distorted_geometry: " Book is stretched/warped. Enforce cover aspect ratio 1:1.5, square corners, ~12° rotation only, no fisheye, no foreshortening.",
  clipped_text: " Cover text is being cut off. Reproduce the provided artwork pixel-for-pixel with NO cropping; every word must be fully visible.",
};

export async function renderPhotorealMockup(
  coverFacePng: Uint8Array,
  opts: { attempt: number; repairReasons?: string[] } = { attempt: 0 },
): Promise<PhotorealResult> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw new Error("LOVABLE_API_KEY missing");

  const b64 = base64Encode(coverFacePng);
  const hints = (opts.repairReasons ?? []).map((r) => REPAIR_HINTS[r] ?? "").join("");
  const prompt = BASE_PROMPT + hints;

  const model = "google/gemini-3.1-flash-image";
  const body = {
    model,
    modalities: ["image", "text"],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
        ],
      },
    ],
  };

  const resp = await fetch(GATEWAY, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`gateway ${resp.status}: ${t.slice(0, 400)}`);
  }
  const json = await resp.json();
  // OpenRouter chat-completions image shape: choices[0].message.images[0].image_url.url (data URL)
  const choice = json?.choices?.[0]?.message;
  const dataUrl: string | undefined =
    choice?.images?.[0]?.image_url?.url ??
    choice?.images?.[0]?.url ??
    (Array.isArray(choice?.content)
      ? choice.content.find((c: any) => c?.type === "image_url")?.image_url?.url
      : undefined);
  if (!dataUrl || !dataUrl.startsWith("data:image")) {
    throw new Error(`no image in gateway response: ${JSON.stringify(json).slice(0, 500)}`);
  }
  const commaIdx = dataUrl.indexOf(",");
  const bytes = base64Decode(dataUrl.slice(commaIdx + 1));
  if (bytes.length < 10_000) throw new Error("mockup PNG suspiciously small");
  return { bytes, model, prompt };
}

function base64Encode(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

function base64Decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
