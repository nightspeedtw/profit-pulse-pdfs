import { Hero } from "@/components/Hero";
import { CategoryGrid } from "@/components/CategoryGrid";
import { ValueProps } from "@/components/ValueProps";
import { ProductGrid } from "@/components/ProductGrid";
import { CtaBanner } from "@/components/CtaBanner";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

const Index = () => (
  <>
    <Hero />

    {/* Featured products */}
    <section className="container py-20">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-10">
        <div>
          <p className="font-mono uppercase tracking-widest text-xs mb-3">[ Trending ]</p>
          <h2 className="font-display text-4xl lg:text-5xl uppercase">
            This week&apos;s <span className="underline-brutal">best sellers</span>.
          </h2>
        </div>
        <Link
          to="/library"
          className="inline-flex items-center gap-2 font-display uppercase text-sm tracking-wider underline-offset-4 hover:underline"
        >
          See all <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
      <ProductGrid
        limit={8}
        emptyTitle="The library is loading"
        emptyMessage="Add your first PDF in the chat — tell us the title, price, and category and we&apos;ll get it live."
      />
    </section>

    <ValueProps />

    <CategoryGrid />

    <CtaBanner />
  </>
);

export default Index;
