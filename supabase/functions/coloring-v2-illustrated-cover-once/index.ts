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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  try {
    const { book_id, ebook_id } = await req.json().catch(() => ({}));
    if (!book_id) return json({ error: "book_id required" }, 400);

    const book = await fetchBook(book_id);
    const title = ensureColoringBookInTitle(book.title ?? "Coloring Book");

    const prompt = [
      `Beautiful full-color hand-painted children's coloring-book COVER illustration for "${title}".`,
      `Square 1:1 composition, warm cheerful storybook style — think premium picture-book cover, gouache + watercolor feel, expressive, playful, high production value.`,
      `Depict a charming scene of friendly cartoon ocean creatures (bubbly cute fish, a smiling octopus, a little turtle, playful dolphins, coral, kelp, gentle sunbeams underwater) — polished, print-ready art.`,
      `The title "${title}" MUST appear as HAND-LETTERED PAINTED TYPOGRAPHY integrated INTO the artwork itself — drawn by the illustrator as part of the painting (bubble-letter or brushed-script style, playful, colorful, with soft shadow and highlight painted in). NOT a font overlay, NOT flat text — it must look painted by hand.`,
      `Place the title in the upper third of the cover, arced or on a soft painted ribbon that is part of the scene.`,
      `Do NOT include: any logo, any watermark, any URL, any age badge, any subtitle, any extra text besides the title, any UI element, any book mockup, any border/frame.`,
      `Spelling of the title MUST be exact.`,
    ].join(" ");

    const { bytes, model } = await openaiDirectImage({
      prompt,
      model: "gpt-image-1",
      size: "1024x1024",
      quality: "high",
      timeoutMs: 180_000,
    });
    if (!bytes || bytes.length < 20_000) {
      return json({ error: "empty_or_tiny_image", size: bytes?.length ?? 0 }, 500);
    }

    // Upload as PNG (gpt-image-1 returns PNG bytes).
    const asset = await uploadAsset(book_id, "cover_final", bytes, "png", {
      law: "cover_illustrated_hand_lettered_once_v1",
      provider: "openai_direct",
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
