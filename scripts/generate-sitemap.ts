// Runs before `vite dev` and `vite build`; writes public/sitemap.xml.
// Includes static routes + all live kids products + all published blog posts.
import { writeFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = "https://secretpdf.co";
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? "https://atccyjuwimibyoocpiwi.supabase.co";
const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? "";

type Entry = { path: string; lastmod?: string; changefreq?: string; priority?: string };

const staticEntries: Entry[] = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/library", changefreq: "daily", priority: "0.9" },
  { path: "/kids", changefreq: "daily", priority: "0.9" },
  { path: "/categories", changefreq: "weekly", priority: "0.7" },
  { path: "/bundles", changefreq: "weekly", priority: "0.7" },
  { path: "/about", changefreq: "monthly", priority: "0.5" },
  { path: "/blog", changefreq: "daily", priority: "0.9" },
];

async function fetchDynamic(): Promise<Entry[]> {
  if (!ANON) return [];
  try {
    const sb = createClient(SUPABASE_URL, ANON);
    const [{ data: kids }, { data: posts }] = await Promise.all([
      sb.from("ebooks_kids").select("id,updated_at").eq("listing_status", "live").eq("sellable", true),
      sb.from("blog_posts").select("slug,updated_at").eq("status", "published"),
    ]);
    const kidsE: Entry[] = (kids ?? []).map((k: any) => ({
      path: `/kids/coloring/${k.id}`, lastmod: k.updated_at?.slice(0, 10), changefreq: "weekly", priority: "0.8",
    }));
    const postsE: Entry[] = (posts ?? []).map((p: any) => ({
      path: `/blog/${p.slug}`, lastmod: p.updated_at?.slice(0, 10), changefreq: "monthly", priority: "0.7",
    }));
    return [...kidsE, ...postsE];
  } catch (e) {
    console.warn("[sitemap] dynamic fetch failed:", (e as Error).message);
    return [];
  }
}

function render(entries: Entry[]): string {
  const urls = entries.map((e) => [
    "  <url>", `    <loc>${BASE_URL}${e.path}</loc>`,
    e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>` : null,
    e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
    e.priority ? `    <priority>${e.priority}</priority>` : null,
    "  </url>",
  ].filter(Boolean).join("\n"));
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...urls, `</urlset>`,
  ].join("\n");
}

(async () => {
  const dyn = await fetchDynamic();
  const all = [...staticEntries, ...dyn];
  writeFileSync(resolve("public/sitemap.xml"), render(all));
  console.log(`sitemap.xml written (${all.length} entries)`);
})();
