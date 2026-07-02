// worksheet-preview
// POST { ebook_id }
//
// For every chapter whose worksheet is table-based, render two PNG previews via
// Browserless /screenshot:
//   • "before" — long headers, no wrapping, narrow columns (simulates the
//                overflow/cropping we used to ship)
//   • "after"  — current pdf-template output (shortened headers, wrapped,
//                fixed-layout table, word-break rules)
//
// PNGs are uploaded to the `ebook-pdfs` bucket under
//   {ebook_id}/worksheet-previews/{chapter}-{before|after}.png
//
// The result set (with signed URLs) is persisted to
// ebooks.worksheet_previews_json and returned to the caller so the admin UI
// can render a side-by-side review before re-rendering the full PDF.

import { admin, corsHeaders } from "../_shared/ai.ts";

type WorksheetKind =
  | "prompts" | "debt_tracker" | "velocity_calculator" | "resilience_scorecard"
  | "sprint_timeline" | "negotiation_script" | "automation_flow" | "operating_manual";

type WorksheetInput = {
  title: string;
  prompts?: string[];
  kind?: WorksheetKind;
  columns?: string[];
  rows?: number;
};

type PreviewEntry = {
  chapter_index: number;
  chapter_title: string;
  worksheet_title: string;
  kind: WorksheetKind;
  failed: boolean;
  reason: string;
  headers_raw: string[];
  headers_shortened: string[];
  before_url: string | null;
  after_url: string | null;
};

const TABLE_KINDS: WorksheetKind[] = ["debt_tracker", "velocity_calculator", "resilience_scorecard"];

const DEFAULT_COLS: Record<string, string[]> = {
  debt_tracker: ["Creditor", "Current Exact Balance", "Annual Percentage Rate", "Minimum Monthly Payment", "Payoff Date"],
  velocity_calculator: ["Month", "Extra Payment", "Balance After", "Interest Saved"],
  resilience_scorecard: ["Area", "Score 1-5", "Evidence", "Next Action"],
};

const HEADER_SHORTFORMS: [RegExp, string][] = [
  [/^current\s+exact\s+balance$/i, "Exact\nBalance"],
  [/^exact\s+balance$/i, "Exact\nBalance"],
  [/^minimum\s+monthly\s+payment$/i, "Min.\nPayment"],
  [/^total\s+monthly\s+interest$/i, "Monthly\nInterest"],
  [/^annual\s+percentage\s+rate$|^apr$/i, "APR"],
  [/^outstanding\s+balance$/i, "Balance"],
  [/^interest\s+rate$/i, "Rate"],
  [/^payoff\s+date$/i, "Payoff\nDate"],
  [/^credit\s+utili[sz]ation$/i, "Utili-\nzation"],
  [/^payment\s+due\s+date$/i, "Due\nDate"],
  [/^creditor\s+name$/i, "Creditor"],
  [/^account\s+number$/i, "Acct #"],
];

function shortenHeader(h: string): string {
  const trimmed = (h ?? "").trim();
  for (const [re, short] of HEADER_SHORTFORMS) if (re.test(trimmed)) return short;
  if (trimmed.length > 14 && trimmed.includes(" ")) {
    const words = trimmed.split(/\s+/);
    const mid = Math.ceil(words.length / 2);
    return `${words.slice(0, mid).join(" ")}\n${words.slice(mid).join(" ")}`;
  }
  return trimmed;
}

