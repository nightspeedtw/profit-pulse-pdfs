import { describe, expect, it } from "vitest";
import { sitemapPaths, withCanonical } from "../../scripts/canonical-routes";

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
});
