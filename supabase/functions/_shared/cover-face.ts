// Deterministic cover face renderer.
// Renders a 1600x2400 poster-style book cover as HTML → PNG via Browserless.
// Every letter is baked into the image; AI never touches the typography.

export type CoverFaceStyle = "matte_black_gold" | "forest_wellness";

export interface CoverFaceInput {
  title: string;
  subtitle?: string | null;
  badge?: string | null;
  style: CoverFaceStyle;
  illustrationSvg: string; // inline SVG for the topic illustration
  footerChips?: string[]; // small feature chips at the bottom
}

const STYLES: Record<CoverFaceStyle, {
  bg: string;
  ink: string;
  accent: string;
  accentInk: string;
  muted: string;
  bodyFont: string;
  titleFont: string;
  badgeBg: string;
  badgeInk: string;
  chipInk: string;
  divider: string;
  texture: string;
}> = {
  matte_black_gold: {
    bg: "#0b0b0b",
    ink: "#f5f1e6",
    accent: "#f4c430",
    accentInk: "#0b0b0b",
    muted: "#b8b2a4",
    bodyFont: "'Inter', system-ui, sans-serif",
    titleFont: "'Anton', 'Bebas Neue', Impact, sans-serif",
    badgeBg: "#f4c430",
    badgeInk: "#0b0b0b",
    chipInk: "#f5f1e6",
    divider: "rgba(244,196,48,0.6)",
    texture:
      "radial-gradient(1200px 800px at 50% 30%, rgba(255,255,255,0.06), transparent 60%), radial-gradient(1000px 600px at 20% 90%, rgba(244,196,48,0.05), transparent 70%)",
  },
  forest_wellness: {
    bg: "#0f2a24",
    ink: "#f4ecd8",
    accent: "#e8b64a",
    accentInk: "#0f2a24",
    muted: "#c9d6cb",
    bodyFont: "'Inter', system-ui, sans-serif",
    titleFont: "'Fraunces', 'Playfair Display', Georgia, serif",
    badgeBg: "#e8b64a",
    badgeInk: "#0f2a24",
    chipInk: "#f4ecd8",
    divider: "rgba(232,182,74,0.6)",
    texture:
      "radial-gradient(1400px 900px at 50% 20%, rgba(255,255,255,0.08), transparent 60%), radial-gradient(900px 700px at 80% 90%, rgba(0,0,0,0.35), transparent 70%)",
  },
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as any)[c],
  );
}

