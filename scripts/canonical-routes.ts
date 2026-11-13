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

export function writeCanonicalRoutes(dist: string, sitemapXml: string): number {
  const template = readFileSync(join(dist, "index.html"), "utf8");
  let n = 0;
  for (const p of sitemapPaths(sitemapXml)) {
    const dir = p === "/" ? dist : join(dist, p);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), withCanonical(template, p));
    n++;
  }
  return n;
}
