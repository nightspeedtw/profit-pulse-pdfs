// Milestone 6 — Premium PDF HTML/CSS template.
// Builds a single self-contained HTML document for Chromium PDF rendering
// (Browserless /pdf). Print-CSS first: @page rules, page-break controls,
// running headers/footers via Chromium's header/footer templates.
//
// Includes: cover · title page · copyright/disclaimer · TOC · chapter
// dividers · styled chapter content · callout boxes · worksheets · checklists
// · framework diagrams · action plan · bonus section · page numbers · headers.

export interface PdfChapter {
  index: number;
  title: string;
  brief?: string;
  content: string; // markdown-ish
  callouts?: { kind?: string; title?: string; body: string }[];
  worksheet?: { title: string; prompts: string[]; kind?: WorksheetKind; columns?: string[]; rows?: number } | null;
  checklist?: { title: string; items: string[] } | null;
  diagram?: { title: string; steps: string[] } | null;
  illustration?: { url: string; caption?: string } | null;
}

export type WorksheetKind =
  | "prompts"
  | "debt_tracker"
  | "negotiation_script"
  | "sprint_timeline"
  | "velocity_calculator"
  | "automation_flow"
  | "resilience_scorecard"
  | "operating_manual"
  // Productivity
  | "focus_audit"
  | "interruption_log"
  | "deep_work_planner"
  | "calendar_boundary"
  | "meeting_elimination"
  // Energy / health
  | "energy_audit"
  | "caffeine_log"
  | "sleep_anchor"
  | "crash_diagnostic"
  | "evening_recovery"
  // Cashflow / fortress
  | "cashflow_surplus"
  | "fortress_audit"
  | "lifestyle_leak"
  | "safety_net"
  | "fixed_cost_scan";

export interface PdfData {
  title: string;
  subtitle?: string | null;
  buyer?: string | null;
  promise?: string | null;
  brand?: string;
  cover_url?: string | null;
  copyright_year?: number;
  disclaimer?: string | null;
  chapters: PdfChapter[];
  bonuses?: Record<string, string> | null;
  action_plan?: { day: string; tasks: string[] }[] | null;
  bonus_section?: { title: string; body: string }[] | null;
}

