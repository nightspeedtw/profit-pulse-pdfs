import { describe, expect, it } from "vitest";
import { sitemapPaths, withCanonical, withCrawlableLinks } from "../../scripts/canonical-routes";

const tpl = '<html><head>\n<title>x</title>\n<link rel="canonical" href="/" />\n</head><body></body></html>';

describe("canonical-routes", () => {
  it("reads sitemap paths", () => {
    expect(sitemapPaths("<loc>https://secretpdf.co/</loc><loc>https://secretpdf.co/about</loc>")).toEqual(["/", "/about"]);
  });
  it("gives each route one absolute self canonical", () => {
    const html = withCanonical(tpl, "/library");
    expect(html.match(/rel="canonical"/g)).toHaveLength(1);
    expect(html).toContain('<link data-rh="true" rel="canonical" href="https://secretpdf.co/library" />');
    expect(withCanonical(tpl, "/")).toContain('href="https://secretpdf.co/"');
  });
  it("puts crawlable links to every route inside #root", () => {
    const html = withCrawlableLinks('<body><div id="root"></div></body>', ["/", "/library", "/about"]);
    expect(html).toContain('<a href="/library">Library</a>');
    expect(html).toContain('<a href="/">Home</a>');
    expect(html.match(/<a href=/g)).toHaveLength(3);
  });
});
