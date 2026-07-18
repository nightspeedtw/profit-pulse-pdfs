import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, ArrowLeft, CheckCircle2, Sparkles } from "lucide-react";
import { toast } from "sonner";


interface Book {
  id: string;
  title: string;
  cover_url: string | null;
  thumbnail_url: string | null;
  price_cents: number;
  book_type: string | null;
  storefront_meta: Record<string, unknown> | null;
}

/**
 * Cart-less instant checkout for kids picture books.
 * Payment is stubbed this phase — the layout is Stripe-ready so a real
 * payment step can drop into <PaymentSection /> without touching the page.
 */
export default function KidsCheckout() {
  const { id } = useParams<{ id: string }>();
  const [book, setBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = "Checkout · Kids Books | SecretPDF";
    let cancelled = false;
    (async () => {
      if (!id) { setLoading(false); return; }
      const { data } = await supabase.from("ebooks_kids")
        .select("id,title,cover_url,thumbnail_url,price_cents,book_type,storefront_meta")
        .eq("id", id).maybeSingle();
      if (!cancelled) {
        setBook((data ?? null) as Book | null);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);


  if (loading) {
    return <div className="py-24 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-accent" /></div>;
  }
  if (!book) {
    return (
      <div className="container py-24 text-center">
        <p className="font-display text-2xl mb-3">ไม่พบหนังสือเล่มนี้</p>
        <Link to="/kids" className="text-accent underline">กลับไปที่คลังหนังสือ</Link>
      </div>
    );
  }

  const priceLabel = `฿${(book.price_cents / 100 * 35).toFixed(0)}`;

  return (
    <div className="container py-8 md:py-14 max-w-4xl">
      <Link to="/kids" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
        <ArrowLeft className="h-4 w-4" /> กลับไปเลือกเล่มอื่น
      </Link>

      <h1 className="font-display text-3xl md:text-4xl mb-2">สรุปคำสั่งซื้อ</h1>
      <p className="text-sm text-muted-foreground mb-8">ตรวจสอบเล่มที่คุณเลือกก่อนชำระเงิน</p>

      {(() => {
        const isColoring = book.book_type === "coloring_book";
        const trimLabel = isColoring ? "Coloring book · 8.5×11\"" : "Picture book · 8.5×8.5\"";
        // SQUARE-FIRST law (2026-07-18): coloring surfaces are square-first.
        // Marketing thumbnails are native 1:1; legacy rectangular covers are
        // shown complete (object-contain on white) so nothing crops.
        const thumbAspect = "aspect-square";
        const imgFit = isColoring ? "object-contain" : "object-cover";
        const imgBg = isColoring ? "bg-white" : "";
        const thumbSrc = isColoring ? (book.thumbnail_url || book.cover_url) : (book.cover_url || book.thumbnail_url);
        return (
      <div className="grid md:grid-cols-[1fr,360px] gap-6 md:gap-10">
        {/* Order summary */}
        <section className="rounded-2xl border-2 border-border bg-card overflow-hidden">
          <div className="flex flex-col sm:flex-row">
            <div className={`sm:w-52 ${thumbAspect} ${isColoring ? "bg-white" : "bg-muted"} flex-shrink-0`}>
              {thumbSrc && <img src={thumbSrc} alt={book.title} className={`w-full h-full ${imgFit} ${imgBg}`} />}
            </div>
            <div className="p-5 flex-1">
              <p className="font-mono uppercase tracking-widest text-xs text-accent mb-2">[ {trimLabel} ]</p>
              <h2 className="font-display text-xl md:text-2xl leading-tight mb-2">{book.title}</h2>
              <ul className="text-sm text-muted-foreground space-y-1.5 mt-3">
                <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-accent" /> ดาวน์โหลด PDF ทันทีหลังชำระเงิน</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-accent" /> ภาพสีคุณภาพพรีเมียมทั้งเล่ม</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-accent" /> พิมพ์ที่บ้านหรืออ่านบนแท็บเล็ต</li>
              </ul>
            </div>
          </div>
          <div className="border-t border-border p-5 flex items-center justify-between">
            <span className="font-mono uppercase text-xs tracking-widest text-muted-foreground">ราคารวม</span>
            <span className="font-display text-2xl">{priceLabel}</span>
          </div>
        </section>

        {/* Payment (stub, Stripe-ready) */}
        <aside className="rounded-2xl border-2 border-border bg-card p-5 h-fit">
          <PaymentSection book={book} />
        </aside>
      </div>
        );
      })()}
    </div>
  );
}

/**
 * Payment slot — payment bypassed during testing; direct free download.
 */
function PaymentSection({ book }: { book: Book }) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const { data, error } = await supabase.functions.invoke("free-download", {
        body: { ebook_id: book.id },
      });
      if (error || !data?.url) throw new Error(error?.message || "ไม่พร้อมดาวน์โหลด");
      window.location.href = data.url;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "ดาวน์โหลดไม่สำเร็จ";
      toast.error(msg);
      setDownloading(false);
    }
  };

  return (
    <>
      <p className="font-mono uppercase text-xs tracking-widest text-muted-foreground mb-3">[ ดาวน์โหลด ]</p>
      <button
        type="button"
        onClick={handleDownload}
        disabled={downloading}
        className="w-full py-3.5 rounded-xl bg-accent text-accent-foreground font-display text-sm inline-flex items-center justify-center gap-2 hover:bg-accent/90 transition-colors disabled:opacity-60 mb-2"
      >
        {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {downloading ? "กำลังเตรียมไฟล์..." : "ดาวน์โหลด PDF ฟรี (ทดสอบ)"}
      </button>
      <p className="text-[11px] text-muted-foreground text-center">
        ช่วงทดสอบ — ข้ามการชำระเงินชั่วคราว
      </p>
    </>
  );
}
