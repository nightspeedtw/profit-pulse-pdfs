import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ProductStrip } from "@/components/blog/ProductStrip";

type Post = {
  id: string; slug: string; title: string; dek: string | null;
  category: string | null; hero_image_url: string | null;
  body_md: string; faq: Array<{ q: string; a: string }>;
  product_ids: string[]; published_at: string;
  meta_description: string | null; word_count: number;
  primary_keyword: string | null;
};

type Product = {
  id: string; title: string; thumbnail_url: string | null; cover_url: string | null;
  price_cents: number | null; category: string | null;
};

function renderMarkdown(md: string, products: Product[]): string {
  // Replace [BOOK_LINK:{id}] tokens with anchor tags, then a tiny md subset.
  let html = md.replace(/\[BOOK_LINK:([a-f0-9-]+)\]/gi, (_, id) => {
    const p = products.find((x) => x.id === id);
    if (!p) return "";
    return ` <a href="/kids/coloring/${p.id}" class="text-primary underline font-semibold">${p.title}</a> `;
  });
  html = html
    .replace(/^### (.+)$/gm, '<h3 class="font-display text-xl mt-8 mb-3">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="font-display text-3xl mt-12 mb-4">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="font-display text-4xl mb-6">$1</h1>')
    .replace(/^\* (.+)$/gm, '<li>$1</li>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul class="list-disc pl-6 space-y-2 my-4">${m}</ul>`)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n\n/g, '</p><p class="mb-4 leading-relaxed">');
  return `<p class="mb-4 leading-relaxed">${html}</p>`;
}

export default function BlogPost() {
  const { slug } = useParams();
  const [post, setPost] = useState<Post | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      const { data } = await supabase.from("blog_posts").select("*")
        .eq("slug", slug).eq("status", "published").maybeSingle();
      if (!data) { setLoading(false); return; }
      setPost(data as unknown as Post);
      document.title = `${data.title} | SecretPDF Kids Blog`;
      const d = document.querySelector('meta[name="description"]');
      if (d && data.meta_description) d.setAttribute("content", data.meta_description);

      if (data.product_ids?.length) {
        const { data: prods } = await supabase.from("ebooks_kids")
          .select("id,title,thumbnail_url,cover_url,price_cents,category")
          .in("id", data.product_ids);
        setProducts(((prods ?? []) as unknown) as Product[]);
      }
      setLoading(false);
    })();
  }, [slug]);

  if (loading) return <div className="container py-24 text-center text-foreground/60">Loading…</div>;
  if (!post) return <div className="container py-24 text-center">Post not found. <Link to="/blog" className="text-primary underline">Back to blog</Link></div>;

  const canonical = `https://secretpdf.co/blog/${post.slug}`;
  const articleLd = {
    "@context": "https://schema.org", "@type": "Article",
    headline: post.title, description: post.meta_description ?? post.dek,
    image: post.hero_image_url, datePublished: post.published_at,
    author: { "@type": "Organization", name: "SecretPDF Kids" },
    publisher: { "@type": "Organization", name: "SecretPDF Kids", logo: { "@type": "ImageObject", url: "https://secretpdf.co/favicon.png" } },
    mainEntityOfPage: canonical,
    keywords: post.primary_keyword,
  };
  const faqLd = post.faq?.length ? {
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: post.faq.map((f) => ({
      "@type": "Question", name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  } : null;

  return (
    <article className="container max-w-3xl py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd) }} />
      {faqLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />}
      <link rel="canonical" href={canonical} />

      <Link to="/blog" className="text-sm text-primary/80 hover:text-primary">← All posts</Link>

      <header className="my-8">
        {post.category && (
          <p className="text-[11px] uppercase tracking-[0.2em] text-accent font-semibold mb-3">{post.category}</p>
        )}
        <h1 className="font-display text-4xl md:text-5xl leading-tight mb-4">{post.title}</h1>
        {post.dek && <p className="text-xl text-foreground/70 leading-relaxed">{post.dek}</p>}
        <p className="text-sm text-foreground/50 mt-4">
          {new Date(post.published_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
          {" · "}{Math.max(1, Math.round(post.word_count / 200))} min read
        </p>
      </header>

      {post.hero_image_url && (
        <div className="aspect-[16/9] rounded-2xl overflow-hidden mb-10 bg-secondary">
          <img src={post.hero_image_url} alt={post.title} className="w-full h-full object-cover" />
        </div>
      )}

      <div className="prose prose-lg max-w-none text-foreground/90"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(post.body_md, products) }} />

      {products.length > 0 && (
        <section className="mt-16 pt-10 border-t border-border">
          <h2 className="font-display text-2xl mb-6">Featured in this post</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {products.map((p) => (
              <Link key={p.id} to={`/kids/coloring/${p.id}`} className="group block">
                <div className="aspect-square rounded-xl overflow-hidden bg-secondary mb-2">
                  <img src={p.thumbnail_url ?? p.cover_url ?? ""} alt={p.title}
                    className="w-full h-full object-contain bg-white group-hover:scale-105 transition-transform" />
                </div>
                <p className="text-sm font-medium leading-tight line-clamp-2">{p.title}</p>
                <p className="text-sm text-foreground/60 mt-1">${((p.price_cents ?? 499) / 100).toFixed(2)}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {post.faq?.length > 0 && (
        <section className="mt-16 pt-10 border-t border-border">
          <h2 className="font-display text-3xl mb-6">Frequently asked</h2>
          <div className="space-y-6">
            {post.faq.map((f, i) => (
              <div key={i}>
                <h3 className="font-semibold text-lg mb-2">{f.q}</h3>
                <p className="text-foreground/80 leading-relaxed">{f.a}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="mt-20">
        <ProductStrip title="More coloring books families love" />
      </div>
    </article>
  );
}
