import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2, Search, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import KidsHeroCompact from "@/components/kids/KidsHeroCompact";
import { KidsBookCard, type KidsBookCardData } from "@/components/kids/KidsBookCard";
import { KidsSectionNav } from "@/components/kids/KidsSectionNav";
import { KidsCategorySection } from "@/components/kids/KidsCategorySection";
import { KidsFinalCta } from "@/components/kids/KidsFinalCta";
import { PreviewLightbox } from "@/components/kids/PreviewLightbox";
import { resolveAgeChip, bookMatchesAgeChip, bookIsForKids } from "@/lib/kidsCatalogTaxonomy";
import { bookMatchesType } from "@/lib/kidsBookTypes";
import type { KidsTypeSlug } from "@/lib/kidsBookTypes";
import { listThemes, type KidsTheme } from "@/lib/kidsTaxonomy";
import { useResolvedKidsPrices } from "@/lib/useResolvedPricing";

interface RawBook {
  id: string;
  title: string;
  cover_url: string | null;
  thumbnail_url: string | null;
  book_type: string | null;
  price_cents: number;
  age_group_id: string | null;
  age_band: string | null;
  age_min: number | null;
  age_max: number | null;
  theme_ids: string[] | null;
  storefront_meta: Record<string, unknown> | null;
  created_at: string;
}

