// Backfill: translate any leftover Thai text in stored ebook content to English.
// Admin-only: caller must provide the service-role key or ADMIN_AUTH_BYPASS header.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-bypass",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const ADMIN_BYPASS = Deno.env.get("ADMIN_AUTH_BYPASS");

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
const THAI_RE = /[\u0E00-\u0E7F]/;

const SIMPLE_FIELDS = [
  "hook_description",
  "cliffhanger_hook",
  "short_hook",
  "selling_hook",
  "preview_blurb",
  "product_description",
  "long_description",
  "shopping_card_description",
  "meta_description",
  "seo_title",
  "seo_meta",
  "who_it_is_for",
  "title",
  "subtitle",
];

async function translate(text: string): Promise<string> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${LOVABLE_API_KEY}`,
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content:
            "You translate Thai text into natural, warm English suitable for a children's picture book product page. Preserve proper names (characters, places). Do not add commentary, quotes, or explanations. Return only the translated English text.",
        },
        { role: "user", content: text },
      ],
    }),
  });
  if (!res.ok) throw new Error(`AI ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return (j.choices?.[0]?.message?.content ?? "").trim();
}

async function maybeTranslate(v: unknown): Promise<{ changed: boolean; value: unknown }> {
  if (typeof v !== "string" || !THAI_RE.test(v)) return { changed: false, value: v };
  const out = await translate(v);
  return { changed: true, value: out };
}

// Walk a JSON structure and translate any string fields named text/caption/title that contain Thai.
async function translateJson(node: any): Promise<{ changed: boolean; value: any }> {
  if (node == null) return { changed: false, value: node };
  if (Array.isArray(node)) {
    let changed = false;
    const out = [] as any[];
    for (const item of node) {
      const r = await translateJson(item);
      changed = changed || r.changed;
      out.push(r.value);
    }
    return { changed, value: out };
  }
  if (typeof node === "object") {
    let changed = false;
    const out: any = { ...node };
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === "string" && THAI_RE.test(v)) {
        out[k] = await translate(v);
        changed = true;
      } else if (v && typeof v === "object") {
        const r = await translateJson(v);
        if (r.changed) {
          out[k] = r.value;
          changed = true;
        }
      }
    }
    return { changed, value: out };
  }
  return { changed: false, value: node };
}

async function processTable(table: string, extraJsonCols: string[]) {
  const cols = ["id", ...SIMPLE_FIELDS, ...extraJsonCols].join(",");
  const { data, error } = await supabase.from(table).select(cols);
  if (error) throw new Error(`select ${table}: ${error.message}`);
  let books = 0;
  let fields = 0;
  const errors: any[] = [];
  for (const row of data ?? []) {
    const update: Record<string, unknown> = {};
    for (const f of SIMPLE_FIELDS) {
      if (!(f in row)) continue;
      try {
        const r = await maybeTranslate((row as any)[f]);
        if (r.changed) {
          update[f] = r.value;
          fields++;
        }
      } catch (e: any) {
        errors.push({ table, id: (row as any).id, field: f, error: e.message });
      }
    }
    for (const f of extraJsonCols) {
      if (!(f in row) || !(row as any)[f]) continue;
      try {
        const r = await translateJson((row as any)[f]);
        if (r.changed) {
          update[f] = r.value;
          fields++;
        }
      } catch (e: any) {
        errors.push({ table, id: (row as any).id, field: f, error: e.message });
      }
    }
    if (Object.keys(update).length > 0) {
      const { error: uerr } = await supabase.from(table).update(update).eq("id", (row as any).id);
      if (uerr) errors.push({ table, id: (row as any).id, error: uerr.message });
      else books++;
    }
  }
  return { books, fields, errors };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const auth = req.headers.get("authorization") ?? "";
  const bypass = req.headers.get("x-admin-bypass");
  const authorized =
    auth === `Bearer ${SERVICE_ROLE}` ||
    auth === `Bearer ${LOVABLE_API_KEY}` ||
    (ADMIN_BYPASS && bypass === ADMIN_BYPASS);
  if (!authorized) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  try {
    const ebooks = await processTable("ebooks", [
      "inside_illustrations_json",
      "worksheet_previews_json",
    ]);
    let kids = { books: 0, fields: 0, errors: [] as any[] };
    try {
      kids = await processTable("ebooks_kids", ["inside_illustrations_json"]);
    } catch (_e) {
      // ebooks_kids may not have all the same columns; ignore hard failure
    }
    return new Response(JSON.stringify({ ebooks, ebooks_kids: kids }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
