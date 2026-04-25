import { ProductGrid } from "@/components/ProductGrid";
import { useSearchParams } from "react-router-dom";
import { useEffect } from "react";

const Library = () => {
  const [params] = useSearchParams();
  const q = params.get("q") ?? undefined;

  useEffect(() => {
    document.title = "PDF Library — Printly";
  }, []);

  return (
    <>
      <section className="border-b-2 border-foreground bg-highlight">
        <div className="container py-16">
          <p className="font-mono uppercase tracking-widest text-xs mb-3">[ Library ]</p>
          <h1 className="font-display text-5xl lg:text-7xl uppercase leading-[0.95]">
            The full <span className="bg-foreground text-background px-2">collection</span>.
          </h1>
          <p className="mt-4 max-w-2xl text-lg">
            Every printable, in one place. Use search and filters to find your next download.
          </p>
        </div>
      </section>
      <section className="container py-12">
        <ProductGrid query={q} limit={48} />
      </section>
    </>
  );
};

export default Library;
