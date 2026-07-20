// Premium cover overlay SVG builder — pure TypeScript, no Deno runtime deps.
//
// OWNER LAW `no_popups_v5` (2026-07-21):
//   ZERO text is ever composited on top of a coloring-book cover in the
//   normal (title-only) path. The Ideogram bake owns the title; the storefront
//   HTML owns the age chip, sale badge, and any promotional label. This
//   module intentionally draws NOTHING when a title-bake succeeded.
//
//   The only exception is the TEXTLESS FALLBACK path — used when 3 Ideogram
//   title-bake attempts all shipped gibberish. In that case the overlay
//   draws the title (and only the title) as a clean bold display font, which
//   never misspells. No chip, no banner, no ribbon, no age pill, ever.
//
// SCOPE: coloring books only (book_type='coloring_book'). Picture-book /
// adult-PDF lanes MUST NOT import this module.
//
// NOTE: This file is mirrored in supabase/functions/_shared/coloring/premium-cover-overlay.ts
// for edge-function deployment. Keep the two files in sync.

/** Frozen contract. Any cover asset whose meta.overlay !== this value is
 *  considered LEGACY and eligible for the autopilot legacy-cover sweep. */
export const COVER_OVERLAY_CONTRACT = "premium_cover_overlay_v5_no_text_ever" as const;

export function overlayIsCurrent(meta: Record<string, unknown> | null | undefined): boolean {
  return !!meta && meta.overlay === COVER_OVERLAY_CONTRACT;
}

export interface PremiumOverlayInput {
  width: number;
  height: number;
  ageBadge: string;             // e.g. "AGES 4-6"
  ribbonText?: string;          // default "SALE"
  showRibbon?: boolean;
  /** OWNER LAW v2: top chip that identifies category. Default "COLORING BOOK". */
  topLabel?: string;
  /** OWNER LAW v2: subtitle on the bottom banner. Empty = no banner line. */
  subtitle?: string;
  /** OWNER LAW v2: 1-line blurb on the bottom banner. Empty = skipped. */
  blurb?: string;
  /** OWNER LAW v2: when the art is textless (Ideogram bake failed 3x), the
   *  overlay draws the title too. Empty = art already has baked title. */
  fallbackTitle?: string;
}

function esc(s: string) {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Rough char-count wrapping — good enough for cover-scale display copy. */
function wrapLines(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = (text || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxCharsPerLine && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines) break;
    } else {
      cur = next;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  // Truncate with ellipsis if we ran out of room
  if (lines.length === maxLines) {
    const consumed = lines.join(" ").split(/\s+/).length;
    if (consumed < words.length) {
      const last = lines[maxLines - 1];
      lines[maxLines - 1] = last.length > maxCharsPerLine - 1
        ? last.slice(0, maxCharsPerLine - 1) + "…"
        : last + "…";
    }
  }
  return lines;
}

/** Build the overlay SVG string. */
export function buildOverlaySvg(input: PremiumOverlayInput): string {
  const W = input.width, H = input.height;
  const fallbackTitle = (input.fallbackTitle ?? "").trim();

  // Fallback title (only when Ideogram was asked for textless art).
  let fallbackTitleEl = "";
  if (fallbackTitle) {
    const lines = wrapLines(fallbackTitle, 14, 3);
    const boxH = Math.round(H * (lines.length === 1 ? 0.18 : lines.length === 2 ? 0.26 : 0.32));
    const boxY = Math.round(H * 0.09);
    const fontSize = Math.round(boxH / (lines.length + 0.5));
    let cy = boxY + Math.round(fontSize * 0.95);
    const lineEls = lines.map((ln) => {
      const el = `<text x="${W / 2}" y="${cy}" text-anchor="middle" font-family="Fredoka" font-weight="700" font-size="${fontSize}" fill="#FFFFFF" stroke="#0F172A" stroke-width="${Math.max(4, Math.round(fontSize * 0.08))}" paint-order="stroke fill">${esc(ln)}</text>`;
      cy += Math.round(fontSize * 1.05);
      return el;
    }).join("");
    fallbackTitleEl = lineEls;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${fallbackTitleEl}
  <!-- ${COVER_OVERLAY_CONTRACT}: NO chip, NO banner, NO ribbon, NO pill, NO age mark. -->
</svg>`;
}

/** Assert that generated SVG contains no popup elements. Throws on violation.
 *  Exported so the edge function can fail fast at module load, and so tests can
 *  exercise it directly. */
export function assertOverlaySvgNoPopups(svg: string, svgFallback: string): void {
  const markupOnly = (s: string) => s.replace(/<!--[\s\S]*?-->/g, "").replace(/<\?xml[^?]*\?>/g, "");

  // Title-only mode: the SVG must contain no drawing elements at all.
  const noComment = markupOnly(svg);
  const hasAnyElement = /<(?:path|rect|circle|ellipse|polygon|polyline|line|g|text|tspan|image|foreignObject)[\s>]/i.test(noComment);
  if (hasAnyElement) {
    throw new Error(`premium-cover-overlay regression: ${COVER_OVERLAY_CONTRACT} title-only SVG must contain no drawing elements`);
  }

  // Textless-fallback mode: the ONLY allowed element is <text> for the title.
  const noCommentFallback = markupOnly(svgFallback);
  const hasNonTextElement = /<(?:path|rect|circle|ellipse|polygon|polyline|line|g|image|foreignObject)[\s>]/i.test(noCommentFallback);
  if (hasNonTextElement) {
    throw new Error(`premium-cover-overlay regression: ${COVER_OVERLAY_CONTRACT} textless-fallback SVG must contain only <text> elements`);
  }

  // No banned popup words or typical age-badge/sale-ribbon text may appear in the
  // actual SVG content. Comments are stripped first so owner-law notes do not
  // false-positive.
  const banned = [/\bribbon\b/i, /\bbanner\b/i, /\bchip\b/i, /\bage\s*\d/i, /\bSALE\b/i, /\bAGES\b/i, /fill="rgb\(255,\s*221/i];
  for (const re of banned) {
    if (re.test(noComment) || re.test(noCommentFallback)) {
      throw new Error(`premium-cover-overlay regression: ${COVER_OVERLAY_CONTRACT} must never contain popup markers (matched ${re})`);
    }
  }
}

/** Run the regression guard at module load time. */
export function runOverlayModuleGuard(): void {
  const svg = buildOverlaySvg({ width: 1024, height: 1024, ageBadge: "AGES 4-6" });
  const svgFallback = buildOverlaySvg({ width: 1024, height: 1024, ageBadge: "AGES 4-6", fallbackTitle: "My Title" });
  assertOverlaySvgNoPopups(svg, svgFallback);
}

// Fail-fast self-check for edge-function load.
runOverlayModuleGuard();
