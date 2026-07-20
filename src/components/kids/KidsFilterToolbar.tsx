import { useEffect, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { AGE_CHIPS } from "@/lib/kidsCatalogTaxonomy";
import { KIDS_MAIN_TYPES, type KidsTypeSlug, findMainType, findSubcategory } from "@/lib/kidsBookTypes";

interface Props {
  type: KidsTypeSlug | null;
  subcategory: string | null;
  age: string | null;   // AgeChipSlug or null
  onChange: (next: { type: KidsTypeSlug | null; subcategory: string | null; age: string | null }) => void;
  resultCount: number;
}

function useIsMobile() {
  const [m, setM] = useState<boolean>(() => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const h = () => setM(mq.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);
  return m;
}

/**
 * Sticky two-filter toolbar (owner spec 2026-07-20).
 * Desktop: two Popovers.
 * Mobile: two Sheets (bottom).
 * Book Type popover shows the 5 main groups as an Accordion; each group
 * lists its subcategories as radio-style items.
 */
export default function KidsFilterToolbar({ type, subcategory, age, onChange, resultCount }: Props) {
  const isMobile = useIsMobile();
  const mainType = findMainType(type);
  const sub = findSubcategory(mainType, subcategory);
  const typeLabel = mainType ? (sub ? `${mainType.label} · ${sub.label}` : mainType.label) : "Book Type";
  const ageChip = age ? AGE_CHIPS.find((c) => c.slug === age) : null;
  const ageLabel = ageChip && ageChip.slug !== "all" ? ageChip.label : "Age";
  const anyActive = !!(type || subcategory || (age && age !== "all"));

  const clearAll = () => onChange({ type: null, subcategory: null, age: null });
  const clearType = () => onChange({ type: null, subcategory: null, age });
  const clearSub  = () => onChange({ type, subcategory: null, age });
  const clearAge  = () => onChange({ type, subcategory, age: null });

  const setType = (slug: KidsTypeSlug | null) =>
    onChange({ type: slug, subcategory: null, age });
  const setSub = (mainSlug: KidsTypeSlug, subSlug: string | null) =>
    onChange({ type: mainSlug, subcategory: subSlug, age });
  const setAge = (slug: string | null) =>
    onChange({ type, subcategory, age: slug });

  return (
    <div className="sticky top-16 z-30 w-full border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto max-w-6xl px-4 py-3">
        <div className="flex items-stretch gap-2">
          {/* BOOK TYPE */}
          {isMobile ? (
            <Sheet>
              <SheetTrigger asChild>
                <button className={filterBtnCls(!!type)} aria-label="Filter by book type">
                  <span className="truncate">{typeLabel}</span>
                  <ChevronDown className="h-4 w-4 shrink-0 opacity-70" />
                </button>
              </SheetTrigger>
              <SheetContent side="bottom" className="h-[85vh] flex flex-col">
                <SheetHeader>
                  <SheetTitle>Book Type</SheetTitle>
                </SheetHeader>
                <div className="flex-1 overflow-y-auto py-2">
                  <TypePickerBody type={type} subcategory={subcategory} setType={setType} setSub={setSub} />
                </div>
                <div className="flex items-center justify-between gap-2 border-t pt-3">
                  <button onClick={clearType} className="text-sm text-muted-foreground hover:text-foreground">Reset</button>
                  <div data-close="true" />
                </div>
              </SheetContent>
            </Sheet>
          ) : (
            <Popover>
              <PopoverTrigger asChild>
                <button className={filterBtnCls(!!type)} aria-label="Filter by book type">
                  <span className="truncate">{typeLabel}</span>
                  <ChevronDown className="h-4 w-4 shrink-0 opacity-70" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[380px] max-h-[70vh] overflow-y-auto p-0">
                <div className="p-3">
                  <TypePickerBody type={type} subcategory={subcategory} setType={setType} setSub={setSub} />
                </div>
                <div className="flex items-center justify-between border-t px-3 py-2">
                  <button onClick={clearType} className="text-xs text-muted-foreground hover:text-foreground">Reset</button>
                  <span className="text-xs text-muted-foreground">{resultCount} result{resultCount === 1 ? "" : "s"}</span>
                </div>
              </PopoverContent>
            </Popover>
          )}

          {/* AGE */}
          {isMobile ? (
            <Sheet>
              <SheetTrigger asChild>
                <button className={filterBtnCls(!!age && age !== "all")} aria-label="Filter by age">
                  <span className="truncate">{ageLabel}</span>
                  <ChevronDown className="h-4 w-4 shrink-0 opacity-70" />
                </button>
              </SheetTrigger>
              <SheetContent side="bottom" className="max-h-[70vh] flex flex-col">
                <SheetHeader>
                  <SheetTitle>Age</SheetTitle>
                </SheetHeader>
                <div className="flex-1 overflow-y-auto py-2">
                  <AgePickerBody age={age} setAge={setAge} />
                </div>
                <div className="flex items-center justify-between gap-2 border-t pt-3">
                  <button onClick={clearAge} className="text-sm text-muted-foreground hover:text-foreground">Reset</button>
                </div>
              </SheetContent>
            </Sheet>
          ) : (
            <Popover>
              <PopoverTrigger asChild>
                <button className={filterBtnCls(!!age && age !== "all")} aria-label="Filter by age">
                  <span className="truncate">{ageLabel}</span>
                  <ChevronDown className="h-4 w-4 shrink-0 opacity-70" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[240px] p-2">
                <AgePickerBody age={age} setAge={setAge} />
              </PopoverContent>
            </Popover>
          )}

          <div className="ml-auto hidden md:flex items-center text-xs text-muted-foreground">
            <span aria-live="polite">{resultCount} result{resultCount === 1 ? "" : "s"}</span>
          </div>
        </div>

        {/* Active chips row */}
        {anyActive && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {mainType && (
              <Chip label={mainType.label} onRemove={clearType} />
            )}
            {sub && (
              <Chip label={sub.label} onRemove={clearSub} />
            )}
            {age && age !== "all" && (
              <Chip label={ageChip?.label ?? age} onRemove={clearAge} />
            )}
            <button
              type="button"
              onClick={clearAll}
              className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Clear all
            </button>
            <span className="ml-auto text-xs text-muted-foreground md:hidden" aria-live="polite">
              {resultCount} result{resultCount === 1 ? "" : "s"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function filterBtnCls(active: boolean) {
  return [
    "flex flex-1 md:flex-none min-w-0 md:min-w-[180px] items-center justify-between gap-2 rounded-full border px-4 py-2 text-sm font-medium min-h-11 transition",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
    active
      ? "border-accent bg-accent/10 text-foreground"
      : "border-border bg-card text-foreground hover:border-foreground/40",
  ].join(" ");
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 pl-3 pr-1 py-1 text-xs">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label} filter`}
        className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-background"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function TypePickerBody({
  type, subcategory, setType, setSub,
}: {
  type: KidsTypeSlug | null;
  subcategory: string | null;
  setType: (s: KidsTypeSlug | null) => void;
  setSub: (main: KidsTypeSlug, sub: string | null) => void;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={() => setType(null)}
        className={`mb-2 block w-full rounded-lg px-3 py-2 text-left text-sm ${!type ? "bg-accent/10 text-foreground font-medium" : "hover:bg-muted"}`}
      >
        All book types
      </button>
      <Accordion type="single" collapsible defaultValue={type ?? undefined}>
        {KIDS_MAIN_TYPES.map((t) => (
          <AccordionItem key={t.slug} value={t.slug} className="border-none">
            <div className={`flex items-center gap-1 rounded-lg ${type === t.slug ? "bg-accent/10" : ""}`}>
              <button
                type="button"
                onClick={() => setType(t.slug)}
                className="flex-1 px-3 py-2 text-left text-sm font-medium hover:bg-muted rounded-lg"
              >
                <span className="mr-2" aria-hidden="true">{t.emoji}</span>
                {t.label}
                <span className="ml-1 text-xs font-normal text-muted-foreground" lang="th">· {t.th}</span>
              </button>
              <AccordionTrigger className="p-2 hover:no-underline" aria-label={`Show subcategories for ${t.label}`} />
            </div>
            <AccordionContent className="pb-2">
              <ul className="ml-4 mt-1 space-y-0.5 border-l border-border pl-3">
                {t.subcategories.map((s) => {
                  const active = type === t.slug && subcategory === s.slug;
                  return (
                    <li key={s.slug}>
                      <button
                        type="button"
                        onClick={() => setSub(t.slug, active ? null : s.slug)}
                        className={`block w-full rounded px-2 py-1.5 text-left text-xs ${active ? "bg-accent/15 text-foreground font-medium" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                      >
                        {s.label}
                        {s.th && <span className="ml-1 opacity-70" lang="th">· {s.th}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}

function AgePickerBody({ age, setAge }: { age: string | null; setAge: (s: string | null) => void }) {
  return (
    <ul className="grid grid-cols-2 gap-1">
      {AGE_CHIPS.map((c) => {
        const selected = c.slug === "all" ? !age || age === "all" : age === c.slug;
        return (
          <li key={c.slug}>
            <button
              type="button"
              onClick={() => setAge(c.slug === "all" ? null : c.slug)}
              className={`w-full rounded-lg px-3 py-2 text-sm text-left transition ${selected ? "bg-accent/15 text-foreground font-medium" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              {c.label}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
