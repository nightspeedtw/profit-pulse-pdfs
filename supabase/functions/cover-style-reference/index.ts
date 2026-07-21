// Manages the "master style reference" image the cover generator mimics.
// GET  -> return the active reference (palette/lighting/layout) + all rows
// POST -> upload a new image, extract style tokens via Gemini vision, activate
import { corsHeaders, admin, requireAdmin } from "../_shared/ai.ts";
import "../_shared/gateway-guard.ts";

const BUCKET = "cover-style-refs";

async function extractStyle(imageDataUrl: string) {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return {};
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-pro",
      messages: [
        { role: "system", content: "You are an elite art director. Return VALID JSON ONLY with keys: palette (array of 4-6 hex colors, dominant→accent), lighting (one detailed sentence: direction, mood, shadow quality, background finish), layout_notes (one paragraph: composition, badge/title/subtitle/icons/spine/ground surface), style_summary (one paragraph that another designer could follow to reproduce the aesthetic on different books). No prose outside JSON." },
        { role: "user", content: [
          { type: "text", text: "Analyze this book cover reference and extract the style so another AI can reproduce this look on different books." },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ] },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`style extract ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const text = j.choices?.[0]?.message?.content ?? "{}";
  try { return JSON.parse(text); } catch { return {}; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const db = admin();

  try {
    await requireAdmin(req);
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  if (req.method === "GET") {
    const { data: rows } = await db.from("cover_style_reference").select("*").order("created_at", { ascending: false });
    return new Response(JSON.stringify({ references: rows ?? [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  if (req.method === "POST") {
    const body = await req.json();
    const action = body.action ?? "upload";

    if (action === "activate") {
      await db.from("cover_style_reference").update({ is_active: false }).eq("is_active", true);
      const { error } = await db.from("cover_style_reference").update({ is_active: true }).eq("id", body.id);
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "delete") {
      const { data: row } = await db.from("cover_style_reference").select("storage_path").eq("id", body.id).maybeSingle();
      if (row?.storage_path) await db.storage.from(BUCKET).remove([row.storage_path]);
      await db.from("cover_style_reference").delete().eq("id", body.id);
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // upload
    const name: string = body.name ?? "Reference";
    const imageBase64: string = body.image_base64;
    const mime: string = body.mime ?? "image/jpeg";
    if (!imageBase64) return new Response(JSON.stringify({ error: "image_base64 required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const bytes = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0));
    const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
    const path = `${crypto.randomUUID()}.${ext}`;
    const up = await db.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
    if (up.error) return new Response(JSON.stringify({ error: up.error.message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const signed = await db.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 365);
    const url = signed.data?.signedUrl ?? "";

    // Extract style
    const dataUrl = `data:${mime};base64,${imageBase64}`;
    let style: any = {};
    try { style = await extractStyle(dataUrl); } catch (e) { console.warn("style extract failed", e); }

    await db.from("cover_style_reference").update({ is_active: false }).eq("is_active", true);
    const { data: inserted, error } = await db.from("cover_style_reference").insert({
      name,
      image_url: url,
      storage_path: path,
      palette: Array.isArray(style?.palette) ? style.palette : [],
      lighting: style?.lighting ?? null,
      layout_notes: style?.layout_notes ?? null,
      style_summary: style?.style_summary ?? null,
      is_active: true,
    }).select().single();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    return new Response(JSON.stringify({ ok: true, reference: inserted }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  return new Response("Method not allowed", { status: 405, headers: corsHeaders });
});
