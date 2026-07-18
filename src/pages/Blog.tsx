import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ProductStrip } from "@/components/blog/ProductStrip";

type Post = {
  id: string; slug: string; title: string; dek: string | null;
  category: string | null; hero_image_url: string | null;
  published_at: string; word_count: number;
};

export default function Blog() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = "Blog — Printable Coloring Books, Gift Guides & Activity Ideas | SecretPDF Kids";
    const d = document.querySelector('meta[name="description"]');
    if (d) d.setAttribute("content",
      "Editorial gift guides, activity ideas, and honest reviews of printable coloring books for kids. Updated daily.");
    supabase.from("blog_posts")
      .select("id,slug,title,dek,category,hero_image_url,published_at,word_count")
      .eq("status", "published").order("published_at", { ascending: false }).limit(60)
      .then(({ data }) => { setPosts((data ?? []) as Post[]); setLoading(false); });
  }, []);

  const rows: Post[][] = [];
  for (let i = 0; i < posts.length; i += 3) rows.push(posts.slice(i, i + 3));

  return (
    <div className="container max-w-[1400px] py-12">
      <header className="text-center mb-14">
        <p className="text-xs uppercase tracking-[0.25em] text-primary/70 mb-3">SecretPDF Kids Journal</p>
        <h1 className="font-display text-5xl md:text-6xl mb-4">The Coloring Book Blog</h1>
        <p className="text-lg text-foreground/70 max-w-2xl mx-auto">
          Gift guides, seasonal activity ideas, and honest reviews — updated daily for parents, teachers, and gift-givers.
        </p>
      </header>

      {loading ? (
        <p className="text-center text-foreground/60">Loading…</p>
      ) : posts.length === 0 ? (
        <p className="text-center text-foreground/60">The first post is on the way — check back tomorrow.</p>
      ) : (
        <div className="space-y-16">
          {rows.map((row, idx) => (
            <div key={idx}>
              <div className="grid md:grid-cols-3 gap-8">
                {row.map((p) => <ArticleCard key={p.id} post={p} />)}
              </div>
              {idx % 2 === 1 && <div className="mt-16"><ProductStrip title="You might also love" /></div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ArticleCard({ post }: { post: Post }) {
  return (
    <Link to={`/blog/${post.slug}`} className="group block">
      <div className="aspect-[4/3] rounded-2xl overflow-hidden bg-secondary mb-4">
        {post.hero_image_url ? (
          <img src={post.hero_image_url} alt={post.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-foreground/30">SecretPDF Kids</div>
        )}
      </div>
      {post.category && (
        <p className="text-[11px] uppercase tracking-[0.2em] text-accent font-semibold mb-2">{post.category}</p>
      )}
      <h2 className="font-display text-2xl leading-tight mb-2 group-hover:text-primary transition-colors">
        {post.title}
      </h2>
      {post.dek && <p className="text-foreground/70 leading-relaxed">{post.dek}</p>}
    </Link>
  );
}
