import { Link, useSearchParams } from "react-router-dom";
import { AGE_BANDS, THEMES, BOOK_TYPES, buildKidsUrl, parseKidsUrl, type AgeBandSlug, type ThemeSlug, type BookTypeSlug } from "@/lib/kidsCatalogTaxonomy";
import { X } from "lucide-react";

interface Props {
  hidden?: { age?: boolean; theme?: boolean; type?: boolean };
}

/**
 * Horizontal chip filter row: Age · Theme · Type.
 * URL-param backed so /kids?age=4-6&theme=bedtime is deep-linkable.
 */
export function KidsFilterChips({ hidden }: Props) {
  const [params, setParams] = useSearchParams();
  const current = parseKidsUrl(params);

  const setParam = (key: "age" | "theme" | "type", value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const anyActive = Boolean(current.age || current.theme || current.type);

  const chipClass = (active: boolean) =>
    `px-3 py-1.5 rounded-full border text-xs font-mono uppercase tracking-wide transition-colors ${
      active
        ? "bg-foreground text-background border-foreground"
        : "bg-background text-foreground border-border hover:border-foreground"
    }`;

  return (
    <div className="w-full border-y border-border bg-muted/30 py-4">
      <div className="max-w-6xl mx-auto px-4 space-y-3">
        {!hidden?.age && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground w-16 shrink-0">Age</span>
            <button type="button" onClick={() => setParam("age", null)} className={chipClass(!current.age)}>All</button>
            {AGE_BANDS.map((a) => (
              <button
                key={a.slug}
                type="button"
                onClick={() => setParam("age", current.age === a.slug ? null : a.slug)}
                className={chipClass(current.age === a.slug)}
              >
                {a.short}
              </button>
            ))}
          </div>
        )}

        {!hidden?.theme && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground w-16 shrink-0">Theme</span>
            <button type="button" onClick={() => setParam("theme", null)} className={chipClass(!current.theme)}>All</button>
            {THEMES.map((t) => (
              <button
                key={t.slug}
                type="button"
                onClick={() => setParam("theme", current.theme === t.slug ? null : t.slug)}
                className={chipClass(current.theme === t.slug)}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {!hidden?.type && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground w-16 shrink-0">Type</span>
            <button type="button" onClick={() => setParam("type", null)} className={chipClass(!current.type)}>All</button>
            {BOOK_TYPES.map((b) => (
              <button
                key={b.slug}
                type="button"
                onClick={() => setParam("type", current.type === b.slug ? null : b.slug)}
                className={chipClass(current.type === b.slug)}
              >
                {b.short}
              </button>
            ))}
          </div>
        )}

        {anyActive && (
          <div className="flex items-center gap-3 pt-1">
            <Link to="/kids" className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              <X className="h-3 w-3" /> Clear filters
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export { AGE_BANDS as _AGE_BANDS, THEMES as _THEMES, BOOK_TYPES as _BOOK_TYPES };
export type { AgeBandSlug, ThemeSlug, BookTypeSlug };