export default function Kids() {
  const [themes, setThemes] = useState<KidsTheme[]>([]);
  const [allBooks, setAllBooks] = useState<RawBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewBook, setPreviewBook] = useState<KidsBookCardData & { interior_preview_urls?: string[] } | null>(null);
  const [query, setQuery] = useState("");

  const [params, setParams] = useSearchParams();
  const catalogRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const type = (params.get("type") as KidsTypeSlug | null) || null;
  const subcategory = params.get("subcategory") || null;
  const age = params.get("age") || null;

  const updateFilters = useCallback((next: { type: KidsTypeSlug | null; subcategory: string | null; age: string | null }) => {
    const q = new URLSearchParams(params);
    if (next.type) q.set("type", next.type); else q.delete("type");
    if (next.subcategory) q.set("subcategory", next.subcategory); else q.delete("subcategory");
    if (next.age && next.age !== "all") q.set("age", next.age); else q.delete("age");
    setParams(q, { replace: false });
  }, [params, setParams]);

  useEffect(() => {
    document.title = "Kids' Books — Stories, Coloring, Activities & Learning | SecretPDF";
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", "Find stories, coloring books, activities, and learning adventures made for every age. Instant PDF download from SecretPDF.");
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const q: any = supabase.from("ebooks_kids");
        const [{ data: booksRaw }, th] = await Promise.all([
          q
            .select("id,title,cover_url,thumbnail_url,book_type,price_cents,age_group_id,age_band,age_min,age_max,theme_ids,created_at,audience:storefront_meta->audience,preview_urls:storefront_meta->preview_urls")
            .eq("listing_status", "live")
            .eq("sellable", true)
            .order("created_at", { ascending: false })
            .limit(120),
          listThemes().catch(() => [] as KidsTheme[]),
        ]);
        if (cancelled) return;
        const rows = (booksRaw ?? []) as Array<Record<string, unknown>>;
        setAllBooks(rows.map((b): RawBook => ({
          id: b.id as string,
          title: b.title as string,
          cover_url: (b.cover_url as string | null) ?? null,
          thumbnail_url: (b.thumbnail_url as string | null) ?? null,
          book_type: (b.book_type as string | null) ?? null,
          price_cents: (b.price_cents as number) ?? 0,
          age_group_id: (b.age_group_id as string | null) ?? null,
          age_band: (b.age_band as string | null) ?? null,
          age_min: (b.age_min as number | null) ?? null,
          age_max: (b.age_max as number | null) ?? null,
          theme_ids: (b.theme_ids as string[] | null) ?? null,
          storefront_meta: {
            audience: b.audience ?? undefined,
            preview_urls: b.preview_urls ?? undefined,
          } as Record<string, unknown>,
          created_at: b.created_at as string,
        })));
        setThemes(th);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const kidsEligible = useMemo(
    () => allBooks.filter((b) => bookIsForKids(b)),
    [allBooks],
  );

  const filtered = useMemo(() => {
    const chip = resolveAgeChip(age);
    const q = query.trim().toLowerCase();
    return kidsEligible
      .filter((b) => bookMatchesType(b, type, subcategory))
      .filter((b) => (chip ? bookMatchesAgeChip(b, chip) : true))
      .filter((b) => (q ? b.title.toLowerCase().includes(q) : true));
  }, [kidsEligible, type, subcategory, age, query]);

  // Marketing Autopilot Phase 1: batch-fetch authoritative prices for
  // whatever is currently visible so cards render `product_pricing` values.
  const visibleIds = useMemo(() => filtered.map((b) => b.id), [filtered]);
  const resolvedPrices = useResolvedKidsPrices(visibleIds);

  const scrollToCatalog = () => {
    catalogRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const filtersActive = !!(type || age || query.trim());
  const catalogLabel = filtersActive ? "Your Selected Adventures" : "Magical Shelf";

  return (
    <>
      <KidsSectionNav />

      {/* Search bar — magical lavender glass, matches the filter theme */}
      <div className="sticky top-[8.25rem] z-20 border-b border-[#DED7F2]/70 bg-[#FFFDF8]/85 backdrop-blur-md">
        <div className="mx-auto max-w-[1600px] px-4 py-3">
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-[#6F688C]">
              <Search className="h-4 w-4" aria-hidden="true" />
            </span>
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search coloring books, stories, activities…"
              aria-label="Search kids books"
              className="w-full rounded-full border border-[#DED7F2] bg-white/90 py-3 pl-11 pr-24 text-sm text-[#19163A] shadow-sm outline-none transition placeholder:text-[#6F688C]/80 focus:border-[#5B3FD6] focus:ring-2 focus:ring-[#5B3FD6]/25"
            />
            <div className="pointer-events-none absolute inset-y-0 right-0 hidden items-center pr-4 text-xs text-[#6F688C] sm:flex">
              <kbd className="rounded border border-[#DED7F2] bg-[#F1EDFF] px-1.5 py-0.5 font-sans">Ctrl K</kbd>
            </div>
          </div>
        </div>
      </div>

      <KidsHeroCompact onCtaClick={scrollToCatalog} />

      <KidsCategorySection books={kidsEligible} />

      <div ref={catalogRef} className="mx-auto max-w-[1600px] px-4">
        <div className="flex items-baseline gap-2 pt-2 pb-1">
          <Sparkles className="h-4 w-4 text-[#FFC44D]" strokeWidth={2} aria-hidden="true" />
          <h2 className="font-display text-lg md:text-xl text-[#19163A]">
            {catalogLabel}
            <span className="ml-2 text-[#6F688C] font-sans font-normal text-sm md:text-base">
              · {filtered.length} {filtered.length === 1 ? "Book" : "Books"}
            </span>
          </h2>
        </div>
      </div>

      <section aria-label="Kids book catalog" className="mx-auto max-w-[1600px] px-4 pt-4 pb-8 md:pb-12">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-[#5B3FD6]" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState onClear={() => { setQuery(""); updateFilters({ type: null, subcategory: null, age: null }); }} />
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6">
            {filtered.map((b, i) => (
              <li key={b.id}>
                <KidsBookCard
                  book={{
                    id: b.id,
                    title: b.title,
                    cover_url: b.cover_url,
                    thumbnail_url: b.thumbnail_url,
                    price_cents: b.price_cents,
                    theme_ids: b.theme_ids ?? [],
                    storefront_meta: b.storefront_meta,
                    book_type: b.book_type,
                  }}
                  themes={themes}
                  index={i}
                  resolvedPrice={resolvedPrices[b.id]}
                  onPreview={() => {
                    const previews = (b.storefront_meta as { preview_urls?: string[] } | null)?.preview_urls ?? [];
                    setPreviewBook({
                      id: b.id,
                      title: b.title,
                      cover_url: b.cover_url,
                      thumbnail_url: b.thumbnail_url,
                      price_cents: b.price_cents,
                      theme_ids: b.theme_ids ?? [],
                      storefront_meta: b.storefront_meta,
                      book_type: b.book_type,
                      interior_preview_urls: previews,
                    });
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <KidsFinalCta />

      <PreviewLightbox
        open={!!previewBook}
        onClose={() => setPreviewBook(null)}
        title={previewBook?.title ?? ""}
        images={previewBook?.interior_preview_urls ?? []}
      />
    </>
  );
}

function EmptyState({ onClear }: { onClear: () => void }) {
  return (
    <div className="mx-auto max-w-lg rounded-3xl border border-[#DED7F2] bg-gradient-to-br from-[#F8F6FF] to-[#FFF9EE] p-10 text-center shadow-[0_20px_40px_-24px_rgba(91,63,214,0.3)]">
      <div className="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[#5B3FD6] to-[#3C7BFF] text-[#FFE19A]">
        <Sparkles className="h-7 w-7" strokeWidth={2} />
      </div>
      <p className="font-display text-xl text-[#19163A]">No adventures match those filters yet.</p>
      <p className="mt-2 text-sm text-[#6F688C]">
        Try another age or book type, or clear the filters to see the full magical shelf.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="kids-cta-gold mt-6 inline-flex min-h-12 items-center rounded-full px-6 text-sm font-semibold"
      >
        Show all books
      </button>
    </div>
  );
}
