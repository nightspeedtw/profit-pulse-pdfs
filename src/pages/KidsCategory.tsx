import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams, Navigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { KidsBookCard, type KidsBookCardData } from "@/components/kids/KidsBookCard";
import { KidsFilterChips } from "@/components/kids/KidsFilterChips";
import { KidsSectionNav } from "@/components/kids/KidsSectionNav";
import {
  resolveCategory, bookMatchesFilter, parseKidsUrl,
  resolveAgeChip, bookMatchesAgeChip, bookIsForKids,
  type BookTypeSlug,
} from "@/lib/kidsCatalogTaxonomy";
import { listThemes, type KidsTheme } from "@/lib/kidsTaxonomy";

interface Row {
  id: string;
  title: string;
  cover_url: string | null;
  thumbnail_url: string | null;
  price_cents: number;
  age_band: string | null;
  age_min: number | null;
  age_max: number | null;
  book_type: string | null;
  theme_ids: string[] | null;
  theme_slugs: string[] | null;
  buyer_job_tags: string[] | null;
  storefront_meta: Record<string, unknown> | null;
}

export default function KidsCategory() {
  const { categorySlug } = useParams<{ categorySlug: string }>();
  const category = resolveCategory(categorySlug);
  const [params] = useSearchParams();
  const [rows, setRows] = useState<Row[]>([]);
  const [themes, setThemes] = useState<KidsTheme[]>([]);
  const [loading, setLoading] = useState(true);

  const urlFilter = parseKidsUrl(params);

  useEffect(() => {
    if (!category) return;
    let cancelled = false;
    (async () => {
      const [{ data }, th] = await Promise.all([
        supabase
          .from("ebooks_kids")
          .select("id,title,cover_url,thumbnail_url,price_cents,age_band,age_min,age_max,book_type,theme_ids,theme_slugs,buyer_job_tags,storefront_meta")
          .eq("listing_status", "live")
          .eq("sellable", true)
          .order("created_at", { ascending: false })
          .limit(120),
        listThemes().catch(() => [] as KidsTheme[]),
      ]);
      if (cancelled) return;
      setRows((data ?? []) as unknown as Row[]);
      setThemes(th);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [category]);

  if (!category) return <Navigate to="/kids" replace />;

  const filtered = useMemo(() => {
    const merged = {
      ...category.filter,
      theme:     urlFilter.theme ?? category.filter.theme,
      book_type: (urlFilter.type as BookTypeSlug | null | undefined) ?? category.filter.book_type,
    };
    const chip = resolveAgeChip(urlFilter.age);
    return rows
      .filter((r) => bookIsForKids(r))
      .filter((r) => bookMatchesFilter(r, merged))
      .filter((r) => (chip ? bookMatchesAgeChip(r, chip) : true));
  }, [rows, urlFilter, category]);

  const canonical = `https://secretpdf.co/kids/${category.slug}`;
  const hiddenChips = {
    age:   Boolean(category.filter.age_band),
    theme: Boolean(category.filter.theme),
    type:  Boolean(category.filter.book_type),
  };

  return (
    <>
      <Helmet>
        <title>{category.titleTag}</title>
        <meta name="description" content={category.metaDescription} />
        <link rel="canonical" href={canonical} />
        <meta property="og:title" content={category.titleTag} />
        <meta property="og:description" content={category.metaDescription} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={canonical} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={category.titleTag} />
        <meta name="twitter:description" content={category.metaDescription} />
      </Helmet>

      <KidsSectionNav />

      <header className="max-w-[1400px] mx-auto px-3 md:px-6 pt-10 pb-6">
        <nav className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">
          <Link to="/kids" className="hover:text-foreground">Kids</Link> · {category.slug}
        </nav>
        <h1 className="font-display text-4xl md:text-5xl leading-tight tracking-tight">{category.h1}</h1>
        <p className="mt-3 text-base md:text-lg text-muted-foreground max-w-3xl">{category.intro}</p>
      </header>

      <KidsFilterChips hidden={hiddenChips} />

      <section className="max-w-[1400px] mx-auto px-3 md:px-6 py-8">
        {loading ? (
          <div className="py-16 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-accent" /></div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">
            <p className="mb-3">No books match this shelf yet — more are on the way.</p>
            <Link to="/kids" className="underline">Browse all kids books</Link>
          </div>
        ) : (
          <>
            <div className="mb-4 text-xs text-muted-foreground">
              {filtered.length} book{filtered.length === 1 ? "" : "s"}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-x-3 gap-y-6 md:gap-x-5 md:gap-y-8">

              {filtered.map((b, i) => {
                const card: KidsBookCardData = {
                  id: b.id,
                  title: b.title,
                  cover_url: b.cover_url,
                  thumbnail_url: b.thumbnail_url,
                  price_cents: b.price_cents,
                  theme_ids: b.theme_ids ?? [],
                  storefront_meta: b.storefront_meta,
                  book_type: b.book_type,
                };
                return <KidsBookCard key={b.id} book={card} themes={themes} index={i} />;
              })}
            </div>
          </>
        )}
      </section>
    </>
  );
}
