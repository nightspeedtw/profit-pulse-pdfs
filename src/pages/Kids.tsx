import { useEffect, useMemo, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { fetchStorefront, type StorefrontEbook } from "@/lib/storefront";
import { listAgeGroups, listThemes, type KidsAgeGroup, type KidsTheme } from "@/lib/kidsTaxonomy";
import { AgeGroupTabs } from "@/components/kids/AgeGroupTabs";
import { ThemeChips } from "@/components/kids/ThemeChips";
import { MarketingRail } from "@/components/kids/MarketingRail";
import { ProductCard } from "@/components/ProductCard";
import { Loader2, FileText } from "lucide-react";

const KIDS_CATEGORY_SLUG = "parenting-kids";

export default function Kids() {
  const [ageGroups, setAgeGroups] = useState<KidsAgeGroup[]>([]);
  const [themes, setThemes] = useState<KidsTheme[]>([]);
  const [params, setParams] = useSearchParams();

  const age = params.get("age");
  const themesSel = useMemo(
    () => (params.get("themes") ?? "").split(",").filter(Boolean),
    [params],
  );

  const [results, setResults] = useState<StorefrontEbook[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = "หนังสือเด็ก — เลือกตามวัย ตามธีม | SecretPDF";
    listAgeGroups().then(setAgeGroups).catch(() => {});
    listThemes().then(setThemes).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchStorefront({
      limit: 48,
      // passthrough — storefront lib forwards unknown keys as query params
      category_slug: KIDS_CATEGORY_SLUG,
      age: age ?? undefined,
      themes: themesSel.length > 0 ? themesSel.join(",") : undefined,
    } as any)
      .then((data) => !cancelled && setResults(data))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [age, themesSel.join(",")]);

  const setAge = (slug: string | null) => {
    const next = new URLSearchParams(params);
    if (slug) next.set("age", slug);
    else next.delete("age");
    setParams(next, { replace: true });
  };
  const setThemesSel = (slugs: string[]) => {
    const next = new URLSearchParams(params);
    if (slugs.length > 0) next.set("themes", slugs.join(","));
    else next.delete("themes");
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
            หนังสือเด็ก คัด<span className="underline-brutal">ตามวัย</span> ตาม<span className="underline-brutal">ธีม</span>
          </h1>
          <p className="mt-5 max-w-2xl text-base md:text-lg">
            เลือกช่วงอายุของลูก แล้วเลือกธีมที่ใช่ ระบบจะดึงหนังสือที่เหมาะที่สุดมาให้ทันที
          </p>
        </div>
      </section>

      <section className="container py-8 space-y-6 border-b border-border">
        <div>
          <p className="font-mono uppercase tracking-widest text-xs mb-3">[ 1 ] เลือกช่วงวัย</p>
          <AgeGroupTabs groups={ageGroups} value={age} onChange={setAge} />
        </div>
        <div>
          <p className="font-mono uppercase tracking-widest text-xs mb-3">[ 2 ] เลือกธีม (เลือกได้หลายอัน)</p>
          <ThemeChips themes={themes} value={themesSel} onChange={setThemesSel} />
        </div>
        {hasFilter && (
          <button
            type="button"
            onClick={clearAll}
            className="font-mono uppercase text-xs underline hover:no-underline"
          >
            ล้างตัวกรองทั้งหมด
          </button>
        )}
      </section>

      <section className="container py-10">
        {loading ? (
          <div className="py-16 flex justify-center">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : results.length === 0 ? (
          <div className="py-16 border-2 border-dashed border-foreground text-center px-6">
            <div className="mx-auto mb-4 h-16 w-16 border-2 border-foreground flex items-center justify-center">
              <FileText className="h-8 w-8" />
            </div>
            <h3 className="font-display text-2xl uppercase mb-2">ยังไม่มีหนังสือที่ตรงกับตัวกรอง</h3>
            <p className="text-muted-foreground max-w-md mx-auto mb-4">
              ลองล้างตัวกรอง หรือเลือกช่วงวัย/ธีมอื่นดูครับ
            </p>
            <button
              type="button"
              onClick={clearAll}
              className="inline-block border-2 border-foreground px-5 py-2 font-display uppercase text-sm hover:bg-highlight"
            >
              ล้างตัวกรอง
            </button>
          </div>
        ) : (
          <>
            <p className="font-mono uppercase tracking-widest text-xs mb-4">
              [ {results.length} เล่ม ]
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {results.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </>
        )}
      </section>

      {!hasFilter && (
        <section className="container py-12 space-y-14 border-t border-border">
          <MarketingRail
            eyebrow="New Releases"
            title="มาใหม่ล่าสุด"
            query={{ category_slug: KIDS_CATEGORY_SLUG, sort: "new", limit: 8 }}
          />
          <MarketingRail
            eyebrow="Best Sellers"
            title="ขายดี · ผู้ปกครองซื้อบ่อย"
            query={{ category_slug: KIDS_CATEGORY_SLUG, bestseller: true, limit: 8 }}
          />
        </section>
      )}

      <section className="container py-16 text-center border-t border-border">
        <p className="font-mono uppercase tracking-widest text-xs mb-3">[ Tip ]</p>
        <p className="max-w-xl mx-auto text-sm text-muted-foreground">
          กำลังหาของขวัญ? ลอง{" "}
          <Link to="/bundles" className="underline font-medium">
            หมวด Bundles
          </Link>{" "}
          เพื่อดูเซ็ตหนังสือรวมสุดคุ้ม
        </p>
      </section>
    </>
  );
}
