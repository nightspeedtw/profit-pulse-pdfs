import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { supabase } from "@/integrations/supabase/client";
import { ProductStrip } from "@/components/blog/ProductStrip";
import { resolveBlogImage, fallbackBlogImage } from "@/lib/blogImage";

type Author = {
  id: string; slug: string; full_name: string; photo_url: string | null;
  job_title: string | null; biography: string | null; author_page_url: string | null;
  expertise: string[] | null; social_links: Record<string, string> | null;
};

type Reviewer = {
  id: string; slug: string; full_name: string; credentials: string | null; photo_url: string | null;
};

type Post = {
  id: string; slug: string; title: string; dek: string | null;
  category: string | null; hero_image_url: string | null;
  body_md: string; faq: Array<{ q: string; a: string }> | null;
  product_ids: string[] | null; published_at: string;
  meta_title: string | null; meta_description: string | null; word_count: number | null;
  primary_keyword: string | null; secondary_keywords: string[] | null;
  // v2 fields
  direct_answer: string | null; takeaways: string[] | null;
  sources: Array<{ title: string; url: string }> | null;
  reading_time_min: number | null; last_updated_at: string | null;
  canonical_url: string | null; og_image: string | null; robots: string | null;
  noindex: boolean | null; redirects_to: string | null;
  article_section: string | null; tags: string[] | null; toc_enabled: boolean | null;
  cluster_id: string | null; parent_pillar_id: string | null;
  long_tail_questions: string[] | null; entities: string[] | null;
  author_id: string | null; reviewer_id: string | null; reviewed_at: string | null;
};

type Product = {
  id: string; title: string; thumbnail_url: string | null; cover_url: string | null;
  price_cents: number | null; category: string | null;
};

const SITE = "https://secretpdf.co";

function slugifyHeading(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 80);
}

