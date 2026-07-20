import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import KidsHeroCompact from "@/components/kids/KidsHeroCompact";
import KidsCategoryStrip from "@/components/kids/KidsCategoryStrip";
import KidsFilterToolbar from "@/components/kids/KidsFilterToolbar";
import { KidsBookCard, type KidsBookCardData } from "@/components/kids/KidsBookCard";
import { KidsSectionNav } from "@/components/kids/KidsSectionNav";
import { PreviewLightbox } from "@/components/kids/PreviewLightbox";
import { resolveAgeChip, bookMatchesAgeChip, bookIsForKids } from "@/lib/kidsCatalogTaxonomy";
import { bookMatchesType, type KidsTypeSlug } from "@/lib/kidsBookTypes";
import { listThemes, type KidsTheme } from "@/lib/kidsTaxonomy";

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

  const [params, setParams] = useSearchParams();
  const catalogRef = useRef<HTMLDivElement | null>(null);

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
    return kidsEligible
      .filter((b) => bookMatchesType(b, type, subcategory))
      .filter((b) => (chip ? bookMatchesAgeChip(b, chip) : true));
  }, [kidsEligible, type, subcategory, age]);

  const scrollToCatalog = () => {
    catalogRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const onCategorySelect = (slug: KidsTypeSlug) => {
    updateFilters({ type: slug, subcategory: null, age });
    setTimeout(scrollToCatalog, 40);
  };

  return (
    <>
      <KidsSectionNav />
      <KidsHeroCompact onCtaClick={scrollToCatalog} />
      <KidsCategoryStrip books={kidsEligible} activeType={type} onSelect={onCategorySelect} />

      <div ref={catalogRef}>
        <KidsFilterToolbar
          type={type}
          subcategory={subcategory}
          age={age}
          onChange={updateFilters}
          resultCount={filtered.length}
        />
      </div>

      <section aria-label="Kids book catalog" className="mx-auto max-w-6xl px-4 py-6 md:py-10">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-accent" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState onClear={() => updateFilters({ type: null, subcategory: null, age: null })} />
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
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
    <div className="mx-auto max-w-md rounded-2xl border border-dashed border-border bg-muted/30 p-8 text-center">
      <p className="text-lg font-medium text-foreground">No books match those filters yet</p>
      <p className="mt-2 text-sm text-muted-foreground">
        Try broadening your filters, or clear them to browse everything on the shelf.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="mt-5 inline-flex min-h-11 items-center rounded-full bg-accent px-5 text-sm font-semibold text-accent-foreground transition hover:opacity-90"
      >
        Clear filters
      </button>
    </div>
  );
}
