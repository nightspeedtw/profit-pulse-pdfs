// Deterministic cover title overlay compositor.
//
// Renders the exact title + subtitle text over a textless AI cover master via
// Browserless (headless Chrome screenshot). This is the ONLY way title spelling
// is guaranteed correct — never trust the image model to bake text.
//
// Input: a signed URL to the textless cover master + title/subtitle strings.
// Output: PNG bytes of the composed cover (title guaranteed spelled correctly).
//
// If Browserless is unavailable, throws — repair loop marks the finding as
// needs_admin_attention rather than shipping a garbled cover.

const BROWSERLESS_TOKEN = Deno.env.get("BROWSERLESS_TOKEN");

export interface OverlayOpts {
  coverImageUrl: string;
  title: string;
  subtitle?: string | null;
  width?: number;   // px, default 800
  height?: number;  // px, default 1200 (2:3 ratio)
  titlePosition?: "top" | "bottom";
  accentHex?: string; // background scrim tint
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export function buildOverlayHtml(opts: OverlayOpts): string {
  const w = opts.width ?? 800;
  const h = opts.height ?? 1200;
  const pos = opts.titlePosition ?? "top";
  const title = escapeHtml(opts.title.trim());
  const subtitle = opts.subtitle ? escapeHtml(opts.subtitle.trim()) : "";
  const scrimGradient = pos === "top"
    ? "linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.25) 40%, rgba(0,0,0,0) 55%)"
    : "linear-gradient(to top, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.25) 40%, rgba(0,0,0,0) 55%)";
  const titleTop = pos === "top" ? "5%" : "auto";
  const titleBottom = pos === "bottom" ? "6%" : "auto";
  // Title lettering: a warm illustrated storybook display face.
  // Fraunces has soft optical sizes and reads well at thumbnail.
  return `<!doctype html>
<html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700;9..144,900&family=Nunito:wght@600;800&display=swap" rel="stylesheet">
<style>
  html, body { margin: 0; padding: 0; width: ${w}px; height: ${h}px; overflow: hidden; }
  .stage { position: relative; width: ${w}px; height: ${h}px; }
  .art  { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .scrim { position: absolute; inset: 0; background: ${scrimGradient}; }
  .title-block {
    position: absolute; left: 6%; right: 6%;
    top: ${titleTop}; bottom: ${titleBottom};
    color: #fffdf5;
    text-align: center;
    text-shadow: 0 4px 18px rgba(0,0,0,0.45), 0 1px 0 rgba(0,0,0,0.35);
    font-family: 'Fraunces', 'Georgia', serif;
  }
  .title {
    font-weight: 900;
    font-size: ${Math.round(w * 0.11)}px;
    line-height: 1.02;
    letter-spacing: -0.01em;
    margin: 0 0 ${Math.round(w * 0.015)}px 0;
    font-variation-settings: "opsz" 144;
  }
  .sub {
    font-family: 'Nunito', 'Inter', sans-serif;
    font-weight: 700;
    font-size: ${Math.round(w * 0.032)}px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    opacity: 0.95;
    margin: 0;
  }
</style></head>
<body>
  <div class="stage">
    <img class="art" src="${escapeHtml(opts.coverImageUrl)}" crossorigin="anonymous"/>
    <div class="scrim"></div>
    <div class="title-block">
      <h1 class="title">${title}</h1>
      ${subtitle ? `<p class="sub">${subtitle}</p>` : ""}
    </div>
  </div>
</body></html>`;
}

export async function composeCoverTitle(opts: OverlayOpts): Promise<Uint8Array> {
  if (!BROWSERLESS_TOKEN) {
    throw new Error("BROWSERLESS_TOKEN not configured — cannot compose cover title overlay");
  }
  const html = buildOverlayHtml(opts);
  const w = opts.width ?? 800;
  const h = opts.height ?? 1200;
  const url = `https://production-sfo.browserless.io/screenshot?token=${BROWSERLESS_TOKEN}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      html,
      options: { type: "png", fullPage: false, omitBackground: false },
      viewport: { width: w, height: h, deviceScaleFactor: 1 },
      gotoOptions: { waitUntil: "networkidle0", timeout: 30000 },
      waitForTimeout: 800,
    }),
  });
  if (!res.ok) {
    throw new Error(`browserless screenshot ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}
