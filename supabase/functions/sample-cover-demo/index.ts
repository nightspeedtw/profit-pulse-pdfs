// One-shot admin demo: generate a premium KDP-bestseller-quality cover via
// Runware Ideogram 3.0 and upload to ebook-covers/samples/. Returns a signed
// URL the owner can open in the browser to judge the quality bar.
//
// Not part of the pipeline. Not gated. GET or POST.

import { createClient } from "npm:@supabase/supabase-js@2";

const RUNWARE_ENDPOINT = "https://api.runware.ai/v1";
const IDEOGRAM = "ideogram:4@1";

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const theme = url.searchParams.get("theme") ?? "space";
    const title = url.searchParams.get("title") ??
      (theme === "space"
        ? "AMAZING EARTH & SPACE"
        : theme === "teen"
          ? "NEON CITY RUNNERS"
          : "MAGICAL UNICORN WORLD");
    const ages = url.searchParams.get("ages") ?? "8-12";

    const spacePrompt = `Professional Amazon KDP BESTSELLER children's coloring book cover, 8.5x8.5 square format.
ONE clear focal hero: a smiling young astronaut kid in a shiny white spacesuit with clear helmet, floating triumphantly in the foreground, arms raised, RICH SATURATED full color, polished 3D-rendered painterly illustration (Pixar/DreamWorks quality), soft global illumination, dramatic cinematic rim lighting.
Deep atmospheric themed background: swirling colorful nebula galaxy, planet Earth glowing blue-and-green on the left, cartoon rocket ship trailing sparkles on the right, twinkling stars, aurora colors (magenta, cyan, gold).
Top of cover: giant bold multi-color rounded display title "AMAZING EARTH & SPACE" (two lines, hot pink + electric blue letters, thick white outline, drop shadow, playful children's book typography — spelling must be EXACT, no gibberish, no duplicate letters). Below title, smaller subtitle: "COLORING ADVENTURE".
Bottom-left corner: bright yellow circular age badge that says "AGES ${ages}" in bold black.
Top-right corner: red diagonal ribbon that says "SALE".
Glossy premium finish, high detail, vibrant color grading, no watermark, no signature, no extra text anywhere else on the cover. Cinematic depth of field.`;

    const teenPrompt = `Cinematic YA graphic-novel key art cover, 8.5x8.5 square format, professional Amazon KDP bestseller quality.
ONE focal hero: a stylized semi-realistic anime teenage runner in a hooded jacket sprinting across a rain-slicked neon city street, dynamic action pose, motion blur trailing behind, dramatic rim lighting from magenta and cyan neon signs.
Background: futuristic Tokyo/Blade-Runner cityscape at night, glowing skyscrapers, holographic billboards, rain streaks, lightning in the clouds, deep atmospheric depth, teal-and-magenta color grading.
Top of cover: bold uppercase graphic-novel title "NEON CITY RUNNERS" in chrome metallic letters with electric-blue glow outline (spelling must be EXACT, no gibberish).
Bottom-left: matte black age badge "AGES 13-17" in white.
Top-right: red diagonal ribbon "SALE" in white.
High detail, painterly rendering, no watermark, no signature, no extra text.`;

    const unicornPrompt = `Professional Amazon KDP BESTSELLER children's coloring book cover, 8.5x8.5 square format.
ONE focal hero: a sparkling rainbow-maned unicorn with big friendly eyes, standing proudly on a flower meadow, RICH SATURATED full color, polished 3D-rendered painterly illustration (Pixar quality), soft magical lighting.
Deep dreamy background: pastel rainbow sky, floating hearts, glittering stars, distant crystal castle, cotton-candy clouds.
Top of cover: giant bold multi-color rounded display title "MAGICAL UNICORN WORLD" (hot pink + purple letters, thick white outline, drop shadow, playful children's book typography — spelling EXACT, no gibberish).
Bottom-left circular badge "AGES 4-8" bright yellow with bold black text.
Top-right red diagonal "SALE" ribbon.
Glossy premium finish, high detail, no watermark, no extra text.`;

    const prompt = theme === "teen" ? teenPrompt
                 : theme === "unicorn" ? unicornPrompt
                 : spacePrompt;

    const key = Deno.env.get("RUNWARE_API_KEY");
    if (!key) return json({ error: "RUNWARE_API_KEY missing" }, 500);

    const task = {
      taskType: "imageInference",
      taskUUID: crypto.randomUUID(),
      positivePrompt: prompt,
      negativePrompt: "gibberish text, misspelled letters, duplicate letters, extra logos, watermark, signature, extra text blocks, flat line art, uncolored, black and white, coloring page, blurry, low quality, deformed hands, extra limbs",
      model: IDEOGRAM,
      width: 1024,
      height: 1024,
      numberResults: 1,
      outputType: ["base64Data"],
      outputFormat: "JPEG",
      includeCost: true,
    };

    const started = Date.now();
    const res = await fetch(RUNWARE_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify([task]),
    });
    const body = await res.text();
    if (!res.ok) return json({ error: `runware ${res.status}`, body: body.slice(0, 500) }, 502);
    const parsed = JSON.parse(body);
    if (Array.isArray(parsed?.errors) && parsed.errors.length) {
      return json({ error: "runware errors", details: parsed.errors }, 502);
    }
    const first = parsed?.data?.[0];
    if (!first?.imageBase64Data) return json({ error: "no image", raw: body.slice(0, 500) }, 502);

    const bin = atob(first.imageBase64Data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const path = `samples/${theme}-${Date.now()}.jpg`;
    const up = await sb.storage.from("ebook-covers").upload(path, bytes, {
      contentType: "image/jpeg", upsert: true,
    });
    if (up.error) return json({ error: "upload failed", details: up.error.message }, 500);
    const signed = await sb.storage.from("ebook-covers").createSignedUrl(path, 60 * 60 * 24 * 30);
    return json({
      ok: true, theme, title, ages, prompt_chars: prompt.length,
      cost_usd: first.cost ?? null, latency_ms: Date.now() - started,
      path, signed_url: signed.data?.signedUrl,
    });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o, null, 2), {
    status, headers: { "Content-Type": "application/json" },
  });
}
