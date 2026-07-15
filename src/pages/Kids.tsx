import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { listAgeGroups, listThemes, type KidsAgeGroup, type KidsTheme } from "@/lib/kidsTaxonomy";
import KidsHero from "@/components/kids/KidsHero";
import { JourneyWizard, type WizardValue } from "@/components/kids/JourneyWizard";
import { MatchedResults, type MatchedBook } from "@/components/kids/MatchedResults";
import { SocialProofStrip } from "@/components/kids/SocialProofStrip";
import { PreviewLightbox } from "@/components/kids/PreviewLightbox";
import { Loader2 } from "lucide-react";

interface RawBook {
  id: string;
  title: string;
  cover_url: string | null;
  price_cents: number;
  age_group_id: string | null;
  theme_ids: string[] | null;
  storefront_meta: Record<string, unknown> | null;
  created_at: string;
}

export default function Kids() {
  const [ageGroups, setAgeGroups] = useState<KidsAgeGroup[]>([]);
  const [themes, setThemes] = useState<KidsTheme[]>([]);
  const [allBooks, setAllBooks] = useState<RawBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewBook, setPreviewBook] = useState<MatchedBook | null>(null);

  const [params, setParams] = useSearchParams();
  const pickerRef = useRef<HTMLDivElement | null>(null);

  // URL-backed wizard state
  const wizardValue: WizardValue = useMemo(() => ({
    theme: params.get("theme"),
    audience: (params.get("audience") as WizardValue["audience"]) ?? null,
    age: params.get("age"),
  }), [params]);

  const setWizardValue = (v: WizardValue) => {
    const next = new URLSearchParams(params);
    if (v.theme) next.set("theme", v.theme); else next.delete("theme");
    if (v.audience) next.set("audience", v.audience); else next.delete("audience");
    if (v.age) next.set("age", v.age); else next.delete("age");
    setParams(next, { replace: true });
  };

  const deepLinked = wizardValue.theme && wizardValue.age && wizardValue.audience;
  const [showResults, setShowResults] = useState<boolean>(!!deepLinked);

  useEffect(() => {
    document.title = "Kids Books — Bedtime stories they'll beg to re-read | SecretPDF";
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", "Premium 8.5×8.5 picture books, matched to your child's age and interests. Instant download.");
  }, []);

  useEffect(() => {
    let cancelled = false;
    const withTimeout = <T,>(p: Promise<T>, ms = 15000, fallback: T): Promise<T> =>
      Promise.race([
        p.catch(() => fallback),
        new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
      ]);

    // Narrow book projection — storefront_meta is a huge JSONB blob on some rows
    // and selecting it for the full list can hit the Postgres statement timeout.
    // We only need audience + preview_urls out of it.
    const booksPromise = supabase.from("ebooks_kids")
      .select("id,title,cover_url,price_cents,age_group_id,theme_ids,created_at,audience:storefront_meta->audience,preview_urls:storefront_meta->preview_urls")
      .eq("listing_status", "live")
      .eq("sellable", true)
      .order("created_at", { ascending: false })
      .limit(120)
      .then((r) => {
        const rows = (r.data ?? []) as Array<Record<string, unknown>>;
        return rows.map((b): RawBook => ({
          id: b.id as string,
          title: b.title as string,
          cover_url: (b.cover_url as string | null) ?? null,
          price_cents: (b.price_cents as number) ?? 0,
          age_group_id: (b.age_group_id as string | null) ?? null,
          theme_ids: (b.theme_ids as string[] | null) ?? null,
          storefront_meta: {
            audience: b.audience ?? undefined,
            preview_urls: b.preview_urls ?? undefined,
          } as Record<string, unknown>,
          created_at: b.created_at as string,
        }));
      });

    (async () => {
      try {
        const [ag, th, bk] = await Promise.all([
          withTimeout(listAgeGroups(), 15000, [] as KidsAgeGroup[]),
          withTimeout(listThemes(), 15000, [] as KidsTheme[]),
          withTimeout(booksPromise, 15000, [] as RawBook[]),
        ]);
        if (cancelled) return;
        setAgeGroups(ag);
        setThemes(th);
        setAllBooks(bk);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const scrollToPicker = () => {
    pickerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const scrollToResults = () => {
    setShowResults(true);
    setTimeout(() => {
      document.getElementById("results")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
  };

  const matched: MatchedBook[] = useMemo(() => {
    if (allBooks.length === 0) return [];
    const themeObj = themes.find((t) => t.slug === wizardValue.theme);
    const ageObj = ageGroups.find((g) => g.slug === wizardValue.age);
    const wantTheme = wizardValue.theme && wizardValue.theme !== "any" ? themeObj?.id ?? null : null;
    const wantAge   = wizardValue.age   && wizardValue.age   !== "any" ? ageObj?.id   ?? null : null;
    const wantAud   = wizardValue.audience && wizardValue.audience !== "any" ? wizardValue.audience : null;

    const scored = allBooks.map((b): MatchedBook => {
      let s = 0;
      if (wantTheme && b.theme_ids?.includes(wantTheme)) s += 2;
      if (wantAge && b.age_group_id === wantAge) s += 2;
      const bookAud = (b.storefront_meta as { audience?: string } | null)?.audience;
      if (wantAud && bookAud === wantAud) s += 1;
      if (wantAud && (bookAud === "any" || !bookAud)) s += 0.5;
      if (!wantTheme && !wantAge && !wantAud) s = 1; // no filter → keep all
      return {
        id: b.id,
        title: b.title,
        cover_url: b.cover_url,
        price_cents: b.price_cents,
        age_group_id: b.age_group_id,
        theme_ids: b.theme_ids ?? [],
        storefront_meta: b.storefront_meta,
        interior_preview_urls: ((b.storefront_meta as { preview_urls?: string[] } | null)?.preview_urls) ?? [],
        _matchScore: s,
      };
    });

    scored.sort((a, b) => b._matchScore - a._matchScore);
    // If no filters selected show all; if any filter show top ~24
    const cap = (wantTheme || wantAge || wantAud) ? 24 : 24;
    // If filters exist and everything scored 0, fall back to newest so we never dead-end.
    const anyMatch = scored.some((s) => s._matchScore >= 1);
    return (anyMatch ? scored : scored.map((b) => ({ ...b, _matchScore: 0 }))).slice(0, cap);
  }, [allBooks, ageGroups, themes, wizardValue]);

  const heroCovers = useMemo(() => allBooks.map((b) => b.cover_url).filter(Boolean) as string[], [allBooks]);

  const resetJourney = () => {
    setWizardValue({ theme: null, audience: null, age: null });
    setShowResults(false);
    setTimeout(() => pickerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };

  return (
    <>
      <KidsHero covers={heroCovers} onStart={scrollToPicker} />

      {/* Creator banner */}
      <a
        href="/create"
        className="block bg-gradient-to-r from-amber-50 via-white to-amber-50 border-y border-amber-100 py-3 text-center hover:from-amber-100 hover:to-amber-100 transition-colors"
      >
        <span className="text-sm md:text-base font-medium text-primary">
          ✨ Have a story idea? <span className="text-amber-700 font-semibold">Create your own children's ebook for $19</span> and earn 50% royalties →
        </span>
      </a>


      <div ref={pickerRef}>
        {!showResults && (
          <JourneyWizard
            themes={themes}
            ageGroups={ageGroups}
            value={wizardValue}
            onChange={setWizardValue}
            onComplete={scrollToResults}
          />
        )}
      </div>

      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-accent" /></div>
      ) : showResults ? (
        <MatchedResults
          books={matched}
          themes={themes}
          ageGroups={ageGroups}
          selectedTheme={wizardValue.theme}
          selectedAge={wizardValue.age}
          onPreview={(b) => setPreviewBook(b)}
          onReset={resetJourney}
        />
      ) : null}

      <SocialProofStrip
        bookCount={allBooks.length}
        themes={themes}
        sampleBooks={allBooks.map((b) => ({
          id: b.id,
          title: b.title,
          cover_url: b.cover_url,
          price_cents: b.price_cents,
          theme_ids: b.theme_ids ?? [],
          storefront_meta: b.storefront_meta,
        }))}
      />


      <PreviewLightbox
        open={!!previewBook}
        onClose={() => setPreviewBook(null)}
        title={previewBook?.title ?? ""}
        images={previewBook?.interior_preview_urls ?? []}
      />
    </>
  );
}
