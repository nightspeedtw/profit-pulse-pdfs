// Build step (Search Console 2026-11-13: every sitemap URL had canonical "/", so Google treated /library,
// /kids, /blog, /categories, /bundles and /about as copies of the home page). Writes dist/<route>/index.html
// for each sitemap route with its own absolute canonical and og:url. Tags carry data-rh="true" so
// react-helmet-async replaces them on pages that set their own (no duplicate canonical). SEO only: this does
// not touch the book pipeline.
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { HOME_FAQ } from "../src/content/homeFaq";

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

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** JSON-LD only for the home page: WebPage (date, author) and FAQPage for the visible FAQ. */
export function homeJsonLd(date: string): string {
  const page = { "@context": "https://schema.org", "@type": "WebPage", "@id": `${SITE}/#webpage`, url: `${SITE}/`, name: "SecretPDF", isPartOf: { "@id": `${SITE}/#website` }, inLanguage: "en", author: { "@id": `${SITE}/#organization` }, dateModified: date };
  const faq = { "@context": "https://schema.org", "@type": "FAQPage", "@id": `${SITE}/#faq`, url: `${SITE}/`, inLanguage: "en", dateModified: date, mainEntity: HOME_FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) };
  return [page, faq].map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`).join("\n    ");
}

const CATEGORIES: [string, string][] = [
  ["study", "Study & Exam"], ["business", "Business & Templates"], ["wellness", "Wellness & Mind"],
  ["fitness", "Fitness & Meal Plans"], ["parenting", "Parenting & Kids"], ["coloring-books", "Coloring Books"],
  ["lifestyle", "Lifestyle & Planners"], ["creative", "Art & Creative"], ["cooking", "Cooking & Recipes"],
];

/**
 * Home page text for crawlers that do not run JavaScript (GEO audit 2026-11-14: the home HTML had 7 words).
 * Every sentence repeats copy the live site already shows (Hero, ValueProps, CategoryGrid, footer, legal pages);
 * nothing new is claimed. React replaces it on load.
 */
export function homeBody(paths: string[], date: string): string {
  const d = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const nav = paths.map((p) => `<li><a href="${p}">${label(p)}</a></li>`).join("");
  const cats = CATEGORIES.map(([s, l]) => `<li><a href="/category/${s}">${l}</a></li>`).join("");
  return `<header><p>SecretPDF</p><nav aria-label="Site"><ul>${nav}</ul></nav></header>
<main>
<h1>Printable knowledge, on demand.</h1>
<p>SecretPDF is a library of digital PDFs that you download and print yourself. Pick a guide, planner, template or coloring book, download the file straight away and print as many copies as you want. The library covers ${CATEGORIES.length} topics, from study and business to cooking and parenting, plus a separate section of coloring books and illustrated story books for kids. This page was last updated on <time datetime="${date}">${d}</time> by <a rel="author" href="/about">SecretPDF</a>.</p>
<h2>Why buy a PDF from SecretPDF</h2>
<ul>
<li><strong>Instant delivery.</strong> Download your PDF the second your payment clears. No waiting, no shipping.</li>
<li><strong>Watermarked and secure.</strong> Each file is uniquely fingerprinted to your purchase for safe ownership.</li>
<li><strong>30-day refund.</strong> Not what you expected? Read the <a href="/refund-policy">refund policy</a>.</li>
<li><strong>Unlimited copies.</strong> Make as many copies of the file at home as you need.</li>
<li><strong>Lifetime access.</strong> Your purchases stay in your account library, so you can download them again later.</li>
</ul>
<h2>Browse by category</h2>
<ul>${cats}</ul>
<h3>For kids</h3>
<p>The <a href="/kids">kids section</a> has printable coloring books and illustrated story books for children.</p>
<h2>How it works</h2>
<ol>
<li>Find a PDF in the <a href="/library">library</a> or browse the <a href="/categories">categories</a>.</li>
<li>Check out and pay. Paddle is the Merchant of Record for every order and also handles refunds.</li>
<li>Download the file from your account and use it at home.</li>
</ol>
<h3>About the file format</h3>
<p>Every product is a standard PDF, the document format published as the international standard <a href="https://www.iso.org/standard/75839.html" rel="noopener">ISO 32000-2:2020</a>, so it opens on phones, tablets and computers and looks the same on every device.</p>
<h2>Questions</h2>
${HOME_FAQ.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join("\n")}
<h2>Help and contact</h2>
<p>Questions about an order? Email <a href="mailto:support@secretpdf.co">support@secretpdf.co</a>. Privacy questions go to <a href="mailto:privacy@secretpdf.co">privacy@secretpdf.co</a>. Read our <a href="/terms">terms</a>, <a href="/privacy">privacy notice</a> and the <a href="/about">about page</a>. SecretPDF is operated by Sandking Company Limited.</p>
</main>`;
}

export function writeCanonicalRoutes(dist: string, sitemapXml: string, date = new Date().toISOString().slice(0, 10)): number {
  const template = readFileSync(join(dist, "index.html"), "utf8").replace(/__BUILD_DATE__/g, date);
  let n = 0;
  const paths = sitemapPaths(sitemapXml);
  for (const p of paths) {
    const dir = p === "/" ? dist : join(dist, p);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), p === "/"
      ? withCanonical(template, p)
          .replace("</head>", `    ${homeJsonLd(date)}\n  </head>`)
          .replace('<div id="root"></div>', `<div id="root">${homeBody(paths, date)}</div>`)
      : withCrawlableLinks(withCanonical(template, p), paths));
    n++;
  }
  return n;
}
