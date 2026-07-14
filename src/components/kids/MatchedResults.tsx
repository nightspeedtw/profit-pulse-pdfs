import { Link } from "react-router-dom";
import { FileText, Eye, Sparkles } from "lucide-react";
import type { KidsAgeGroup, KidsTheme } from "@/lib/kidsTaxonomy";

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
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
          {books.map((b, i) => (
            <BookCard key={b.id} book={b} onPreview={() => onPreview(b)} index={i} />
          ))}
        </div>
      )}
    </section>
  );
};

const BookCard = ({ book, onPreview, index }: { book: MatchedBook; onPreview: () => void; index: number }) => {
  const cc = (book.storefront_meta as { conversion_copy?: { short_hook?: string; selling_hook?: string; read_aloud_minutes?: number } } | null)?.conversion_copy ?? null;
  const hook = cc?.short_hook || cc?.selling_hook;
  const priceLabel = `฿${(book.price_cents / 100 * 35).toFixed(0)}`;

  return (
    <div
      className="group flex flex-col rounded-2xl border-2 border-border bg-card overflow-hidden transition-all hover:-translate-y-1 hover:shadow-brand hover:border-accent/50 animate-fade-in-up"
      style={{ animationDelay: `${Math.min(index * 60, 400)}ms` }}
    >
      <div className="relative aspect-square bg-muted overflow-hidden">
        {book.cover_url ? (
          <img
            src={book.cover_url}
            alt={book.title}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center"><FileText className="h-10 w-10 text-muted-foreground" /></div>
        )}
        <span className="absolute top-2 right-2 px-2 py-1 rounded-full text-xs font-display bg-white/95 shadow-soft">
          {priceLabel}
        </span>
        <button
          type="button"
          onClick={onPreview}
          className="absolute inset-x-2 bottom-2 py-1.5 rounded-lg bg-white/95 backdrop-blur text-xs font-mono uppercase tracking-wide opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center justify-center gap-1"
        >
          <Eye className="h-3.5 w-3.5" /> ดูตัวอย่างข้างใน
        </button>
      </div>
      <div className="p-3 md:p-4 flex flex-col gap-1.5 flex-1">
        {hook && (
          <p className="text-[10px] font-mono uppercase tracking-widest text-accent line-clamp-1">{hook}</p>
        )}
        <h3 className="font-display text-base md:text-lg leading-tight line-clamp-2">{book.title}</h3>
        <div className="mt-auto pt-2">
          <Link
            to={`/kids/checkout/${book.id}`}
            className="block w-full text-center py-2.5 rounded-lg bg-foreground text-background font-display text-sm hover:bg-accent transition-colors"
          >
            ซื้อเลย · {priceLabel}
          </Link>
        </div>
      </div>
    </div>
  );
};
