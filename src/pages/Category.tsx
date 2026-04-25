import { useParams } from "react-router-dom";
import { ProductGrid } from "@/components/ProductGrid";
import { CATEGORIES } from "@/components/CategoryGrid";
import { useEffect } from "react";

const Category = () => {
  const { slug } = useParams<{ slug: string }>();
  const cat = CATEGORIES.find((c) => c.slug === slug);

  useEffect(() => {
    document.title = `${cat?.label ?? "Category"} — Printly`;
  }, [cat]);

  // Filter via Shopify product type or tag matching the slug
  const query = `tag:${slug} OR product_type:${slug}`;

  return (
    <>
      <section className="border-b-2 border-foreground bg-secondary">
        <div className="container py-16">
          <p className="font-mono uppercase tracking-widest text-xs mb-3">[ Category ]</p>
          <h1 className="font-display text-5xl lg:text-7xl uppercase leading-[0.95]">
            {cat?.label ?? slug}
          </h1>
        </div>
      </section>
      <section className="container py-12">
        <ProductGrid
          query={query}
          limit={48}
          emptyTitle="Nothing in this category yet"
          emptyMessage="Tell us what to add — the chat is open."
        />
      </section>
    </>
  );
};

export default Category;
