import { corsHeaders, admin, logCost, requireAdmin } from "../_shared/ai.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await requireAdmin(req);
    const db = admin();
    const { ebook_id } = await req.json();
    if (!ebook_id) throw new Error("ebook_id required");
    const { data: e } = await db.from("ebooks").select("*").eq("id", ebook_id).single();
    if (!e) throw new Error("Ebook not found");
    if (e.status === "qc_failed") throw new Error("Cannot generate cover for failed QC. Re-run QC first.");

    const prompt = e.cover_prompt ?? `Premium ebook cover for "${e.title}". Editorial, minimalist, high-contrast typography overlay area at top, no text rendered. Bold, modern composition.`;
    const key = Deno.env.get("LOVABLE_API_KEY");
    if (!key) throw new Error("LOVABLE_API_KEY not configured");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-pro-image",
        prompt: `${prompt}\n\nNo text, no words, no letters in the image. Vertical book cover aspect 2:3, premium production quality.`,
        size: "1024x1536",
      }),
    });
    if (!res.ok) throw new Error(`Image gen ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = await res.json();
    const b64: string = j.data?.[0]?.b64_json;
    if (!b64) throw new Error("No image returned");

    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const path = `${ebook_id}/cover.png`;
    const { error: upErr } = await db.storage.from("ebook-covers").upload(path, bytes, {
      contentType: "image/png", upsert: true,
    });
    if (upErr) throw upErr;
    const { data: signed } = await db.storage.from("ebook-covers").createSignedUrl(path, 60 * 60 * 24 * 365);

    // Cover cost approximated
    const cost = 0.04;
    await logCost(db, { ebook_id, step: "cover", model: "google/gemini-3-pro-image", input_tokens: 0, output_tokens: 0, cost_usd: cost });
    await db.from("ebooks").update({ cover_url: signed?.signedUrl, cost_usd: Number(e.cost_usd) + cost }).eq("id", ebook_id);

    return new Response(JSON.stringify({ cover_url: signed?.signedUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
