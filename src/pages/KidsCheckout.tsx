import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, ArrowLeft, Lock, CheckCircle2, Sparkles } from "lucide-react";
import { toast } from "sonner";

interface Book {
  id: string;
  title: string;
  cover_url: string | null;
  price_cents: number;
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
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    document.title = "Checkout · Kids Books | SecretPDF";
    let cancelled = false;
    (async () => {
      if (!id) { setLoading(false); return; }
      const { data } = await supabase.from("ebooks_kids")
        .select("id,title,cover_url,price_cents,storefront_meta")
        .eq("id", id).maybeSingle();
      if (!cancelled) {
        setBook((data ?? null) as Book | null);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const joinWaitlist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      toast.error("อีเมลไม่ถูกต้อง");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("kids_launch_leads").insert({
      email,
      ebook_id: book?.id ?? null,
      source: "kids_checkout_waitlist",
      metadata: { title: book?.title ?? null },
    });
    setSubmitting(false);
    if (error) {
      toast.error("บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง");
      return;
    }
    setJoined(true);
    toast.success("บันทึกอีเมลเรียบร้อย เราจะแจ้งเมื่อเปิดให้ซื้อ");
  };

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

      <div className="grid md:grid-cols-[1fr,360px] gap-6 md:gap-10">
        {/* Order summary */}
        <section className="rounded-2xl border-2 border-border bg-card overflow-hidden">
          <div className="flex flex-col sm:flex-row">
            <div className="sm:w-52 aspect-square bg-muted flex-shrink-0">
              {book.cover_url && <img src={book.cover_url} alt={book.title} className="w-full h-full object-cover" />}
            </div>
            <div className="p-5 flex-1">
              <p className="font-mono uppercase tracking-widest text-xs text-accent mb-2">[ Picture book · 8.5×8.5" ]</p>
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
          <PaymentSection
            book={book}
            joined={joined}
            email={email}
            setEmail={setEmail}
            submitting={submitting}
            onJoin={joinWaitlist}
          />
        </aside>
      </div>
    </div>
  );
}

/**
 * Payment slot — currently placeholder + waitlist capture.
 * When Stripe goes live, render <StripePaymentForm /> above the waitlist
 * and hide the placeholder button. Nothing else on this page needs to change.
 */
function PaymentSection({
  book, joined, email, setEmail, submitting, onJoin,
}: {
  book: Book;
  joined: boolean;
  email: string;
  setEmail: (v: string) => void;
  submitting: boolean;
  onJoin: (e: React.FormEvent) => void;
}) {
  return (
    <>
      <p className="font-mono uppercase text-xs tracking-widest text-muted-foreground mb-3">[ ชำระเงิน ]</p>

      <button
        type="button"
        disabled
        className="w-full py-3.5 rounded-xl bg-muted text-muted-foreground font-display text-sm inline-flex items-center justify-center gap-2 cursor-not-allowed mb-2"
        title="ระบบชำระเงินกำลังจะเปิดใช้งาน"
      >
        <Lock className="h-4 w-4" /> ชำระเงิน — เร็วๆ นี้
      </button>
      <p className="text-[11px] text-muted-foreground text-center mb-5">
        รองรับบัตรเครดิต / PromptPay ในเร็วๆ นี้
      </p>

      {joined ? (
        <div className="rounded-xl bg-highlight/60 border border-accent/30 p-4 text-center">
          <Sparkles className="h-5 w-5 text-accent mx-auto mb-1" />
          <p className="font-display text-base">บันทึกเรียบร้อย</p>
          <p className="text-xs text-muted-foreground mt-1">เราจะแจ้งเตือนเมื่อเปิดให้ซื้อ "{book.title}"</p>
        </div>
      ) : (
        <form onSubmit={onJoin} className="space-y-2">
          <label className="text-xs text-muted-foreground block">
            แจ้งเตือนฉันเมื่อพร้อมขาย
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            className="w-full h-11 px-3 rounded-lg border-2 border-border bg-background focus:border-accent outline-none"
          />
          <button
            type="submit"
            disabled={submitting}
            className="w-full h-11 rounded-lg bg-accent text-accent-foreground font-display text-sm hover:bg-accent/90 transition-colors disabled:opacity-60"
          >
            {submitting ? "กำลังบันทึก..." : "แจ้งเตือนฉัน"}
          </button>
        </form>
      )}
    </>
  );
}
