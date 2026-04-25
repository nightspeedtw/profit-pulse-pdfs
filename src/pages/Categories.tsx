import { CATEGORIES } from "@/components/CategoryGrid";
import { Link } from "react-router-dom";
import { useEffect } from "react";

const Categories = () => {
  useEffect(() => {
    document.title = "Categories — Printly";
  }, []);

  return (
    <>
      <section className="border-b-2 border-foreground bg-accent text-accent-foreground">
        <div className="container py-16">
          <p className="font-mono uppercase tracking-widest text-xs mb-3">[ Categories ]</p>
          <h1 className="font-display text-5xl lg:text-7xl uppercase leading-[0.95]">
            Find your <span className="bg-highlight text-highlight-foreground px-2">edge</span>.
          </h1>
        </div>
      </section>
      <section className="container py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {CATEGORIES.map((c) => (
            <Link
              key={c.slug}
              to={`/category/${c.slug}`}
              className={`brutal-card p-6 ${c.color}`}
            >
              <c.icon className="h-10 w-10 mb-6" strokeWidth={2} />
              <h2 className="font-display text-xl uppercase">{c.label}</h2>
              <p className="text-sm mt-3 opacity-70 font-mono uppercase tracking-wider">Browse →</p>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
};

export default Categories;
