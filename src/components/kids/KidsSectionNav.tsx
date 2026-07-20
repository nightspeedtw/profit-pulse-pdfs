import { useSearchParams, useNavigate, useLocation } from "react-router-dom";
import { KIDS_MAIN_TYPES, type KidsTypeSlug } from "@/lib/kidsBookTypes";
import { AGE_CHIPS } from "@/lib/kidsCatalogTaxonomy";

/**
 * Kids sticky header filter bar (owner spec 2026-07-21).
 *
 * Replaces the old Ages/Themes/Collections/Coloring links AND the separate
 * "Book Type / Age" popover toolbar that used to live above the grid.
 * Now there is ONE filter surface, and it lives here in the header, using
 * the 5 canonical book types + the age chip set. Selection is stored in
 * URL search params (`?type=...&age=...`) so links are shareable and the
 * catalog page reads the same source of truth.
 *
 * On any non-`/kids` route (e.g. old landing pages), clicking a chip
 * navigates to `/kids` with the filter applied.
 */
export function KidsSectionNav() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  const activeType = (params.get("type") as KidsTypeSlug | null) ?? null;
  const activeAge = params.get("age") ?? "all";

  const setFilter = (key: "type" | "age", value: string | null) => {
    // If we're not on /kids, jump there with the filter applied.
    if (location.pathname !== "/kids") {
      const q = new URLSearchParams();
      if (value) q.set(key, value);
      navigate(`/kids${q.toString() ? `?${q}` : ""}`);
      return;
    }
    const q = new URLSearchParams(params);
    if (!value || value === "all") q.delete(key);
    else q.set(key, value);
    // Reset subcategory whenever the parent type changes.
    if (key === "type") q.delete("subcategory");
    setParams(q, { replace: false });
  };

  const chipCls = (active: boolean) =>
    `px-3 py-1.5 rounded-full border shrink-0 whitespace-nowrap transition-colors ${
      active
        ? "bg-foreground text-background border-foreground"
        : "bg-background text-foreground border-border hover:border-foreground"
    }`;

  return (
    <nav
      aria-label="Kids catalog filters"
      className="w-full border-b border-border bg-background/95 backdrop-blur sticky top-16 z-30"
    >
      <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center gap-2 overflow-x-auto scrollbar-none text-xs font-mono uppercase tracking-widest">
        <span className="text-muted-foreground pr-1 shrink-0">Type</span>

        <button type="button" onClick={() => setFilter("type", null)} className={chipCls(!activeType)}>
          All
        </button>
        {KIDS_MAIN_TYPES.map((t) => (
          <button
            key={t.slug}
            type="button"
            onClick={() => setFilter("type", t.slug)}
            className={chipCls(activeType === t.slug)}
            aria-pressed={activeType === t.slug}
            title={t.th}
          >
            <span aria-hidden className="mr-1">{t.emoji}</span>
            {t.label}
          </button>
        ))}

        <span className="mx-2 h-4 w-px bg-border shrink-0" />

        <span className="text-muted-foreground pr-1 shrink-0">Age</span>
        {AGE_CHIPS.map((a) => (
          <button
            key={a.slug}
            type="button"
            onClick={() => setFilter("age", a.slug === "all" ? null : a.slug)}
            className={chipCls((activeAge || "all") === a.slug)}
            aria-pressed={(activeAge || "all") === a.slug}
          >
            {a.short}
          </button>
        ))}
      </div>
    </nav>
  );
}
