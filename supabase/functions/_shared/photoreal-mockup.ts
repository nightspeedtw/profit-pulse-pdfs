// Photoreal book mockup: takes a flat cover face PNG (bytes) and asks
// Gemini 3 Pro Image (via Lovable AI Gateway) to place it as-is onto a
// realistic hardcover book on a white/off-white studio background.

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

export interface PhotorealResult {
  bytes: Uint8Array;
  model: string;
  prompt: string;
}

const BASE_PROMPT = `Take the provided flat book cover artwork and place it EXACTLY as-is onto the front cover of a premium hardcover book. Photograph the book as a realistic ecommerce product photo on a clean off-white studio background (#f4f1ea). Slight three-quarter angle so the spine and page edge are visible. Realistic paper thickness, matte cover texture, subtle bevels, crisp studio lighting, soft realistic drop shadow beneath the book. The book must fill 80-90% of the frame height, centered, tack-sharp focus. Absolutely do NOT alter, redraw, restyle, translate, add, or remove any text on the cover — preserve every letter, badge, illustration, and color of the provided artwork pixel-for-pixel on the front face. Do not add any additional text, watermark, logo, price tag, sticker, or UI. Do not use a dark background. Do not produce a flat poster, vector mockup, cartoon, or template look.`;

const REPAIR_HINTS: Record<string, string> = {
  too_small: " The book must be LARGE — fill at least 82% of the frame height. Zoom in.",
  dark_bg: " Background must be a bright clean off-white studio backdrop, not dark.",
  distorted_text: " Preserve the cover artwork EXACTLY. Do not regenerate the title text.",
  flat: " Show real 3D depth — visible spine thickness, page edge with paper layers, soft physical shadow.",
  no_shadow: " Add a soft realistic contact shadow directly beneath the book.",
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

  const model = "google/gemini-3-pro-image";
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
