import { FileText, Sparkles } from "lucide-react";
import type { KidsAgeGroup, KidsTheme } from "@/lib/kidsTaxonomy";
import { KidsBookCard } from "./KidsBookCard";

export interface MatchedBook {
  id: string;
  title: string;
  cover_url: string | null;
  price_cents: number;
  age_group_id: string | null;
  theme_ids: string[];
  storefront_meta: Record<string, unknown> | null;
  interior_preview_urls?: string[];
  _matchScore: number;
}

interface Props {
  books: MatchedBook[];
  themes: KidsTheme[];
  ageGroups: KidsAgeGroup[];
  selectedTheme: string | null;
  selectedAge: string | null;
  onPreview: (b: MatchedBook) => void;
  onReset: () => void;
}

export const MatchedResults = ({
  books, themes, ageGroups, selectedTheme, selectedAge, onPreview, onReset,
}: Props) => {
  const themeLabel = themes.find((t) => t.slug === selectedTheme)?.label_th;
  const ageLabel   = ageGroups.find((g) => g.slug === selectedAge)?.slug;

  const exact = books.filter((b) => b._matchScore >= 2);
  const showFallbackNote = exact.length === 0 && books.length > 0;

  return (
    <section id="results" className="container py-10 md:py-16 border-t border-border scroll-mt-4">
      <div className="text-center mb-6">
        <p className="font-mono uppercase tracking-widest text-xs text-accent mb-2">[ เล่มที่แนะนำสำหรับลูกคุณ ]</p>
        <h2 className="font-display text-3xl md:text-4xl">
          {themeLabel || selectedTheme === "any" ? (themeLabel ?? "ทุกธีม") : "หนังสือทั้งหมด"}
          {ageLabel && <span className="text-muted-foreground"> · {ageLabel} ปี</span>}
        </h2>
        <button
          type="button"
          onClick={onReset}
          className="mt-3 text-xs font-mono uppercase tracking-wide underline text-muted-foreground hover:text-foreground"
        >
          เริ่มเลือกใหม่
        </button>
      </div>

      {showFallbackNote && (
        <div className="max-w-2xl mx-auto mb-6 p-4 rounded-xl border-2 border-dashed border-accent/50 bg-highlight/40 text-center text-sm">
          <Sparkles className="inline h-4 w-4 mr-1 text-accent" />
          ยังไม่มีเล่มที่ตรงเป๊ะกับตัวเลือกนี้ — นี่คือเล่มที่ใกล้เคียงที่สุดที่ลูกคุณน่าจะชอบ
        </div>
      )}

      {books.length === 0 ? (
        <div className="max-w-md mx-auto text-center py-16 border-2 border-dashed border-border rounded-2xl">
          <FileText className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
          <p className="font-display text-xl mb-2">ยังไม่มีหนังสือในคลังตอนนี้</p>
          <p className="text-sm text-muted-foreground">กลับมาใหม่อีกครั้ง — เราออกเล่มใหม่ทุกสัปดาห์</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
          {books.map((b, i) => (
            <KidsBookCard
              key={b.id}
              book={b}
              themes={themes}
              variant="grid"
              index={i}
              onPreview={() => onPreview(b)}
            />
          ))}
        </div>
      )}
    </section>
  );
};