export function buildCoverFaceHtml(input: CoverFaceInput): string {
  const s = STYLES[input.style];
  const chips = (input.footerChips ?? []).slice(0, 4);
  return `<!doctype html>
<html><head><meta charset="utf-8"/>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Bebas+Neue&family=Fraunces:opsz,wght@9..144,700;9..144,900&family=Inter:wght@400;600;800&display=block" rel="stylesheet">
<style>
  html,body{margin:0;padding:0;background:${s.bg};color:${s.ink};font-family:${s.bodyFont};-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision;}
  .page{width:1600px;height:2400px;position:relative;overflow:hidden;background:${s.bg};background-image:${s.texture};}
  .frame{position:absolute;inset:70px;border:6px solid ${s.ink}22;border-radius:10px;}
  .content{position:absolute;inset:160px;display:flex;flex-direction:column;}
  .badge{align-self:flex-start;background:${s.badgeBg};color:${s.badgeInk};font-family:${s.bodyFont};font-weight:800;letter-spacing:0.12em;font-size:32px;padding:14px 26px;border-radius:4px;text-transform:uppercase;max-width:900px;line-height:1.15;word-break:normal;overflow-wrap:break-word;}
  .title{margin-top:56px;font-family:${s.titleFont};color:${s.ink};line-height:0.94;letter-spacing:-0.01em;text-transform:uppercase;max-width:1280px;word-break:normal;overflow-wrap:break-word;hyphens:none;}
  .title .accent{color:${s.accent};display:block;}
  .rule{margin-top:56px;height:4px;background:${s.divider};width:60%;}
  .subtitle{margin-top:44px;font-family:${s.bodyFont};font-weight:600;font-size:52px;line-height:1.18;color:${s.ink};max-width:1200px;word-break:normal;overflow-wrap:break-word;}
  .illustration{margin-top:auto;margin-bottom:60px;display:flex;justify-content:center;align-items:center;height:820px;}
  .illustration svg{max-width:100%;max-height:100%;}
  .chips{display:flex;gap:26px;justify-content:space-between;border-top:2px solid ${s.divider};padding-top:36px;color:${s.chipInk};}
  .chip{flex:1;text-align:center;font-family:${s.bodyFont};font-weight:800;font-size:26px;letter-spacing:0.08em;text-transform:uppercase;line-height:1.2;}
  .chip .dot{display:inline-block;width:16px;height:16px;background:${s.accent};border-radius:50%;margin-right:12px;vertical-align:middle;}
</style></head>
<body>
<div class="page">
  <div class="frame"></div>
  <div class="content">
    ${input.badge ? `<div class="badge">${esc(input.badge)}</div>` : ""}
    <div class="title" style="font-size:${fitTitleFontSize(input.title)}px;">${renderTitle(input.title, s.accent)}</div>
    ${input.subtitle ? `<div class="rule"></div><div class="subtitle">${esc(input.subtitle)}</div>` : ""}
    <div class="illustration">${input.illustrationSvg}</div>
    ${chips.length ? `<div class="chips">${chips.map((c) => `<div class="chip"><span class="dot"></span>${esc(c)}</div>`).join("")}</div>` : ""}
  </div>
</div>
</body></html>`;
}

