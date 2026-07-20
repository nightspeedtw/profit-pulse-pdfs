import { useSearchParams, useNavigate } from "react-router-dom";
import { Palette, BookOpen, Puzzle, Pencil, Sparkles } from "lucide-react";
import { KIDS_MAIN_TYPES, resolveBookTypeSlug, type KidsTypeSlug } from "@/lib/kidsBookTypes";

interface Props {
  /** All live kids-eligible books (unfiltered) used to compute real counts. */
  books: Array<{ book_type: string | null }>;
}

const ICONS: Record<KidsTypeSlug, { Icon: typeof Palette; grad: string; iconWrap: string }> = {
  "coloring-books": {
    Icon: Palette,
    grad: "linear-gradient(160deg, #FCEBF5 0%, #F3E9FF 100%)",
    iconWrap: "bg-gradient-to-br from-[#E9B7E6] to-[#B49BF0] text-white",
  },
  "storybooks": {
    Icon: BookOpen,
    grad: "linear-gradient(160deg, #EEE9FF 0%, #FFF4D9 100%)",
    iconWrap: "bg-gradient-to-br from-[#4A3AC0] to-[#7C63F0] text-[#FFE19A]",
  },
  "activity-puzzle-books": {
    Icon: Puzzle,
    grad: "linear-gradient(160deg, #E1F0FF 0%, #DFF9F5 100%)",
    iconWrap: "bg-gradient-to-br from-[#3C7BFF] to-[#4CC5D3] text-white",
  },
  "learning-workbooks": {
    Icon: Pencil,
    grad: "linear-gradient(160deg, #FFF5DA 0%, #F3EEFF 100%)",
    iconWrap: "bg-gradient-to-br from-[#FFC44D] to-[#F2A91F] text-[#19163A]",
  },
  "comics-graphic-novels": {
    Icon: Sparkles,
    grad: "linear-gradient(160deg, #F4E7FF 0%, #FFE4DE 100%)",
    iconWrap: "bg-gradient-to-br from-[#5B3FD6] to-[#F17F7F] text-white",
  },
};

export function KidsCategorySection({ books }: Props) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const activeType = params.get("type");

  const counts = new Map<KidsTypeSlug, number>();
  for (const b of books) {
    const slug = resolveBookTypeSlug(b.book_type);
    if (slug) counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }

  const selectType = (slug: KidsTypeSlug) => {
    const q = new URLSearchParams(params);
    if (activeType === slug) q.delete("type");
    else q.set("type", slug);
    q.delete("subcategory");
    navigate(`/kids?${q.toString()}`);
  };

  return (
    <section aria-labelledby="kids-cat-heading" className="mx-auto max-w-[1600px] px-4 py-10 md:py-14">
      <div className="mb-6 md:mb-8 text-center md:text-left">
        <h2 id="kids-cat-heading" className="font-display text-2xl md:text-3xl text-[#19163A]">
          Choose your next adventure
        </h2>
        <p className="mt-1 text-sm md:text-base text-[#6F688C]">
          Find the perfect book by activity, learning style, or imagination.
        </p>
      </div>

      <ul className="flex gap-4 overflow-x-auto snap-x snap-mandatory scrollbar-none pb-2 md:grid md:grid-cols-3 lg:grid-cols-5 md:overflow-visible md:pb-0">
        {KIDS_MAIN_TYPES.map((t) => {
          const meta = ICONS[t.slug];
          const { Icon } = meta;
          const active = activeType === t.slug;
          const count = counts.get(t.slug) ?? 0;
          return (
            <li key={t.slug} className="snap-start min-w-[68%] sm:min-w-[240px] md:min-w-0">
              <button
                type="button"
                onClick={() => selectType(t.slug)}
                aria-pressed={active}
                className={`kids-tile w-full h-full text-left p-4 md:p-5 flex flex-col gap-3 ${
                  active ? "ring-2 ring-[#5B3FD6]" : ""
                }`}
                style={{ background: meta.grad }}
              >
                <span
                  className={`inline-flex h-12 w-12 items-center justify-center rounded-xl shadow-sm ${meta.iconWrap}`}
                  aria-hidden="true"
                >
                  <Icon className="h-6 w-6" strokeWidth={2} />
                </span>
                <div className="min-h-[48px]">
                  <p className="font-display text-base md:text-lg text-[#19163A] leading-tight">
                    {t.label}
                  </p>
                  <p className="mt-1 text-xs text-[#6F688C]">
                    {count} {count === 1 ? "book" : "books"}
                  </p>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