function esc(s: string): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Lightweight markdown-ish renderer: paragraphs, headings, bullets, numbered
// lists, bold, italic, inline code, blockquote callouts. Deliberately strict
// to avoid broken HTML in the PDF.
function renderMd(md: string): string {
  const src = (md ?? "").replace(/\r\n/g, "\n").trim();
  if (!src) return "";
  const lines = src.split("\n");
  const out: string[] = [];
  let i = 0;
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  while (i < lines.length) {
    const ln = lines[i];
    if (!ln.trim()) { i++; continue; }
    // markdown table: header row `| a | b |` optionally followed by `| :--- | :--- |`.
    // We also accept a header row followed directly by another `| ... |` body row
    // (AI often omits the separator), so raw pipe tables never leak into prose.
    const isPipeRow = (s: string) => /^\s*\|.+\|\s*$/.test(s);
    const isSepRow = (s: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(s);
    if (isPipeRow(ln) && i + 1 < lines.length && (isSepRow(lines[i + 1]) || isPipeRow(lines[i + 1]))) {
      const parseRow = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const headers = parseRow(ln);
      i += isSepRow(lines[i + 1]) ? 2 : 1;
      const bodyRows: string[][] = [];
      while (i < lines.length && isPipeRow(lines[i]) && !isSepRow(lines[i])) { bodyRows.push(parseRow(lines[i])); i++; }
      const thead = `<thead><tr>${headers.map((h) => `<th>${inline(h)}</th>`).join("")}</tr></thead>`;
      const tbody = `<tbody>${bodyRows.map((r) => `<tr>${headers.map((_, idx) => `<td>${inline(r[idx] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody>`;
      out.push(`<table class="md-table">${thead}${tbody}</table>`);
      continue;
    }
    // Orphaned single pipe-row (no adjacent table) — strip so it doesn't leak as raw text.
    if (isPipeRow(ln) && (i + 1 >= lines.length || !isPipeRow(lines[i + 1]))) { i++; continue; }
    // headings
    const h = ln.match(/^(#{1,4})\s+(.*)$/);
    if (h) { const lvl = h[1].length + 1; out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`); i++; continue; }
    // bullets
    if (/^[-*]\s+/.test(ln)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^[-*]\s+/, ""))}</li>`); i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    // numbered
    if (/^\d+\.\s+/.test(ln)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\d+\.\s+/, ""))}</li>`); i++;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }
    // blockquote → callout
    if (/^>\s?/.test(ln)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, "")); i++;
      }
      out.push(`<aside class="callout callout--quote">${inline(buf.join(" "))}</aside>`);
      continue;
    }
    // paragraph (gather until blank)
    const buf: string[] = [ln];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|[-*]\s|\d+\.\s|>\s?|\s*\|.+\|\s*$)/.test(lines[i])) {
      buf.push(lines[i]); i++;
    }
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  return out.join("\n");
}

function stripInlineMd(s: string): string {
  return (s ?? "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

// Remove a leading H1/H2 whose text duplicates the chapter title, so the PDF
// doesn't render "Chapter 2. Focus" AND then a second "# Focus" H2 right below.
function stripDuplicateLeadingHeading(md: string, chapterTitle: string): string {
  const src = (md ?? "").replace(/\r\n/g, "\n").replace(/^\s+/, "");
  const m = src.match(/^(#{1,3})\s+([^\n]+)\n+/);
  if (!m) return src;
  const heading = stripInlineMd(m[2]);
  const title = stripInlineMd(chapterTitle ?? "");
  const norm = (s: string) => s.toLowerCase().replace(/^chapter\s*\d+[:.\-\s]*/i, "").replace(/[^a-z0-9]/g, "");
  if (norm(heading) && norm(title) && (norm(heading) === norm(title) || norm(heading).includes(norm(title)) || norm(title).includes(norm(heading)))) {
    return src.slice(m[0].length);
  }
  return src;
}

function chapterCallouts(c: PdfChapter): string {
  if (!c.callouts?.length) return "";
  return c.callouts.map((co) => `
    <aside class="callout callout--${esc(co.kind ?? "tip")}">
      ${co.title ? `<div class="callout__title">${esc(stripInlineMd(co.title))}</div>` : ""}
      <div class="callout__body">${renderMd(co.body)}</div>
    </aside>`).join("\n");
}

// Safe short-form dictionary for worksheet table headers so long labels wrap
// cleanly across two lines instead of overflowing. Any header longer than
// ~12 chars falls back to an auto two-line split.
const HEADER_SHORTFORMS: [RegExp, string][] = [
  [/^current\s+exact\s+balance$/i, "Exact\nBalance"],
  [/^exact\s+balance$/i, "Exact\nBalance"],
  [/^minimum\s+monthly\s+payment$/i, "Min.\nPayment"],
  [/^minimum\s+payment$/i, "Min.\nPayment"],
  [/^total\s+monthly\s+interest$/i, "Monthly\nInterest"],
  [/^monthly\s+interest$/i, "Monthly\nInterest"],
  [/^annual\s+percentage\s+rate$|^apr$/i, "APR"],
  [/^outstanding\s+balance$/i, "Balance"],
  [/^current\s+balance$/i, "Balance"],
  [/^interest\s+rate$/i, "Rate"],
  [/^payoff\s+date$/i, "Payoff\nDate"],
  [/^projected\s+payoff\s+date$/i, "Payoff\nDate"],
  [/^credit\s+utili[sz]ation$/i, "Utili-\nzation"],
  [/^payment\s+due\s+date$/i, "Due\nDate"],
  [/^due\s+date$/i, "Due\nDate"],
  [/^creditor\s+name$/i, "Creditor"],
  [/^account\s+number$/i, "Acct #"],
  [/^extra\s+payment$/i, "Extra\nPayment"],
  [/^balance\s+after$/i, "Balance\nAfter"],
  [/^interest\s+saved$/i, "Interest\nSaved"],
  [/^next\s+action$/i, "Next\nAction"],
  [/^score\s+1-5$/i, "Score\n1–5"],
];
function shortenHeader(h: string): string {
  const trimmed = (h ?? "").trim();
  for (const [re, short] of HEADER_SHORTFORMS) {
    if (re.test(trimmed)) return short;
  }
  // Auto-wrap headers > 12 chars into two balanced lines at the middle space.
  if (trimmed.length > 12 && trimmed.includes(" ")) {
    const words = trimmed.split(/\s+/);
    const mid = Math.ceil(words.length / 2);
    return `${words.slice(0, mid).join(" ")}\n${words.slice(mid).join(" ")}`;
  }
  // Single long word → soft-hyphen break so it wraps inside a narrow cell.
  if (trimmed.length > 12 && !trimmed.includes(" ")) {
    return `${trimmed.slice(0, 8)}\u00AD${trimmed.slice(8)}`;
  }
  return trimmed;
}

function chapterIllustration(c: PdfChapter): string {
  if (!c.illustration?.url) return "";
  return `
    <figure class="inside-illus">
      <img src="${esc(c.illustration.url)}" alt="" />
      ${c.illustration.caption ? `<figcaption>${esc(c.illustration.caption)}</figcaption>` : ""}
    </figure>`;
}

function chapterWorksheet(c: PdfChapter): string {
  const w = c.worksheet;
  if (!w) return "";
  const kind = w.kind ?? "prompts";

  // Table-based layouts share the same column-sized <table> renderer.
  const renderTable = (headers: string[], rows: number, prefill: string[][] = []) => {
    const cols = headers.map(shortenHeader);
    const wide = cols.length >= 5 ? " ws-table--wide" : "";
    const colWidth = `${(100 / cols.length).toFixed(3)}%`;
    const rowsHtml = Array.from({ length: rows }, (_, r) => {
      const cells = cols.map((_, ci) => {
        const val = prefill[r]?.[ci] ?? "";
        return `<td>${esc(val)}</td>`;
      }).join("");
      return `<tr>${cells}</tr>`;
    }).join("");
    return `
      <table class="ws-table${wide}">
        <colgroup>${cols.map(() => `<col style="width:${colWidth}" />`).join("")}</colgroup>
        <thead><tr>${cols.map((h) =>
          `<th>${h.split("\n").map((line) => esc(line)).join("<br/>")}</th>`).join("")}</tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;
  };

  const heading = (label: string) => `<h3 class="block__heading">${esc(label)} — ${esc(w.title)}</h3>`;
  const purpose = w.prompts?.[0] ? `<p class="ws-purpose">${esc(w.prompts[0])}</p>` : "";

  if (kind === "debt_tracker") {
    const headers = w.columns?.length ? w.columns : ["Creditor", "Exact Balance", "APR", "Min. Payment", "Payoff Date"];
    return `<section class="worksheet worksheet--table">${heading("Debt Tracker")}${purpose}${renderTable(headers, w.rows ?? 8)}</section>`;
  }
  if (kind === "velocity_calculator") {
    const headers = w.columns?.length ? w.columns : ["Month", "Extra Payment", "Balance After", "Interest Saved"];
    return `<section class="worksheet worksheet--table">${heading("Velocity Calculator")}${purpose}${renderTable(headers, w.rows ?? 6)}</section>`;
  }
  if (kind === "resilience_scorecard") {
    const headers = w.columns?.length ? w.columns : ["Area", "Score 1-5", "Evidence", "Next Action"];
    return `<section class="worksheet worksheet--table">${heading("Resilience Scorecard")}${purpose}${renderTable(headers, w.rows ?? 6)}</section>`;
  }
  if (kind === "sprint_timeline") {
    const items = (w.prompts?.length ? w.prompts : ["Hour 0-4", "Hour 4-12", "Hour 12-24", "Hour 24-48", "Hour 48-72"]);
    return `<section class="worksheet worksheet--timeline">${heading("Sprint Timeline")}${purpose}
      <ol class="ws-timeline">${items.map((p) =>
        `<li><div class="ws-timeline__slot">${esc(p)}</div><div class="ws-timeline__lines"><span></span><span></span></div></li>`).join("")}</ol></section>`;
  }
  if (kind === "negotiation_script") {
    const rows = w.prompts?.length ? w.prompts : ["Opening line", "Anchor number", "Response to pushback", "Close"];
    return `<section class="worksheet worksheet--script">${heading("Negotiation Script")}${purpose}
      <div class="ws-script">${rows.map((r) =>
        `<div class="ws-script__row"><div class="ws-script__label">${esc(r)}</div><div class="ws-script__lines"><span></span><span></span></div></div>`).join("")}</div></section>`;
  }
  if (kind === "automation_flow") {
    const items = w.prompts ?? [];
    return `<section class="worksheet worksheet--flow">${heading("Automation Setup")}${purpose}
      <ul class="ws-flow">${items.map((it) =>
        `<li><span class="ws-flow__box"></span>${esc(it)}</li>`).join("")}</ul></section>`;
  }
  if (kind === "operating_manual") {
    const items = w.prompts ?? [];
    return `<section class="worksheet worksheet--manual">${heading("Operating Manual")}${purpose}
      <ol class="ws-manual">${items.map((it) => `<li>${esc(it)}</li>`).join("")}</ol></section>`;
  }
  // Category-specific table worksheets (productivity, energy, cashflow).
  const TABLE_KINDS: Record<string, { label: string; cols: string[]; rows: number }> = {
    focus_audit:         { label: "Focus-to-Friction Audit",       cols: ["Task",           "Depth 1-5", "Interruption Source", "Fix This Week"], rows: 8 },
    interruption_log:    { label: "Interruption Origin Log",       cols: ["Time",           "Trigger",   "Duration (min)",      "Was It Urgent?"], rows: 10 },
    deep_work_planner:   { label: "Deep Work Block Planner",       cols: ["Day",            "Block",     "Outcome",             "Blocker Removed"], rows: 7 },
    calendar_boundary:   { label: "Calendar Boundary Worksheet",   cols: ["Recurring Item", "Purpose",   "Keep / Cut / Shrink", "Replacement Ritual"], rows: 8 },
    meeting_elimination: { label: "Meeting Elimination Matrix",    cols: ["Meeting",        "Decision?", "Async Possible?",     "Action"],           rows: 8 },
    energy_audit:        { label: "72-Hour Energy Audit Tracker",  cols: ["Time",           "Energy 1-10", "Trigger",           "Recovery Move"],    rows: 12 },
    caffeine_log:        { label: "Caffeine Half-Life Log",        cols: ["Time",           "Source",    "mg (est.)",           "Sleep Impact"],     rows: 8 },
    sleep_anchor:        { label: "Sleep Anchor Planner",          cols: ["Anchor",         "Target Time", "Current Time",       "Adjustment"],       rows: 6 },
    crash_diagnostic:    { label: "2 PM Crash Pattern Worksheet",  cols: ["Day",            "Last Meal", "Sleep Prior Night",   "Crash Severity"],   rows: 7 },
    evening_recovery:    { label: "Evening Recovery Tracker",      cols: ["Time",           "Ritual",    "Screen Off?",         "Sleep Quality 1-5"], rows: 7 },
    cashflow_surplus:    { label: "Cash Flow Surplus Calculator",  cols: ["Month",          "Income",    "Fixed Costs",         "Surplus"],          rows: 6 },
    fortress_audit:      { label: "Fortress Baseline Audit",       cols: ["Pillar",         "Current",   "Target",              "Next Move"],        rows: 6 },
    lifestyle_leak:      { label: "Lifestyle Leak Matrix",         cols: ["Category",       "Monthly $", "Value 1-5",           "Cut / Keep"],       rows: 8 },
    safety_net:          { label: "Safety Net Builder",            cols: ["Layer",          "Target $",  "Current $",           "Timeline"],         rows: 5 },
    fixed_cost_scan:     { label: "Fixed Cost Fragility Scan",     cols: ["Cost",           "Monthly $", "Fragility 1-5",       "Renegotiate By"],   rows: 8 },
  };
  const tk = TABLE_KINDS[kind as string];
  if (tk) {
    const headers = w.columns?.length ? w.columns : tk.cols;
    return `<section class="worksheet worksheet--table">${heading(tk.label)}${purpose}${renderTable(headers, w.rows ?? tk.rows)}</section>`;
  }
  // default: prompts + writing lines
  if (!w.prompts?.length) return "";
  return `
    <section class="worksheet">
      ${heading("Worksheet")}
      <ol class="worksheet__list">
        ${w.prompts.map((p) => `
          <li>
            <div class="worksheet__prompt">${esc(p)}</div>
            <div class="worksheet__lines"><span></span><span></span><span></span></div>
          </li>`).join("")}
      </ol>
    </section>`;
}

function chapterChecklist(c: PdfChapter): string {
  const cl = c.checklist;
  if (!cl?.items?.length) return "";
  return `
    <section class="checklist">
      <h3 class="block__heading">Checklist — ${esc(cl.title)}</h3>
      <ul class="checklist__list">
        ${cl.items.map((it) => `<li><span class="checklist__box"></span>${esc(it)}</li>`).join("")}
      </ul>
    </section>`;
}

function chapterDiagram(c: PdfChapter): string {
  const d = c.diagram;
  if (!d?.steps?.length) return "";
  // Framework diagram: ordered numbered cards. Connectors are rendered as CSS
  // pseudo-elements (::after) — NEVER as raw text — so no stray characters
  // (v, *, ▸) can leak into the PDF if fonts fall back.
  const cells = d.steps.map((s, i) => `
    <div class="framework__cell${i < d.steps!.length - 1 ? " framework__cell--connect" : ""}">
      <div class="framework__n">${i + 1}</div>
      <div class="framework__t">${esc(s)}</div>
    </div>`).join("");
  return `
    <section class="framework">
      <h3 class="block__heading">Framework — ${esc(d.title)}</h3>
      <div class="framework__grid">${cells}</div>
    </section>`;
}

export function buildPdfHtml(data: PdfData): string {
  const year = data.copyright_year ?? new Date().getFullYear();
  const brand = data.brand ?? "SECRET PDF";

  const tocItems = data.chapters.map((c) =>
    `<li class="toc__row"><span class="toc__title">Chapter ${c.index}. ${esc(stripInlineMd(c.title))}</span><span class="toc__dots"></span><span class="toc__page">—</span></li>`,
  ).join("");

  const chapterPages = data.chapters.map((c) => `
    <section class="page chapter-divider" id="chapter-${c.index}-divider">
      <div class="chapter-divider__inner">
        <div class="chapter-divider__eyebrow">Chapter ${c.index}</div>
        <h1 class="chapter-divider__title">${esc(c.title)}</h1>
        ${c.brief ? `<p class="chapter-divider__brief">${esc(c.brief)}</p>` : ""}
      </div>
    </section>
    <section class="page chapter-body" id="chapter-${c.index}">
      <header class="page__head"><span>${esc(brand)}</span><span>${esc(data.title)}</span></header>
      <div class="chapter-body__eyebrow">Chapter ${c.index}</div>
      <h2 class="chapter-body__title">${esc(stripInlineMd(c.title))}</h2>
      <div class="chapter-body__prose">
        ${renderMd(stripDuplicateLeadingHeading(c.content, c.title))}
      </div>
      ${chapterCallouts(c)}
      ${chapterIllustration(c)}
      ${chapterDiagram(c)}
      ${chapterWorksheet(c)}
      ${chapterChecklist(c)}
    </section>
  `).join("\n");

  const actionPlanHtml = data.action_plan?.length ? `
    <section class="page action-plan">
      <h2 class="section__title">Your 7-Day Action Plan</h2>
      <p class="section__lede">Move from reading to doing. Each day below pairs a quick win with one deeper action.</p>
      <div class="action-plan__grid">
        ${data.action_plan.map((d) => `
          <article class="action-plan__day">
            <header>${esc(d.day)}</header>
            <ul>${d.tasks.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
          </article>`).join("")}
      </div>
    </section>` : "";

  const bonusHtml = data.bonus_section?.length ? `
    <section class="page bonus-divider">
      <div class="chapter-divider__inner">
        <div class="chapter-divider__eyebrow">Bonus Section</div>
        <h1 class="chapter-divider__title">Premium Bonuses</h1>
        <p class="chapter-divider__brief">Extra tools to help you implement faster.</p>
      </div>
    </section>
    ${data.bonus_section.map((b) => `
      <section class="page bonus-body">
        <header class="page__head"><span>${esc(brand)}</span><span>Bonus</span></header>
        <h2 class="chapter-body__title">${esc(b.title)}</h2>
        <div class="chapter-body__prose">${renderMd(b.body)}</div>
      </section>`).join("")}` : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(data.title)}</title>
<style>
  /* ---------- Page geometry ----------
     Whole document is A4 so the cover ALWAYS fills a true A4 page.
     Named @page rules kept for full-bleed sections that need zero margin. */
  @page { size: A4 portrait; margin: 18mm 18mm 22mm 18mm; }
  @page :first { size: A4 portrait; margin: 0; }
  @page cover { size: A4 portrait; margin: 0; }
  @page cover-a4 { size: A4 portrait; margin: 0; }
  @page chapter-open { size: A4 portrait; margin: 0; }

  /* ---------- Typography ---------- */
  :root {
    --ink: #14181f;
    --ink-soft: #3a4250;
    --muted: #6b7280;
    --accent: #b8843a;
    --accent-soft: #f4ead8;
    --rule: #d8d3c7;
    --bg-divider: #14181f;
    --bg-callout: #fbf7ee;
  }
  * { box-sizing: border-box; }
  html, body { padding: 0; margin: 0; color: var(--ink);
    font-family: "Source Serif Pro", "Source Serif 4", Georgia, "Times New Roman", serif;
    font-size: 11pt; line-height: 1.58;
    /* Premium book-print rendering */
    text-rendering: optimizeLegibility;
    font-feature-settings: "kern" 1, "liga" 1, "onum" 1;
    -webkit-font-smoothing: antialiased; }
  h1, h2, h3, h4, .display, .eyebrow, header.page__head, .toc__title, .toc__page,
  .callout__title, .block__heading, .framework__n, .checklist__list, .worksheet__prompt,
  .action-plan__day header {
    font-family: "Inter", "Helvetica Neue", Arial, sans-serif;
    letter-spacing: -0.005em;
  }
  p { orphans: 3; widows: 3; margin: 0 0 0.7em; }
  ul, ol { margin: 0 0 0.9em 1.25em; padding: 0; }
  li { margin: 0 0 0.32em; }
  code { font-family: "JetBrains Mono", "SFMono-Regular", Menlo, monospace; font-size: 0.92em;
    background: #f2efe7; padding: 1px 4px; border-radius: 3px; }
  a { color: var(--ink); text-decoration: none; }
  h2, h3, h4 { break-after: avoid; page-break-after: avoid; }
  /* Never split a heading from the paragraph that follows. */
  h2 + p, h3 + p, h4 + p { break-before: avoid; page-break-before: avoid; }

  /* ---------- Generic page ---------- */
  .page { page-break-after: always; break-after: page; }
  .page:last-child { page-break-after: auto; }
  .page__head {
    display: flex; justify-content: space-between; font-size: 8.5pt;
    text-transform: uppercase; letter-spacing: 0.16em; color: var(--muted);
    padding-bottom: 6pt; border-bottom: 0.5pt solid var(--rule); margin-bottom: 18pt;
  }

  /* ---------- Cover A4 (hard full-bleed, always page 1) ---------- */
  .cover-a4 { page: cover-a4; width: 210mm; height: 297mm; position: relative;
    overflow: hidden; background: var(--bg-divider); color: #fff;
    margin: 0; padding: 0; page-break-after: always; break-after: page; }
  .cover-a4 .cover__img { position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: cover; object-position: center; display: block; z-index: 0; }
  .cover-a4 .cover__fallback { position: absolute; inset: 0; z-index: 0;
    background: radial-gradient(120% 70% at 50% 0%, #1f2937 0%, #0b0f17 100%); }
  .cover-a4 .cover__veil { position: absolute; inset: 0; z-index: 1;
    background: linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.55) 65%, rgba(0,0,0,0.85) 100%); }
  .cover-a4 .cover__inner { position: absolute; inset: 0; padding: 22mm 20mm;
    display: flex; flex-direction: column; justify-content: space-between; z-index: 2; }
  .cover-a4 .cover__brand { font-family: "Inter", sans-serif; font-size: 10pt;
    letter-spacing: 0.36em; text-transform: uppercase; color: #f4ead8; }
  .cover-a4 .cover__title { font-family: "Inter", sans-serif; font-weight: 800;
    font-size: 46pt; line-height: 1.04; text-transform: uppercase; margin: 0; }
  .cover-a4 .cover__subtitle { font-family: "Inter", sans-serif; font-weight: 400;
    font-size: 15pt; line-height: 1.35; color: #f4ead8; margin-top: 14pt; max-width: 150mm; }
  .cover-a4 .cover__badge { display: inline-block; padding: 5pt 11pt;
    border: 1pt solid #f4ead8; font-family: "Inter", sans-serif; font-size: 8.5pt;
    letter-spacing: 0.28em; text-transform: uppercase; align-self: flex-start;
    margin-bottom: 14pt; }

  /* Legacy 6x9 cover kept for backward compat */
  .cover { page: cover; height: 9in; width: 6in; position: relative; overflow: hidden;
    background: var(--bg-divider); color: #fff; margin: 0; padding: 0;
    page-break-after: always; break-after: page; }
  .cover .cover__img { position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    object-fit: cover; object-position: center; display: block; }
  .cover .cover__fallback { position: absolute; inset: 0;
    background: radial-gradient(120% 70% at 50% 0%, #1f2937 0%, #0b0f17 100%); }
  .cover .cover__veil { position: absolute; inset: 0;
    background: linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.6) 70%, rgba(0,0,0,0.85) 100%); }
  .cover .cover__inner { position: absolute; inset: 0; padding: 0.55in 0.6in;
    display: flex; flex-direction: column; justify-content: space-between; z-index: 2; }
  .cover .cover__brand { font-family: "Inter", sans-serif; font-size: 9pt; letter-spacing: 0.34em;
    text-transform: uppercase; color: #f4ead8; }
  .cover .cover__title { font-family: "Inter", sans-serif; font-weight: 800; font-size: 34pt;
    line-height: 1.05; text-transform: uppercase; }
  .cover .cover__subtitle { font-family: "Inter", sans-serif; font-weight: 400; font-size: 13pt;
    line-height: 1.35; color: #f4ead8; margin-top: 10pt; max-width: 4.6in; }
  .cover .cover__badge { display: inline-block; padding: 4pt 9pt; border: 1pt solid #f4ead8;
    font-family: "Inter", sans-serif; font-size: 8pt; letter-spacing: 0.25em;
    text-transform: uppercase; align-self: flex-start; }

  /* ---------- Markdown tables (from raw | col | col |) ---------- */
  .md-table { width: 100%; border-collapse: collapse; margin: 12pt 0 16pt;
    font-family: "Inter", sans-serif; font-size: 9.5pt;
    /* Long tables may break across pages; the header row is repeated. */
    page-break-inside: auto; break-inside: auto;
    table-layout: fixed; }
  .md-table thead { display: table-header-group; }
  .md-table tbody tr { page-break-inside: avoid; break-inside: avoid; }
  .md-table thead th { background: var(--bg-callout); color: var(--ink);
    text-align: left; padding: 6pt 8pt; border-bottom: 1pt solid var(--accent);
    font-weight: 700; word-wrap: break-word; overflow-wrap: anywhere; hyphens: auto; }
  .md-table tbody td { padding: 6pt 8pt; border-bottom: 0.5pt solid var(--rule);
    vertical-align: top; word-wrap: break-word; overflow-wrap: anywhere; hyphens: auto;
    line-height: 1.42; }
  .md-table tbody tr:nth-child(even) td { background: #faf7ef; }

  /* ---------- Title page ---------- */
  .title-page { padding: 1.2in 0.9in; }
  .title-page__eyebrow { font-family: "Inter", sans-serif; font-size: 9pt;
    letter-spacing: 0.3em; text-transform: uppercase; color: var(--muted); }
  .title-page__title { font-family: "Inter", sans-serif; font-weight: 800;
    font-size: 28pt; line-height: 1.1; margin: 18pt 0 6pt; }
  .title-page__sub { font-size: 13pt; line-height: 1.4; color: var(--ink-soft); margin-bottom: 24pt; }
  .title-page__rule { height: 2pt; background: var(--accent); width: 60pt; margin-bottom: 24pt; }
  .title-page__meta { font-family: "Inter", sans-serif; font-size: 10pt; color: var(--muted);
    text-transform: uppercase; letter-spacing: 0.18em; }

  /* ---------- Copyright/Disclaimer ---------- */
  .legal h2 { font-family: "Inter", sans-serif; font-size: 11pt;
    text-transform: uppercase; letter-spacing: 0.2em; margin: 0 0 10pt; }
  .legal p { font-size: 9.5pt; color: var(--ink-soft); }
  .legal__rule { height: 0.5pt; background: var(--rule); margin: 20pt 0; }

  /* ---------- TOC ---------- */
  .toc h2 { font-family: "Inter", sans-serif; font-weight: 800; font-size: 24pt;
    text-transform: uppercase; margin: 0 0 18pt; }
  .toc__list { list-style: none; margin: 0; padding: 0; }
  .toc__row { display: flex; align-items: baseline; font-size: 11pt; padding: 6pt 0;
    border-bottom: 0.5pt dashed var(--rule); }
  .toc__title { flex: 0 0 auto; padding-right: 8pt; }
  .toc__dots { flex: 1; border-bottom: 0.5pt dotted var(--muted); margin: 0 4pt; transform: translateY(-3pt); }
  .toc__page { font-size: 10pt; color: var(--muted); }

  /* ---------- Chapter divider ---------- */
  .chapter-divider { background: var(--bg-divider); color: #fff;
    padding: 0; page: chapter-open; height: 9in; }
  .chapter-divider__inner { padding: 1.8in 0.7in 0.7in; }
  .chapter-divider__eyebrow { font-family: "Inter", sans-serif; font-size: 10pt;
    letter-spacing: 0.32em; text-transform: uppercase; color: var(--accent); margin-bottom: 14pt; }
  .chapter-divider__title { font-family: "Inter", sans-serif; font-weight: 800;
    font-size: 36pt; line-height: 1.08; margin: 0; }
  .chapter-divider__brief { font-size: 12pt; line-height: 1.45; color: #d6d2c6;
    margin-top: 14pt; max-width: 4.6in; }

  /* ---------- Chapter body ---------- */
  .chapter-body__eyebrow { font-family: "Inter", sans-serif; font-size: 9pt;
    letter-spacing: 0.32em; text-transform: uppercase; color: var(--accent);
    margin: 0 0 8pt; }
  .chapter-body__title { font-family: "Inter", sans-serif; font-weight: 800;
    font-size: 20pt; margin: 0 0 20pt; line-height: 1.18; letter-spacing: -0.012em;
    border-bottom: 1pt solid var(--rule); padding-bottom: 14pt; }
  .chapter-body__prose { text-align: justify; text-justify: inter-word;
    hyphens: auto; -webkit-hyphens: auto; hyphenate-limit-chars: 6 3 3;
    orphans: 3; widows: 3; }
  .chapter-body__prose h2 { font-size: 14pt; margin: 18pt 0 6pt; text-align: left; hyphens: manual; }
  .chapter-body__prose h3 { font-size: 12pt; margin: 14pt 0 4pt; text-align: left; hyphens: manual; }
  .chapter-body__prose h4 { font-size: 10.5pt; margin: 10pt 0 4pt; text-align: left;
    text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-soft); hyphens: manual; }
  /* Drop cap on the first paragraph of every chapter body */
  .chapter-body__prose > p:first-of-type::first-letter {
    font-family: "Inter", sans-serif; font-weight: 800;
    float: left; font-size: 40pt; line-height: 0.88; padding: 4pt 6pt 0 0;
    color: var(--accent); }
  /* Never leave dangling headings or short lists at the bottom of a page */
  .chapter-body__prose ul, .chapter-body__prose ol { text-align: left; hyphens: manual; }

  /* ---------- Callouts ---------- */
  .callout { background: var(--bg-callout); border-left: 3pt solid var(--accent);
    padding: 10pt 14pt; margin: 12pt 0;
    /* Allow long callouts to break across pages so text is never cut off. */
    page-break-inside: auto; break-inside: auto; overflow: visible; }
  .callout__title { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.22em;
    color: var(--accent); margin-bottom: 4pt; }
  .callout--warning { border-color: #b54a3a; background: #fbecea; }
  .callout--warning .callout__title { color: #b54a3a; }
  .callout--quote { font-style: italic; color: var(--ink-soft); }

  /* ---------- Worksheet ---------- */
  .worksheet, .checklist, .framework { margin: 18pt 0; page-break-inside: avoid; break-inside: avoid; }
  .block__heading { font-family: "Inter", sans-serif; font-size: 11pt;
    text-transform: uppercase; letter-spacing: 0.22em; color: var(--accent);
    border-top: 1pt solid var(--accent); padding-top: 6pt; margin: 0 0 10pt; }
  .worksheet__list { list-style: decimal; padding-left: 18pt; }
  .worksheet__prompt { font-weight: 600; margin-bottom: 6pt; }
  .worksheet__lines { display: flex; flex-direction: column; gap: 8pt; margin: 6pt 0 12pt; }
  .worksheet__lines span { display: block; height: 0; border-bottom: 0.5pt solid #b8b3a4; }

  /* ---------- Checklist ---------- */
  .checklist__list { list-style: none; margin: 0; padding: 0; }
  .checklist__list li { display: flex; align-items: flex-start; gap: 8pt; margin: 4pt 0;
    font-family: "Inter", sans-serif; font-size: 10.5pt; }
  .checklist__box { flex: 0 0 auto; display: inline-block; width: 11pt; height: 11pt;
    border: 1pt solid var(--ink); margin-top: 2pt; }

  /* ---------- Framework diagram ---------- */
  .framework__grid { display: flex; flex-wrap: wrap; align-items: stretch; gap: 8pt; }
  .framework__cell { flex: 1 1 1.1in; min-width: 1.1in; border: 1pt solid var(--ink);
    padding: 10pt; display: flex; flex-direction: column; gap: 6pt; position: relative; }
  .framework__cell--connect::after { content: ""; position: absolute; right: -12pt;
    top: 50%; width: 8pt; height: 2pt; background: var(--accent); transform: translateY(-50%); }
  .framework__cell--connect::before { content: ""; position: absolute; right: -14pt;
    top: 50%; width: 0; height: 0;
    border-left: 6pt solid var(--accent);
    border-top: 4pt solid transparent; border-bottom: 4pt solid transparent;
    transform: translateY(-50%); }
  .framework__n { font-family: "Inter", sans-serif; font-weight: 800; font-size: 18pt; color: var(--accent); }
  .framework__t { font-size: 10pt; color: var(--ink-soft); }

  /* ---------- Action plan ---------- */
  .section__title { font-family: "Inter", sans-serif; font-weight: 800;
    font-size: 22pt; margin: 0 0 6pt; }
  .section__lede { font-size: 11pt; color: var(--ink-soft); margin: 0 0 20pt; }
  .action-plan__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10pt; }
  .action-plan__day { border: 1pt solid var(--rule); padding: 10pt; page-break-inside: avoid; }
  .action-plan__day header { font-size: 10pt; text-transform: uppercase;
    letter-spacing: 0.2em; color: var(--accent); margin-bottom: 6pt; }
  .action-plan__day ul { margin: 0; padding-left: 16pt; font-size: 10pt; }

  /* ---------- Bonus ---------- */
  .bonus-divider { background: #2a221a; color: #fff; height: 9in; padding: 0; }
  .bonus-divider .chapter-divider__eyebrow { color: var(--accent-soft); }

  /* ---------- Inside illustrations ---------- */
  .inside-illus { margin: 16pt 0; page-break-inside: avoid; break-inside: avoid;
    text-align: center; border: 0.5pt solid var(--rule); padding: 8pt; background: #fbf9f4; }
  .inside-illus img { max-width: 100%; height: auto; max-height: 3.2in; display: block; margin: 0 auto; }
  .inside-illus figcaption { font-family: "Inter", sans-serif; font-size: 8.5pt;
    color: var(--muted); margin-top: 6pt; text-transform: uppercase; letter-spacing: 0.16em; }

  /* ---------- Worksheet — tabular ---------- */
  /* Anti-overflow contract:
     - table-layout: fixed + colgroup gives every column an equal share.
     - hyphens+overflow-wrap+word-break guarantee no horizontal overflow.
     - th font 7pt with line-height 1.15 keeps two-line headers readable.
     - td min height 22pt keeps write-in space usable for print. */
  .worksheet--table { page-break-inside: avoid; break-inside: avoid; overflow: hidden; }
  .ws-purpose { font-family: "Inter", sans-serif; font-size: 9.5pt; color: var(--ink-soft);
    margin: 0 0 8pt; font-style: italic; }
  .ws-table { width: 100%; border-collapse: collapse; font-family: "Inter", sans-serif;
    font-size: 8pt; table-layout: fixed; margin-top: 4pt; }
  .ws-table th, .ws-table td { border: 0.5pt solid var(--ink);
    padding: 4pt 4pt; vertical-align: top;
    word-break: break-word; overflow-wrap: anywhere; hyphens: auto; }
  .ws-table th { background: #f4ead8; text-align: left; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.04em; font-size: 7pt;
    line-height: 1.15; color: var(--ink); word-wrap: break-word; }
  .ws-table td { height: 22pt; }
  /* 5+ column tables get an extra shrink to guarantee the fit within 6in. */
  .ws-table--wide { font-size: 7.5pt; }
  .ws-table--wide th { font-size: 6.5pt; padding: 3pt 3pt; }
  .ws-table--wide td { padding: 3pt 3pt; }

  /* ---------- Worksheet — timeline ---------- */
  .ws-timeline { list-style: none; padding: 0; margin: 4pt 0 0; }
  .ws-timeline li { display: flex; gap: 10pt; align-items: flex-start;
    border-left: 2pt solid var(--accent); padding: 6pt 0 6pt 10pt; margin: 0 0 6pt; }
  .ws-timeline__slot { flex: 0 0 1.1in; font-family: "Inter", sans-serif; font-weight: 700;
    font-size: 9pt; color: var(--accent); text-transform: uppercase; letter-spacing: 0.1em; }
  .ws-timeline__lines { flex: 1; display: flex; flex-direction: column; gap: 8pt; }
  .ws-timeline__lines span { display: block; height: 0; border-bottom: 0.5pt solid #b8b3a4; }

  /* ---------- Worksheet — negotiation script ---------- */
  .ws-script { display: flex; flex-direction: column; gap: 8pt; margin-top: 4pt; }
  .ws-script__row { display: flex; gap: 10pt; align-items: flex-start;
    border: 0.5pt solid var(--rule); padding: 6pt 8pt; }
  .ws-script__label { flex: 0 0 1.4in; font-family: "Inter", sans-serif; font-weight: 700;
    font-size: 9pt; color: var(--ink); }
  .ws-script__lines { flex: 1; display: flex; flex-direction: column; gap: 6pt; }
  .ws-script__lines span { display: block; height: 0; border-bottom: 0.5pt solid #b8b3a4; }

  /* ---------- Worksheet — automation flow ---------- */
  .ws-flow { list-style: none; padding: 0; margin: 4pt 0 0;
    font-family: "Inter", sans-serif; font-size: 10pt; }
  .ws-flow li { display: flex; align-items: flex-start; gap: 8pt; margin: 4pt 0;
    padding: 4pt 6pt; border-bottom: 0.5pt dashed var(--rule); }
  .ws-flow__box { flex: 0 0 auto; display: inline-block; width: 11pt; height: 11pt;
    border: 1pt solid var(--ink); margin-top: 2pt; }

  /* ---------- Worksheet — operating manual ---------- */
  .ws-manual { padding-left: 18pt; font-family: "Inter", sans-serif; font-size: 10pt;
    line-height: 1.5; }
</style>
</head>
<body>
  <!-- COVER — full-bleed A4, always page 1 -->
  <section class="cover-a4">
    ${data.cover_url
      ? `<img class="cover__img" src="${esc(data.cover_url)}" alt="" />`
      : `<div class="cover__fallback"></div>`}
    <div class="cover__veil"></div>
    <div class="cover__inner">
      <div>
        <div class="cover__brand">${esc(brand)}</div>
      </div>
      <div>
        <div class="cover__badge">Premium Edition</div>
        <h1 class="cover__title">${esc(data.title)}</h1>
        ${data.subtitle ? `<p class="cover__subtitle">${esc(data.subtitle)}</p>` : ""}
      </div>
    </div>
  </section>

  <!-- TITLE PAGE -->
  <section class="page title-page">
    <div class="title-page__eyebrow">${esc(brand)} · Premium Edition</div>
    <h1 class="title-page__title">${esc(data.title)}</h1>
    ${data.subtitle ? `<p class="title-page__sub">${esc(data.subtitle)}</p>` : ""}
    <div class="title-page__rule"></div>
    <div class="title-page__meta">
      ${data.buyer ? `For: ${esc(data.buyer)}<br />` : ""}
      Published ${year}
    </div>
  </section>

  <!-- COPYRIGHT / DISCLAIMER -->
  <section class="page legal">
    <h2>Copyright</h2>
    <p>© ${year} ${esc(brand)}. All rights reserved. No part of this publication may be reproduced, distributed, or transmitted in any form or by any means without the prior written permission of the publisher, except for brief quotations in critical reviews.</p>
    <div class="legal__rule"></div>
    <h2>Disclaimer</h2>
    <p>${esc(data.disclaimer ?? "The information in this ebook is provided for general educational and informational purposes only. It is not intended as professional advice. Readers should consult qualified professionals before acting on any information contained herein. The author and publisher disclaim any liability arising directly or indirectly from the use of this material.")}</p>
  </section>

  <!-- TOC -->
  <section class="page toc">
    <h2>Table of Contents</h2>
    <ol class="toc__list">${tocItems}</ol>
  </section>

  <!-- CHAPTERS -->
  ${chapterPages}

  <!-- ACTION PLAN -->
  ${actionPlanHtml}

  <!-- BONUS -->
  ${bonusHtml}
</body>
</html>`;
}

// Chromium running header/footer templates used by Browserless /pdf.
export function buildHeaderTemplate(brand: string, title: string): string {
  const safe = (s: string) => esc(s);
  return `<div style="font-family: Inter, Arial, sans-serif; font-size: 7pt; color: #6b7280;
    width: 100%; padding: 0 0.55in; display: flex; justify-content: space-between;
    letter-spacing: 0.16em; text-transform: uppercase;">
    <span>${safe(brand)}</span><span>${safe(title)}</span>
  </div>`;
}

export function buildFooterTemplate(): string {
  return `<div style="font-family: Inter, Arial, sans-serif; font-size: 7pt; color: #6b7280;
    width: 100%; padding: 0 0.55in; display: flex; justify-content: space-between;
    letter-spacing: 0.16em; text-transform: uppercase;">
    <span></span>
    <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
  </div>`;
}