// Break title into lines aiming for balanced widths, with a HARD max
// character count per line so no line ever overflows the 1280px safe box.
function breakTitleLines(title: string, maxCharsPerLine: number): string[] {
  const words = title.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const candidate = (cur ? cur + " " : "") + w;
    if (candidate.length > maxCharsPerLine && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = candidate;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Auto-fit title font size so the longest line fits inside the 1280px safe
// width. Uses a conservative 0.55 avg-glyph-width ratio for the display fonts.
function fitTitleFontSize(title: string): number {
  const SAFE_WIDTH = 1280;
  const AVG_GLYPH_RATIO = 0.55;
  const candidates = [230, 210, 190, 170, 150, 130, 110];
  // Try each font size; pick the largest whose longest line fits.
  for (const size of candidates) {
    // At this size, how many chars fit per line?
    const maxChars = Math.max(6, Math.floor(SAFE_WIDTH / (size * AVG_GLYPH_RATIO)));
    const lines = breakTitleLines(title, maxChars);
    const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
    if (longest * size * AVG_GLYPH_RATIO <= SAFE_WIDTH) return size;
  }
  return 110;
}

function renderTitle(title: string, _accentColor: string): string {
  const SAFE_WIDTH = 1280;
  const AVG_GLYPH_RATIO = 0.55;
  const size = fitTitleFontSize(title);
  const maxChars = Math.max(6, Math.floor(SAFE_WIDTH / (size * AVG_GLYPH_RATIO)));
  const lines = breakTitleLines(title, maxChars);
  const midIdx = lines.length >= 3 ? 1 : lines.length === 2 ? 1 : 0;
  return lines
    .map((l, i) => (i === midIdx ? `<span class="accent">${esc(l)}</span>` : `<span>${esc(l)}</span><br/>`))
    .join("");
}

export async function renderCoverFacePng(html: string): Promise<Uint8Array> {
  const token = Deno.env.get("BROWSERLESS_TOKEN");
  if (!token) throw new Error("BROWSERLESS_TOKEN missing");
  const url = `https://production-sfo.browserless.io/screenshot?token=${encodeURIComponent(token)}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      html,
      options: { type: "png", fullPage: false, clip: { x: 0, y: 0, width: 1600, height: 2400 } },
      viewport: { width: 1600, height: 2400, deviceScaleFactor: 1 },
      gotoOptions: { waitUntil: "networkidle0", timeout: 45000 },
      waitForTimeout: 800,
    }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`browserless screenshot ${resp.status}: ${t.slice(0, 300)}`);
  }
  const buf = new Uint8Array(await resp.arrayBuffer());
  if (buf.length < 5000) throw new Error("cover face PNG suspiciously small");
  return buf;
}

// ---- Topic illustration SVGs (deterministic, no AI text) ----

export function illustrationDebtExit(accent: string, ink: string): string {
  // Stairs rising to a bright doorway — matches the reference debt book.
  return `<svg viewBox="0 0 1200 800" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="glow" cx="50%" cy="18%" r="45%">
        <stop offset="0%" stop-color="${accent}" stop-opacity="0.9"/>
        <stop offset="60%" stop-color="${accent}" stop-opacity="0.15"/>
        <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="step" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="${ink}" stop-opacity="0.9"/>
        <stop offset="100%" stop-color="${ink}" stop-opacity="0.4"/>
      </linearGradient>
    </defs>
    <ellipse cx="600" cy="140" rx="520" ry="220" fill="url(#glow)"/>
    <rect x="510" y="60" width="180" height="230" rx="6" fill="${ink}" opacity="0.95"/>
    <rect x="540" y="90" width="120" height="180" fill="${accent}"/>
    <g fill="url(#step)" stroke="${accent}" stroke-width="2">
      <polygon points="200,780 1000,780 900,700 300,700"/>
      <polygon points="260,700 940,700 860,620 340,620"/>
      <polygon points="320,620 880,620 810,540 390,540"/>
      <polygon points="380,540 820,540 760,460 440,460"/>
      <polygon points="440,460 760,460 710,380 490,380"/>
      <polygon points="490,380 710,380 670,310 530,310"/>
    </g>
    <line x1="90" y1="785" x2="1110" y2="785" stroke="${accent}" stroke-width="3"/>
  </svg>`;
}

export function illustrationDeepEnergy(accent: string, ink: string): string {
  // Sunrise arc + circadian rhythm curve + leaf — wellness field-guide feel.
  return `<svg viewBox="0 0 1200 800" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="sun" cx="50%" cy="80%" r="55%">
        <stop offset="0%" stop-color="${accent}" stop-opacity="1"/>
        <stop offset="70%" stop-color="${accent}" stop-opacity="0.25"/>
        <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <circle cx="600" cy="640" r="360" fill="url(#sun)"/>
    <path d="M 120 640 A 480 480 0 0 1 1080 640" fill="none" stroke="${ink}" stroke-width="6" stroke-linecap="round"/>
    <g stroke="${ink}" stroke-width="3" stroke-linecap="round">
      <line x1="600" y1="90" x2="600" y2="150"/>
      <line x1="290" y1="200" x2="330" y2="240"/>
      <line x1="910" y1="200" x2="870" y2="240"/>
      <line x1="140" y1="440" x2="200" y2="440"/>
      <line x1="1000" y1="440" x2="1060" y2="440"/>
    </g>
    <path d="M 160 500 Q 320 340 480 500 T 800 500 T 1040 500" fill="none" stroke="${accent}" stroke-width="6" stroke-linecap="round"/>
    <g transform="translate(560,560)">
      <path d="M 40 0 C 90 -70 170 -70 220 0 C 170 70 90 70 40 0 Z" fill="${accent}" opacity="0.95"/>
      <path d="M 40 0 Q 130 -10 220 0" stroke="${ink}" stroke-width="4" fill="none"/>
    </g>
    <line x1="90" y1="720" x2="1110" y2="720" stroke="${accent}" stroke-width="3"/>
  </svg>`;
}
