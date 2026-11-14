// Build step (Search Console 2026-11-13: every sitemap URL had canonical "/", so Google treated /library,
// /kids, /blog, /categories, /bundles and /about as copies of the home page). Writes dist/<route>/index.html
// for each sitemap route with its own absolute canonical and og:url. Tags carry data-rh="true" so
// react-helmet-async replaces them on pages that set their own (no duplicate canonical). SEO only: this does
// not touch the book pipeline.
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

export const SITE = "https://secretpdf.co";

export function sitemapPaths(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => new URL(m[1].trim()).pathname.replace(/\/+$/, "") || "/")
    .filter((p, i, a) => a.indexOf(p) === i);
}

export function withCanonical(template: string, path: string): string {
  const url = path === "/" ? `${SITE}/` : `${SITE}${path}`;
  const tags = `<link data-rh="true" rel="canonical" href="${url}" />\n    <meta data-rh="true" property="og:url" content="${url}" />`;
  const stripped = template
    .replace(/\s*<link[^>]*rel="canonical"[^>]*>/g, "")
    .replace(/\s*<meta[^>]*property="og:url"[^>]*>/g, "");
  return stripped.replace("</head>", `    ${tags}\n  </head>`);
}

const LABELS: Record<string, string> = { "/": "Home" };
const label = (p: string) => LABELS[p] ?? p.slice(1).replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

/**
 * GEO audit 2026-11-14: the served HTML had no <a href> links (empty #root), so crawlers that do not run
 * JavaScript saw no way into the site. Put plain links to every sitemap route inside #root; React replaces
 * them on load (createRoot), so visitors see no change.
 */
export function withCrawlableLinks(html: string, paths: string[]): string {
  const links = paths.map((p) => `<li><a href="${p}">${label(p)}</a></li>`).join("");
  return html.replace('<div id="root"></div>', `<div id="root"><nav aria-label="Site"><ul>${links}</ul></nav></div>`);
}

export function writeCanonicalRoutes(dist: string, sitemapXml: string): number {
  const template = readFileSync(join(dist, "index.html"), "utf8");
  let n = 0;
  const paths = sitemapPaths(sitemapXml);
  for (const p of paths) {
    const dir = p === "/" ? dist : join(dist, p);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), withCrawlableLinks(withCanonical(template, p), paths));
    n++;
  }
  return n;
}
