import { useEffect, useState } from "react";
import { useSearchParams, useNavigate, useLocation } from "react-router-dom";
import { SlidersHorizontal, X } from "lucide-react";
import { KIDS_MAIN_TYPES, type KidsTypeSlug } from "@/lib/kidsBookTypes";
import { AGE_CHIPS } from "@/lib/kidsCatalogTaxonomy";

const FILTERS_STORAGE_KEY = "kids.filters.open";

/**
 * Kids sticky filter bar — magical lavender glass.
 * URL-driven (?type= / ?age=) — behavior preserved, only styling upgraded.
 */
export function KidsSectionNav() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  const activeType = (params.get("type") as KidsTypeSlug | null) ?? null;
  const activeAge = params.get("age") ?? "all";

  const setFilter = (key: "type" | "age", value: string | null) => {
    if (location.pathname !== "/kids") {
      const q = new URLSearchParams();
      if (value) q.set(key, value);
      navigate(`/kids${q.toString() ? `?${q}` : ""}`);
      return;
    }
    const q = new URLSearchParams(params);
    if (!value || value === "all") q.delete(key);
    else q.set(key, value);
    if (key === "type") q.delete("subcategory");
    setParams(q, { replace: false });
  };

  const chipCls = (active: boolean) =>
    `kids-chip ${active ? "kids-chip-active" : ""} px-4 py-2 rounded-full shrink-0 whitespace-nowrap text-sm font-medium min-h-[42px] inline-flex items-center`;

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
      className="w-full sticky top-16 z-30 border-b border-[#DED7F2]/80 bg-[#F8F6FF]/85 backdrop-blur-md"
    >
      <div className="mx-auto max-w-[1600px] px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-pressed={open}
            aria-expanded={open}
            className="inline-flex items-center gap-2 rounded-full bg-[#171052] px-4 py-2 text-sm font-medium text-[#FFFDF8] transition-colors hover:bg-[#25136B] shrink-0 min-h-[42px]"
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

              <span className="mx-2 h-5 w-px bg-[#DED7F2] shrink-0" />

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