function extractHeadings(md: string): Array<{ level: 2 | 3; text: string; id: string }> {
  const out: Array<{ level: 2 | 3; text: string; id: string }> = [];
  md.split("\n").forEach((line) => {
    const m3 = line.match(/^###\s+(.+)/);
    const m2 = line.match(/^##\s+(.+)/);
    if (m2) out.push({ level: 2, text: m2[1].trim(), id: slugifyHeading(m2[1]) });
    else if (m3) out.push({ level: 3, text: m3[1].trim(), id: slugifyHeading(m3[1]) });
  });
  return out;
}

function renderMarkdown(md: string, products: Product[]): string {
  let html = md.replace(/\[BOOK_LINK:([a-f0-9-]+)\]/gi, (_, id) => {
    const p = products.find((x) => x.id === id);
    if (!p) return "";
    return ` <a href="/kids/coloring/${p.id}" class="text-primary underline font-semibold">${p.title}</a> `;
  });
  html = html
    .replace(/^### (.+)$/gm, (_, t) => `<h3 id="${slugifyHeading(t)}" class="font-display text-xl mt-8 mb-3 scroll-mt-24">${t}</h3>`)
    .replace(/^## (.+)$/gm, (_, t) => `<h2 id="${slugifyHeading(t)}" class="font-display text-3xl mt-12 mb-4 scroll-mt-24">${t}</h2>`)
    .replace(/^# (.+)$/gm, '<h1 class="font-display text-4xl mb-6">$1</h1>')
    .replace(/^\* (.+)$/gm, '<li>$1</li>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul class="list-disc pl-6 space-y-2 my-4">${m}</ul>`)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" class="text-primary underline" target="_blank" rel="noopener nofollow">$1</a>')
    .replace(/\n\n/g, '</p><p class="mb-4 leading-relaxed">');
  return `<p class="mb-4 leading-relaxed">${html}</p>`;
}

export default function BlogPost() {
  const { slug } = useParams();
  const [post, setPost] = useState<Post | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [author, setAuthor] = useState<Author | null>(null);
  const [reviewer, setReviewer] = useState<Reviewer | null>(null);
  const [heroSrc, setHeroSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      const { data } = await supabase.from("blog_posts").select("*")
        .eq("slug", slug).eq("status", "published").maybeSingle();
      if (!data) { setLoading(false); return; }
      const p = data as unknown as Post;

      // Client-side redirect honoring
      if (p.redirects_to) { window.location.replace(p.redirects_to); return; }
      setPost(p);

      const jobs: Promise<unknown>[] = [];
      if (p.product_ids?.length) {
        jobs.push((async () => {
          const { data: prods } = await supabase.from("ebooks_kids")
            .select("id,title,thumbnail_url,cover_url,price_cents,category")
            .in("id", p.product_ids as string[]);
          setProducts(((prods ?? []) as unknown) as Product[]);
        })());
      }
      if (p.author_id) {
        jobs.push((async () => {
          const { data: a } = await supabase.from("blog_authors").select("*").eq("id", p.author_id as string).maybeSingle();
          if (a) setAuthor(a as unknown as Author);
        })());
      }
      if (p.reviewer_id) {
        jobs.push((async () => {
          const { data: r } = await supabase.from("blog_reviewers").select("*").eq("id", p.reviewer_id as string).maybeSingle();
          if (r) setReviewer(r as unknown as Reviewer);
        })());
      }
      await Promise.all(jobs);
      setLoading(false);
    })();
  }, [slug]);

  const headings = useMemo(() => post ? extractHeadings(post.body_md) : [], [post]);

  if (loading) return <div className="container py-24 text-center text-foreground/60">Loading…</div>;
  if (!post) return <div className="container py-24 text-center">Post not found. <Link to="/blog" className="text-primary underline">Back to blog</Link></div>;

  const canonical = post.canonical_url || `${SITE}/blog/${post.slug}`;
  const metaTitle = post.meta_title || `${post.title} | SecretPDF`;
  const metaDesc = post.meta_description || post.dek || "";
  const ogImg = post.og_image || post.hero_image_url || undefined;
  const readingMin = post.reading_time_min || Math.max(1, Math.round((post.word_count ?? 800) / 220));
  const lastUpdated = post.last_updated_at || post.published_at;

  const breadcrumbs = [
    { name: "Home", url: `${SITE}/` },
    { name: "Blog", url: `${SITE}/blog` },
    ...(post.category ? [{ name: post.category, url: `${SITE}/blog?category=${encodeURIComponent(post.category)}` }] : []),
    { name: post.title, url: canonical },
  ];

  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: metaDesc,
    image: ogImg ? [ogImg] : undefined,
    datePublished: post.published_at,
    dateModified: lastUpdated,
    author: author ? {
      "@type": "Person",
      name: author.full_name,
      url: author.author_page_url || `${SITE}/authors/${author.slug}`,
      jobTitle: author.job_title || undefined,
      image: author.photo_url || undefined,
    } : { "@type": "Organization", name: "SecretPDF Kids" },
    reviewedBy: reviewer ? {
      "@type": "Person", name: reviewer.full_name,
      jobTitle: reviewer.credentials || undefined,
    } : undefined,
    publisher: {
      "@type": "Organization", name: "SecretPDF",
      logo: { "@type": "ImageObject", url: `${SITE}/favicon.png` },
    },
    mainEntityOfPage: canonical,
    keywords: [post.primary_keyword, ...(post.secondary_keywords ?? [])].filter(Boolean).join(", "),
    articleSection: post.article_section || post.category || undefined,
    wordCount: post.word_count || undefined,
    inLanguage: "en",
  };

  const breadcrumbLd = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: breadcrumbs.map((b, i) => ({
      "@type": "ListItem", position: i + 1, name: b.name, item: b.url,
    })),
  };

  const faqLd = post.faq?.length ? {
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: post.faq.map((f) => ({
      "@type": "Question", name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  } : null;

  const robots = post.noindex ? "noindex,nofollow" : (post.robots || "index,follow");

  return (
    <article className="container max-w-3xl py-12">
      <Helmet>
        <title>{metaTitle}</title>
        <meta name="description" content={metaDesc} />
        <link rel="canonical" href={canonical} />
        <meta name="robots" content={robots} />
        <meta property="og:title" content={metaTitle} />
        <meta property="og:description" content={metaDesc} />
        <meta property="og:type" content="article" />
        <meta property="og:url" content={canonical} />
        {ogImg && <meta property="og:image" content={ogImg} />}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={metaTitle} />
        <meta name="twitter:description" content={metaDesc} />
        {ogImg && <meta name="twitter:image" content={ogImg} />}
        <meta property="article:published_time" content={post.published_at} />
        <meta property="article:modified_time" content={lastUpdated} />
        {post.article_section && <meta property="article:section" content={post.article_section} />}
        {(post.tags ?? []).map((t) => <meta key={t} property="article:tag" content={t} />)}
        <script type="application/ld+json">{JSON.stringify(articleLd)}</script>
        <script type="application/ld+json">{JSON.stringify(breadcrumbLd)}</script>
        {faqLd && <script type="application/ld+json">{JSON.stringify(faqLd)}</script>}
      </Helmet>

      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="text-sm text-foreground/60 mb-6">
        <ol className="flex flex-wrap items-center gap-1">
          {breadcrumbs.map((b, i) => (
            <li key={b.url} className="flex items-center gap-1">
              {i > 0 && <span className="text-foreground/30">/</span>}
              {i < breadcrumbs.length - 1
                ? <Link to={b.url.replace(SITE, "") || "/"} className="hover:text-primary">{b.name}</Link>
                : <span className="text-foreground/80" aria-current="page">{b.name}</span>}
            </li>
          ))}
        </ol>
      </nav>

      <header className="my-8">
        {post.category && (
          <p className="text-[11px] uppercase tracking-[0.2em] text-accent font-semibold mb-3">{post.category}</p>
        )}
        <h1 className="font-display text-4xl md:text-5xl leading-tight mb-4">{post.title}</h1>
        {post.dek && <p className="text-xl text-foreground/70 leading-relaxed">{post.dek}</p>}

        <div className="flex flex-wrap items-center gap-3 text-sm text-foreground/60 mt-6">
          {author && (
            <Link to={author.author_page_url || `/authors/${author.slug}`} className="flex items-center gap-2 hover:text-primary">
              {author.photo_url && <img src={author.photo_url} alt={author.full_name} className="w-7 h-7 rounded-full object-cover" />}
              <span className="font-medium text-foreground/80">{author.full_name}</span>
            </Link>
          )}
          {reviewer && (
            <span className="text-foreground/60">
              · Reviewed by <span className="font-medium text-foreground/80">{reviewer.full_name}</span>
              {reviewer.credentials && <span className="text-foreground/50">, {reviewer.credentials}</span>}
            </span>
          )}
          <span>·</span>
          <time dateTime={post.published_at}>
            {new Date(post.published_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
          </time>
          {lastUpdated && lastUpdated !== post.published_at && (
            <span className="text-foreground/50">· Updated {new Date(lastUpdated).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}</span>
          )}
          <span>·</span>
          <span>{readingMin} min read</span>
        </div>
      </header>

      {post.hero_image_url && (
        <div className="aspect-[16/9] rounded-2xl overflow-hidden mb-10 bg-secondary">
          <img src={post.hero_image_url} alt={post.title} loading="eager" fetchPriority="high" className="w-full h-full object-cover" />
        </div>
      )}

      {/* Direct-answer box (AEO/GEO) */}
      {post.direct_answer && (
        <aside className="mb-10 p-6 rounded-2xl border border-primary/20 bg-primary/5">
          <p className="text-xs uppercase tracking-widest text-primary font-semibold mb-2">Quick answer</p>
          <p className="text-lg leading-relaxed text-foreground/90">{post.direct_answer}</p>
        </aside>
      )}

      {/* Key takeaways */}
      {post.takeaways && post.takeaways.length > 0 && (
        <aside className="mb-10 p-6 rounded-2xl bg-secondary/60">
          <p className="font-display text-lg mb-3">Key takeaways</p>
          <ul className="list-disc pl-5 space-y-2 text-foreground/85">
            {post.takeaways.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </aside>
      )}

      {/* TOC */}
      {post.toc_enabled !== false && headings.length >= 3 && (
        <nav aria-label="Table of contents" className="mb-10 p-6 rounded-2xl border border-border bg-background">
          <p className="text-xs uppercase tracking-widest text-foreground/60 font-semibold mb-3">On this page</p>
          <ol className="space-y-2 text-sm">
            {headings.map((h) => (
              <li key={h.id} className={h.level === 3 ? "pl-4" : ""}>
                <a href={`#${h.id}`} className="text-primary/90 hover:text-primary hover:underline">{h.text}</a>
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div className="prose prose-lg max-w-none text-foreground/90"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(post.body_md, products) }} />

      {/* Sources / citations (E-E-A-T) */}
      {post.sources && post.sources.length > 0 && (
        <section className="mt-16 pt-10 border-t border-border">
          <h2 className="font-display text-2xl mb-4">Sources &amp; citations</h2>
          <ol className="list-decimal pl-5 space-y-2 text-sm text-foreground/80">
            {post.sources.map((s, i) => (
              <li key={i}>
                <a href={s.url} target="_blank" rel="noopener nofollow" className="text-primary underline">{s.title || s.url}</a>
              </li>
            ))}
          </ol>
        </section>
      )}

      {products.length > 0 && (
        <section className="mt-16 pt-10 border-t border-border">
          <h2 className="font-display text-2xl mb-6">Featured in this post</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {products.map((p) => (
              <Link key={p.id} to={`/kids/coloring/${p.id}`} className="group block">
                <div className="aspect-square rounded-xl overflow-hidden bg-secondary mb-2">
                  <img src={p.thumbnail_url ?? p.cover_url ?? ""} alt={p.title} loading="lazy"
                    className="w-full h-full object-contain bg-white group-hover:scale-105 transition-transform" />
                </div>
                <p className="text-sm font-medium leading-tight line-clamp-2">{p.title}</p>
                <p className="text-sm text-foreground/60 mt-1">${((p.price_cents ?? 499) / 100).toFixed(2)}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {post.faq && post.faq.length > 0 && (
        <section className="mt-16 pt-10 border-t border-border">
          <h2 className="font-display text-3xl mb-6">Frequently asked</h2>
          <div className="space-y-6">
            {post.faq.map((f, i) => (
              <details key={i} className="group border-b border-border/60 pb-4" open={i === 0}>
                <summary className="font-semibold text-lg cursor-pointer list-none flex justify-between items-center">
                  <span>{f.q}</span>
                  <span className="text-primary text-xl group-open:rotate-45 transition-transform">+</span>
                </summary>
                <p className="text-foreground/80 leading-relaxed mt-3">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      {/* Author bio box */}
      {author && (
        <section className="mt-16 pt-10 border-t border-border">
          <div className="flex flex-col sm:flex-row gap-5 p-6 rounded-2xl bg-secondary/50">
            {author.photo_url && (
              <img src={author.photo_url} alt={author.full_name}
                className="w-20 h-20 rounded-full object-cover flex-shrink-0" />
            )}
            <div>
              <p className="text-xs uppercase tracking-widest text-foreground/60 font-semibold mb-1">Written by</p>
              <p className="font-display text-xl">{author.full_name}</p>
              {author.job_title && <p className="text-sm text-foreground/70 mb-2">{author.job_title}</p>}
              {author.biography && <p className="text-sm text-foreground/80 leading-relaxed">{author.biography}</p>}
              {author.author_page_url && (
                <Link to={author.author_page_url} className="inline-block mt-3 text-sm text-primary underline">
                  More from {author.full_name.split(" ")[0]} →
                </Link>
              )}
            </div>
          </div>
        </section>
      )}

      <div className="mt-20">
        <ProductStrip title="More coloring books families love" />
      </div>
    </article>
  );
}