const esc = (s: string) => (s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const baseCss = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fbf9f4; color: #1a1a1a;
    font-family: "Source Serif Pro", Georgia, serif; }
  .frame { width: 576px; padding: 24px 20px; }
  .heading { font-family: "Inter", Arial, sans-serif; font-size: 11pt;
    text-transform: uppercase; letter-spacing: 0.22em; color: #b48b3d;
    border-top: 1pt solid #b48b3d; padding-top: 6pt; margin: 0 0 10pt; }
  .purpose { font-family: "Inter", sans-serif; font-size: 9.5pt; color: #555;
    font-style: italic; margin: 0 0 8pt; }
`;

const afterCss = `
  ${baseCss}
  .ws-table { width: 100%; border-collapse: collapse; font-family: "Inter", sans-serif;
    font-size: 8.5pt; table-layout: fixed; margin-top: 4pt; }
  .ws-table th, .ws-table td { border: 0.5pt solid #1a1a1a; padding: 4pt 5pt;
    vertical-align: top; word-break: break-word; overflow-wrap: anywhere; }
  .ws-table th { background: #f4ead8; text-align: left; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.06em; font-size: 7.5pt;
    line-height: 1.2; }
  .ws-table td { height: 22pt; }
`;

// The "before" CSS deliberately drops the fixes: no fixed layout, no word-break,
// nowrap on headers, and it forces a min-width slightly wider than the page so
// long labels overflow and get cropped when we screenshot the frame.
const beforeCss = `
  ${baseCss}
  .frame { overflow: hidden; }
  .ws-table { border-collapse: collapse; font-family: "Inter", sans-serif;
    font-size: 8.5pt; margin-top: 4pt; min-width: 720px; }
  .ws-table th, .ws-table td { border: 0.5pt solid #1a1a1a; padding: 4pt 5pt;
    vertical-align: top; white-space: nowrap; }
  .ws-table th { background: #f4ead8; text-align: left; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.06em; font-size: 8pt;
    line-height: 1.2; }
  .ws-table td { height: 22pt; }
  .overflow-tag { position: absolute; top: 8px; right: 12px; background: #b54a3a;
    color: #fff; font-family: "Inter", sans-serif; font-size: 9px; letter-spacing: 0.1em;
    text-transform: uppercase; padding: 3px 7px; border-radius: 3px; }
`;

function tableHtml(headers: string[], rows: number, wrapHeaders: boolean): string {
  const hCells = headers.map((h) =>
    wrapHeaders
      ? `<th>${shortenHeader(h).split("\n").map(esc).join("<br/>")}</th>`
      : `<th>${esc(h)}</th>`,
  ).join("");
  const rowsHtml = Array.from({ length: rows }, () =>
    `<tr>${headers.map(() => `<td></td>`).join("")}</tr>`).join("");
  return `<table class="ws-table">
    <colgroup>${headers.map(() => `<col />`).join("")}</colgroup>
    <thead><tr>${hCells}</tr></thead>
    <tbody>${rowsHtml}</tbody></table>`;
}

function pageHtml(css: string, inner: string, tag?: string): string {
  return `<!doctype html><html><head><meta charset="utf-8" />
    <style>${css}</style></head><body>
    <div class="frame" style="position:relative">
      ${tag ? `<div class="overflow-tag">${esc(tag)}</div>` : ""}
      ${inner}
    </div></body></html>`;
}

async function screenshot(token: string, html: string): Promise<Uint8Array> {
  const url = `https://production-sfo.browserless.io/screenshot?token=${encodeURIComponent(token)}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      html,
      options: { type: "png", fullPage: true, omitBackground: false },
      viewport: { width: 576, height: 400, deviceScaleFactor: 2 },
      gotoOptions: { waitUntil: "networkidle0", timeout: 30000 },
    }),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`browserless screenshot ${resp.status}: ${detail.slice(0, 200)}`);
  }
  return new Uint8Array(await resp.arrayBuffer());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = admin();
  try {
    const { ebook_id } = await req.json().catch(() => ({} as any));
    if (!ebook_id) return json({ error: "ebook_id required" }, 400);

    const token = Deno.env.get("BROWSERLESS_TOKEN");
    if (!token) return json({ error: "BROWSERLESS_TOKEN not configured" }, 500);

    const { data: ebook, error: eErr } = await db.from("ebooks").select("*").eq("id", ebook_id).maybeSingle();
    if (eErr || !ebook) return json({ error: "ebook not found" }, 404);

    const { data: chapterRows } = await db.from("ebook_chapters")
      .select("chapter_index,title,content,metadata").eq("ebook_id", ebook_id)
      .order("chapter_index", { ascending: true });

    let chapters: any[] = chapterRows ?? [];
    if (!chapters.length && Array.isArray(ebook.chapters)) {
      chapters = (ebook.chapters as any[]).map((c: any, i: number) => ({
        chapter_index: c.index ?? c.chapter_index ?? (i + 1),
        title: c.title ?? `Chapter ${i + 1}`,
        metadata: c.metadata ?? {},
      }));
    }

    // Collect all worksheets that have a table structure (or long headers).
    const candidates: { chapter_index: number; title: string; worksheet: WorksheetInput }[] = [];
    for (const c of chapters) {
      const meta = (c.metadata ?? {}) as any;
      const w: WorksheetInput | null = meta.worksheet ?? c.worksheet ?? null;
      if (!w) continue;
      const kind = w.kind ?? "prompts";
      const cols = (w.columns?.length ? w.columns : DEFAULT_COLS[kind]) ?? null;
      const isTable = TABLE_KINDS.includes(kind as WorksheetKind);
      if (!isTable && !cols) continue;
      candidates.push({
        chapter_index: c.chapter_index,
        title: c.title ?? `Chapter ${c.chapter_index}`,
        worksheet: { ...w, columns: cols ?? undefined, kind: (w.kind ?? (isTable ? kind : "debt_tracker")) as WorksheetKind },
      });
    }

    // Only include worksheets that would actually fail the overflow check
    // (any header longer than 14 chars → gets shortened/wrapped by the fix).
    const failing = candidates.filter((c) => {
      const cols = c.worksheet.columns ?? [];
      return cols.some((h) => (h ?? "").trim().length > 14);
    });

    const results: PreviewEntry[] = [];
    // Render sequentially — Browserless memory limits + we usually have ≤5 items.
    for (const c of failing) {
      const kind = (c.worksheet.kind ?? "debt_tracker") as WorksheetKind;
      const headers = c.worksheet.columns ?? DEFAULT_COLS[kind] ?? [];
      const rows = Math.min(c.worksheet.rows ?? 6, 6);
      const heading = `<h3 class="heading">${esc(labelFor(kind))} — ${esc(c.worksheet.title)}</h3>`;
      const purpose = c.worksheet.prompts?.[0] ? `<p class="purpose">${esc(c.worksheet.prompts[0])}</p>` : "";

      const beforeInner = heading + purpose + tableHtml(headers, rows, false);
      const afterInner = heading + purpose + tableHtml(headers, rows, true);

      let before_url: string | null = null;
      let after_url: string | null = null;
      try {
        const [beforePng, afterPng] = await Promise.all([
          screenshot(token, pageHtml(beforeCss, beforeInner, "Overflow — cropped")),
          screenshot(token, pageHtml(afterCss, afterInner)),
        ]);
        const basePath = `${ebook_id}/worksheet-previews/${c.chapter_index}`;
        const [upB, upA] = await Promise.all([
          db.storage.from("ebook-pdfs").upload(`${basePath}-before.png`, beforePng, { contentType: "image/png", upsert: true }),
          db.storage.from("ebook-pdfs").upload(`${basePath}-after.png`, afterPng, { contentType: "image/png", upsert: true }),
        ]);
        if (upB.error) throw upB.error;
        if (upA.error) throw upA.error;
        const [sB, sA] = await Promise.all([
          db.storage.from("ebook-pdfs").createSignedUrl(`${basePath}-before.png`, 60 * 60 * 24 * 7),
          db.storage.from("ebook-pdfs").createSignedUrl(`${basePath}-after.png`, 60 * 60 * 24 * 7),
        ]);
        before_url = sB.data?.signedUrl ?? null;
        after_url = sA.data?.signedUrl ?? null;
      } catch (err) {
        console.warn("preview render failed", c.chapter_index, (err as Error).message);
      }

      results.push({
        chapter_index: c.chapter_index,
        chapter_title: c.title,
        worksheet_title: c.worksheet.title,
        kind,
        failed: true,
        reason: "One or more headers exceed 14 characters and overflow the 6in page without the wrapping fix.",
        headers_raw: headers,
        headers_shortened: headers.map((h) => shortenHeader(h).replace(/\n/g, " / ")),
        before_url,
        after_url,
      });
    }

    const payload = {
      generated_at: new Date().toISOString(),
      count: results.length,
      entries: results,
    };

    await db.from("ebooks").update({
      worksheet_previews_json: payload as unknown as Record<string, unknown>,
    }).eq("id", ebook_id);

    return json({ ok: true, ...payload });
  } catch (e) {
    console.error("worksheet-preview failed", e);
    return json({ error: (e as Error).message ?? String(e) }, 500);
  }
});

function labelFor(k: WorksheetKind): string {
  switch (k) {
    case "debt_tracker": return "Debt Tracker";
    case "velocity_calculator": return "Velocity Calculator";
    case "resilience_scorecard": return "Resilience Scorecard";
    default: return "Worksheet";
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
