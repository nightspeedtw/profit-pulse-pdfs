import { useEffect, useMemo, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { listAgeGroups, listThemes, type KidsAgeGroup, type KidsTheme } from "@/lib/kidsTaxonomy";
import { AgeGroupTabs } from "@/components/kids/AgeGroupTabs";
import { ThemeChips } from "@/components/kids/ThemeChips";
import { Loader2, FileText } from "lucide-react";

interface KidsBook {
  id: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  cover_url: string | null;
  price_cents: number;
  age_group_id: string | null;
  theme_ids: string[];
}

export default function Kids() {
  const [ageGroups, setAgeGroups] = useState<KidsAgeGroup[]>([]);
  const [themes, setThemes] = useState<KidsTheme[]>([]);
  const [params, setParams] = useSearchParams();

  const age = params.get("age");
  const themesSel = useMemo(
    () => (params.get("themes") ?? "").split(",").filter(Boolean),
    [params],
  );

  const [results, setResults] = useState<KidsBook[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = "Kids Books — Shop by Age & Theme | SecretPDF";
    listAgeGroups().then(setAgeGroups).catch(() => {});
    listThemes().then(setThemes).catch(() => {});
  }, []);

  const themeIds = useMemo(
    () => themes.filter((t) => themesSel.includes(t.slug)).map((t) => t.id),
    [themes, themesSel],
  );
  const ageId = useMemo(
    () => ageGroups.find((g) => g.slug === age)?.id ?? null,
    [ageGroups, age],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      let query = supabase
        .from("ebooks_kids")
        .select("id,title,subtitle,description,cover_url,price_cents,age_group_id,theme_ids")
        .eq("listing_status", "live")
        .order("created_at", { ascending: false })
        .limit(48);
      if (ageId) query = query.eq("age_group_id", ageId);
      if (themeIds.length > 0) query = query.overlaps("theme_ids", themeIds);
      const { data } = await query;
      if (!cancelled) setResults((data ?? []) as KidsBook[]);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [ageId, themeIds.join(",")]);

  const setAge = (slug: string | null) => {
    const next = new URLSearchParams(params);
    if (slug) next.set("age", slug); else next.delete("age");
    setParams(next, { replace: true });
  };
  const setThemesSel = (slugs: string[]) => {
    const next = new URLSearchParams(params);
    if (slugs.length > 0) next.set("themes", slugs.join(",")); else next.delete("themes");
    setParams(next, { replace: true });
  };
  const clearAll = () => setParams(new URLSearchParams(), { replace: true });

  const hasFilter = age !== null || themesSel.length > 0;

  return (
    <>
      <section className="border-b-2 border-foreground bg-highlight">
        <div className="container py-14">
          <p className="font-mono uppercase tracking-widest text-xs mb-3">[ Kids Hub ]</p>
          <h1 className="font-display text-5xl lg:text-7xl uppercase leading-[0.95] max-w-3xl">
            Kids books, curated <span className="underline-brutal">by age</span> and <span className="underline-brutal">by theme</span>
          </h1>
          <p className="mt-5 max-w-2xl text-base md:text-lg">
            Pick your child's age band and the themes you love — we'll surface the books that fit best.
          </p>
        </div>
      </section>

      <section className="container py-8 space-y-6 border-b border-border">
        <div>
          <p className="font-mono uppercase tracking-widest text-xs mb-3">[ 1 ] Pick age band</p>
          <AgeGroupTabs groups={ageGroups} value={age} onChange={setAge} />
        </div>
        <div>
          <p className="font-mono uppercase tracking-widest text-xs mb-3">[ 2 ] Pick themes (multiple allowed)</p>
          <ThemeChips themes={themes} value={themesSel} onChange={setThemesSel} />
        </div>
        {hasFilter && (
          <button type="button" onClick={clearAll} className="font-mono uppercase text-xs underline hover:no-underline">
            Clear all filters
          </button>
        )}
      </section>

      <section className="container py-10">
        {loading ? (
          <div className="py-16 flex justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>
        ) : results.length === 0 ? (
          <div className="py-16 border-2 border-dashed border-foreground text-center px-6">
            <div className="mx-auto mb-4 h-16 w-16 border-2 border-foreground flex items-center justify-center">
              <FileText className="h-8 w-8" />
            </div>
            <h3 className="font-display text-2xl uppercase mb-2">No books match those filters yet</h3>
            <p className="text-muted-foreground max-w-md mx-auto mb-4">
              Try clearing the filters or picking a different age band or theme.
            </p>
            <button type="button" onClick={clearAll} className="inline-block border-2 border-foreground px-5 py-2 font-display uppercase text-sm hover:bg-highlight">
              Clear filters
            </button>
          </div>
        ) : (
          <>
            <p className="font-mono uppercase tracking-widest text-xs mb-4">[ {results.length} book{results.length === 1 ? "" : "s"} ]</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {results.map((p) => (
                <Link key={p.id} to={`/product/${p.id}`} className="block border-2 border-foreground hover:shadow-brutal transition-all bg-card">
                  {p.cover_url ? (
                    <img src={p.cover_url} alt={p.title} className="w-full aspect-[2/3] object-cover border-b-2 border-foreground" />
                  ) : (
                    <div className="w-full aspect-[2/3] bg-muted flex items-center justify-center border-b-2 border-foreground">
                      <FileText className="h-10 w-10 text-muted-foreground" />
                    </div>
                  )}
                  <div className="p-4">
                    <h3 className="font-display uppercase text-lg leading-tight line-clamp-2">{p.title}</h3>
                    {p.subtitle && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{p.subtitle}</p>}
                    <p className="mt-3 font-bold tabular-nums">${(p.price_cents / 100).toFixed(2)}</p>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="container py-16 text-center border-t border-border">
        <p className="font-mono uppercase tracking-widest text-xs mb-3">[ Tip ]</p>
        <p className="max-w-xl mx-auto text-sm text-muted-foreground">
          Gift shopping? Check out{" "}
          <Link to="/bundles" className="underline font-medium">Bundles</Link>
          {" "}for curated sets at a discount.
        </p>
      </section>
    </>
  );
}
