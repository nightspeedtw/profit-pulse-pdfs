import { Link } from "react-router-dom";
import { BookOpen } from "lucide-react";

export function KidsFinalCta() {
  return (
    <section aria-labelledby="kids-final-cta" className="mx-auto max-w-[1600px] px-4 my-12 md:my-16">
      <div className="kids-night relative overflow-hidden rounded-3xl px-6 py-10 md:px-14 md:py-14 text-center">
        {/* Open book glow motif */}
        <div className="absolute -right-6 top-1/2 hidden -translate-y-1/2 opacity-40 md:block" aria-hidden="true">
          <BookOpen className="h-40 w-40 text-[#FFE19A]" strokeWidth={1} />
        </div>
        <h2
          id="kids-final-cta"
          className="font-display text-3xl md:text-4xl text-[#FFFDF8] max-w-2xl mx-auto"
        >
          Ready for another adventure?
        </h2>
        <p className="mt-3 text-base md:text-lg text-[#F1EDFF]/85 max-w-xl mx-auto">
          Explore stories, coloring books, activities, puzzles, and learning printables created for curious young minds.
        </p>
        <div className="mt-7 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            to="/kids"
            className="kids-cta-gold min-h-12 rounded-full px-7 text-base font-semibold inline-flex items-center"
          >
            Explore all kids' books
          </Link>
          <Link
            to="/kids?age=all"
            className="text-sm font-medium text-[#FFE19A] hover:text-[#FFFDF8] underline underline-offset-4"
          >
            Browse by age
          </Link>
        </div>
      </div>
    </section>
  );
}
