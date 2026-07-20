import { useEffect, useState } from "react";
import { useSearchParams, useNavigate, useLocation } from "react-router-dom";
import { SlidersHorizontal, X } from "lucide-react";
import { KIDS_MAIN_TYPES, type KidsTypeSlug } from "@/lib/kidsBookTypes";
import { AGE_CHIPS } from "@/lib/kidsCatalogTaxonomy";

const FILTERS_STORAGE_KEY = "kids.filters.open";

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
    `px-4 py-2 rounded-full shrink-0 whitespace-nowrap transition-colors text-sm font-medium ${
      active
        ? "bg-foreground text-background"
        : "bg-muted text-foreground hover:bg-muted/70"
    }`;

  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const v = window.localStorage.getItem(FILTERS_STORAGE_KEY);
    return v === null ? true : v === "1";
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(FILTERS_STORAGE_KEY, open ? "1" : "0");
    }
  }, [open]);

  return (
    <nav
      aria-label="Kids catalog filters"
      className="w-full border-b border-border bg-background/95 backdrop-blur sticky top-16 z-30"
    >
      <div className="mx-auto max-w-[1600px] px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-pressed={open}
            aria-expanded={open}
            className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:opacity-90 shrink-0"
          >
            {open ? <X className="h-4 w-4" aria-hidden="true" /> : <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />}
            {open ? "Hide filters" : "Show filters"}
          </button>

          {open && (
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
              <button
                type="button"
                onClick={() => setFilter("age", null)}
                className={chipCls((activeAge || "all") === "all")}
                aria-pressed={(activeAge || "all") === "all"}
              >
                All ages
              </button>
              {AGE_CHIPS.filter((a) => a.slug !== "all").map((a) => (
                <button
                  key={a.slug}
                  type="button"
                  onClick={() => setFilter("age", a.slug)}
                  className={chipCls((activeAge || "all") === a.slug)}
                  aria-pressed={(activeAge || "all") === a.slug}
                >
                  {a.short}
                </button>
              ))}

              <span className="mx-2 h-5 w-px bg-border shrink-0" />

              <button type="button" onClick={() => setFilter("type", null)} className={chipCls(!activeType)}>
                All types
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
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
