// coloring-cancel-queued — cancels queued coloring books.
// Body: { ebook_id?: string, all?: boolean, passcode?: string }
//  - ebook_id: cancel one specific row (must be queued + coloring_book)
//  - all: true → cancel every queued coloring row

// @ts-nocheck
import { corsHeaders as baseCors } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

declare const Deno: any;

const corsHeaders = {
  ...baseCors,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-passcode",
};

const PASSCODE = Deno.env.get("ADMIN_PASSCODE") ?? "453451";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const supplied = req.headers.get("x-admin-passcode") ?? body?.passcode ?? "";
    if (supplied !== PASSCODE) return json({ error: "unauthenticated" }, 401);

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    let q = db.from("ebooks_kids")
      .update({ pipeline_status: "cancelled" })
      .eq("book_type", "coloring_book")
      .eq("pipeline_status", "queued");
    if (body.ebook_id) q = q.eq("id", body.ebook_id);
    else if (!body.all) return json({ error: "ebook_id or all=true required" }, 400);

    const { data, error } = await q.select("id");
    if (error) throw error;
    return json({ ok: true, cancelled: data?.length ?? 0, ids: (data ?? []).map((r: any) => r.id) });
  } catch (e: any) {
    return json({ error: e?.message ?? String(e) }, 500);
  }
});

function json(x: unknown, status = 200) {
  return new Response(JSON.stringify(x), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
