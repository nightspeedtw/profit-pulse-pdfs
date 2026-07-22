// Pre-raster canonical-source guard for coloring covers.
//
// OWNER LAW `cover_v2_deterministic_typography` (2026-07-22, PERMANENT):
//   Every glyph in the final cover comes from CANONICAL METADATA
//   (ebooks_kids.title + optional subtitle + optional ageBadge). The
//   illustration model may never supply the letters. Before we rasterize
//   the typography layer we MUST prove that every <text> node in the SVG
//   is one of the approved token strings, and that the union of node
//   text covers every canonical title token in order.
//
// This runs BEFORE OCR. OCR is the final independent visual check; source
// verification is the primary spelling truth.

export interface CanonicalSource {
  title: string;
  subtitle?: string | null;
  ageBadge?: string | null;
  brandName?: string | null; // "SecretPDF Kids"
}

export interface SourceVerdict {
  pass: boolean;
  reason: string | null;
  approved_tokens: string[];
  found_text_nodes: string[];
  unapproved_nodes: string[];
  missing_required: string[];
}

function normTokens(s: string): string[] {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function buildApprovedTokenSet(src: CanonicalSource): Set<string> {
  const set = new Set<string>();
  for (const t of normTokens(src.title)) set.add(t);
  if (src.subtitle) for (const t of normTokens(src.subtitle)) set.add(t);
  if (src.ageBadge) for (const t of normTokens(src.ageBadge)) set.add(t);
  if (src.brandName) for (const t of normTokens(src.brandName)) set.add(t);
  // Neutral connectors permitted anywhere.
  ["a", "an", "the", "of", "and", "&", "for", "to", "in"].forEach((t) => set.add(t));
  return set;
}

// Extract every visible text run from an SVG string.
export function extractSvgTextNodes(svg: string): string[] {
  const out: string[] = [];
  // <text ...>content</text> including nested <tspan>
  const re = /<text\b[^>]*>([\s\S]*?)<\/text>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) {
    const inner = m[1]
      .replace(/<tspan\b[^>]*>/gi, "")
      .replace(/<\/tspan>/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
    if (inner.length > 0) out.push(inner);
  }
  return out;
}

export function verifyTypographySource(svg: string, src: CanonicalSource): SourceVerdict {
  const approved = buildApprovedTokenSet(src);
  const nodes = extractSvgTextNodes(svg);
  const unapproved: string[] = [];
  const foundTokens = new Set<string>();

  // Per-glyph SVG renderers emit one <text> node per letter. Reconstruct
  // words by treating single-character nodes as a contiguous glyph stream
  // and multi-character nodes as whole tokens.
  let glyphStream = "";
  for (const node of nodes) {
    const raw = node.trim();
    if (raw.length === 0) continue;
    if (raw.length === 1) {
      glyphStream += raw;
      continue;
    }
    // Multi-char node: tokenize normally.
    const toks = normTokens(raw);
    for (const t of toks) {
      if (approved.has(t)) foundTokens.add(t);
      else unapproved.push(`${raw}::${t}`);
    }
  }

  // Longest-match parse of the glyph stream against approved tokens.
  if (glyphStream.length > 0) {
    const stream = glyphStream.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const approvedList = Array.from(approved).sort((a, b) => b.length - a.length);
    let i = 0;
    while (i < stream.length) {
      let matched = "";
      for (const tok of approvedList) {
        if (tok.length === 0) continue;
        if (stream.startsWith(tok, i)) { matched = tok; break; }
      }
      if (matched) {
        foundTokens.add(matched);
        i += matched.length;
      } else {
        // Unknown letter run — collect up to next approved token boundary.
        let j = i + 1;
        while (j < stream.length) {
          let hit = false;
          for (const tok of approvedList) {
            if (tok && stream.startsWith(tok, j)) { hit = true; break; }
          }
          if (hit) break;
          j++;
        }
        unapproved.push(`glyph_run::${stream.slice(i, j)}`);
        i = j;
      }
    }
  }

  const canonicalRequired = normTokens(src.title);
  const missing = canonicalRequired.filter((t) => !foundTokens.has(t));

  const reasons: string[] = [];
  if (unapproved.length > 0) reasons.push(`unapproved_glyphs=${unapproved.slice(0, 4).join("|")}`);
  if (missing.length > 0) reasons.push(`missing_canonical=${missing.slice(0, 4).join(",")}`);

  return {
    pass: reasons.length === 0,
    reason: reasons.length === 0 ? null : reasons.join(";"),
    approved_tokens: Array.from(approved),
    found_text_nodes: nodes,
    unapproved_nodes: unapproved,
    missing_required: missing,
  };
}

export function assertTypographySource(svg: string, src: CanonicalSource): SourceVerdict {
  const v = verifyTypographySource(svg, src);
  if (!v.pass) {
    throw new Error(`typography_source_violation:${v.reason}`);
  }
  return v;
}
