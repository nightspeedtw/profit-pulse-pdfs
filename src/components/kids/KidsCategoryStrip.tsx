import { Link } from "react-router-dom";
import { KIDS_MAIN_TYPES, type KidsTypeSlug, resolveBookTypeSlug } from "@/lib/kidsBookTypes";

interface Props {
  /** Provide the raw live books so we can show real counts (no fake numbers). */
  books: Array<{ book_type?: string | null }>;
  onSelect: (slug: KidsTypeSlug) => void;
  activeType: KidsTypeSlug | null;
}

/**
 * Five main book-type category cards.
 * - Desktop: 5-column grid.
 * - Tablet: 2–3 columns via responsive grid.
 * - Mobile: horizontally snap-scrollable row with peek of the next card.
 * Each card links to /kids?type=<slug> (staying on the redesigned page so
 * the filter toolbar picks it up and the URL is shareable).
 */
export default function KidsCategoryStrip({ books, onSelect, activeType }: Props) {
  const counts: Record<KidsTypeSlug, number> = {
    "coloring-books": 0,
    "storybooks": 0,
    "activity-puzzle-books": 0,
    "learning-workbooks": 0,
    "comics-graphic-novels": 0,
  };
  for (const b of books) {
    const s = resolveBookTypeSlug(b.book_type);
    if (s) counts[s] += 1;
  }

  return (
    <section
      aria-label="Browse by book type"
      className="w-full border-b border-border bg-background"
    >
      <div className="mx-auto max-w-6xl px-4 py-5 md:py-7">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Browse by type
          </h2>
        </div>

        {/* Mobile scroller — snap, peek of next card visible via pr-5 */}
        <div className="-mx-4 md:mx-0">
          <ul className="flex md:grid md:grid-cols-5 gap-3 overflow-x-auto md:overflow-visible snap-x snap-mandatory scrollbar-none px-4 md:px-0 pb-1">
            {KIDS_MAIN_TYPES.map((t) => {
              const active = activeType === t.slug;
              const count = counts[t.slug];
              return (
                <li key={t.slug} className="snap-start shrink-0 basis-[62%] sm:basis-[42%] md:basis-auto">
                  <button
                    type="button"
                    onClick={() => onSelect(t.slug)}
                    aria-pressed={active}
                    className={[
                      "group relative flex h-full w-full flex-col items-start gap-2 rounded-2xl border p-3.5 text-left transition min-h-[112px]",
                      "hover:border-accent hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                      active
                        ? "border-accent bg-accent/5 shadow-md"
                        : "border-border bg-card",
                    ].join(" ")}
                  >
                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${t.accent} text-xl shadow-inner`} aria-hidden="true">
                      <span>{t.emoji}</span>
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-[13px] font-semibold leading-tight text-foreground">
                        {t.label}
                      </h3>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground" lang="th">
                        {t.th}
                      </p>
                    </div>
                    <div className="mt-auto flex w-full items-center justify-between">
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {count > 0 ? `${count} book${count === 1 ? "" : "s"}` : "Coming soon"}
                      </span>
                      <Link
                        to={t.href}
                        onClick={(e) => e.stopPropagation()}
                        className="text-[11px] font-medium text-accent hover:underline"
                        aria-label={`Open ${t.label}`}
                      >
                        View →
                      </Link>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
