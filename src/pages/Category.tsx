import { useParams, Link } from "react-router-dom";
import { ProductGrid } from "@/components/ProductGrid";
import { CATEGORIES } from "@/components/CategoryGrid";
import { useEffect } from "react";
import { Baby, ArrowRight } from "lucide-react";

const Category = () => {
  const { slug } = useParams<{ slug: string }>();
  const cat = CATEGORIES.find((c) => c.slug === slug);
  const isKids = slug === "parenting" || slug === "parenting-kids";

  useEffect(() => {
    document.title = `${cat?.label ?? "Category"} — SecretPDF`;
  }, [cat]);

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
      {isKids && (
        <section className="container pt-8">
          <Link
            to="/kids"
            className="group flex items-center justify-between gap-4 border-2 border-foreground bg-highlight p-5 hover:shadow-brutal hover:-translate-x-1 hover:-translate-y-1 transition-all"
          >
            <div className="flex items-center gap-4">
              <Baby className="h-8 w-8 shrink-0" strokeWidth={2} />
              <div>
                <p className="font-display uppercase text-lg leading-tight">
                  เข้าสู่ Kids Hub
                </p>
                <p className="text-xs font-mono opacity-70 mt-1">
                  ตัวกรองตามวัย + ธีม ค้นหาหนังสือเด็กได้ตรงใจกว่า
                </p>
              </div>
            </div>
            <ArrowRight className="h-6 w-6 group-hover:translate-x-1 transition-transform" />
          </Link>
        </section>
      )}
      <section className="container py-12">
        <ProductGrid
          category={slug}
          limit={48}
          emptyTitle="Nothing in this category yet"
          emptyMessage="Tell us what to add — the chat is open."
        />
      </section>
    </>
  );

};

export default Category;
