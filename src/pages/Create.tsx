import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Lightbulb,
  BookOpen,
  Palette,
  Sparkles,
  Coins,
  Check,
  ArrowRight,
  ShieldCheck,
  Loader2,
} from "lucide-react";
import { listThemes, type KidsTheme } from "@/lib/kidsTaxonomy";
import { fetchStorefront, type StorefrontEbook } from "@/lib/storefront";
const heroImg = "/site-assets/create-hero.jpg";

const AGE_BANDS = [
  { value: "0-3", label: "0–3 years" },
  { value: "4-6", label: "4–6 years" },
  { value: "5-7", label: "5–7 years" },
  { value: "7-9", label: "7–9 years" },
];

const STEPS = [
  { icon: Lightbulb, title: "Submit your story idea", body: "Tell us the spark — a character, a moment, a lesson. Even one sentence is enough to start." },
  { icon: BookOpen, title: "We create the ebook", body: "Our craft pipeline develops the story with age-appropriate pacing, characters, and page structure." },
  { icon: Palette, title: "We design cover & thumbnail", body: "A studio-grade cover and a photoreal book mockup that catches eyes on the storefront." },
  { icon: Sparkles, title: "We prepare it for sale", body: "Professional 8.5×8.5 PDF, quality-reviewed, listed with a polished product page." },
  { icon: Coins, title: "You earn 50% royalty", body: "Every approved sale pays you 50% of the net amount. Write once, sell for life." },
];

const WHAT_YOU_GET = [
  "Children's story writing assistance",
  "Story structure & page planning",
  "Character consistency system",
  "Beautiful ebook cover",
  "Realistic book mockup thumbnail",
  "Professional PDF formatting",
  "SecretPDF listing opportunity",
  "50% royalty share on approved sales",
];

const FAQS = [
  {
    q: "Do I need to write the whole book myself?",
    a: "No. You bring the idea — a character, a theme, or a rough story — and our team handles the full manuscript, illustrations, and layout. You review before it goes live.",
  },
  {
    q: "What if I only have an idea?",
    a: "That's exactly what this service is for. A single paragraph or even a sentence about your character or theme is enough to begin.",
  },
  {
    q: "What kind of books are accepted?",
    a: "Only children's storybooks are accepted at this time (ages roughly 0–9). Books must be age-appropriate, original in concept, and free of unsafe or copyrighted content.",
  },
  {
    q: "Why only children's books right now?",
    a: "We are perfecting our story, illustration, character-consistency, and layout pipeline for the children's format first. Other categories will open once we can guarantee the same quality bar.",
  },
  {
    q: "How does the 50% royalty work?",
    a: "For every approved ebook sold through SecretPDF, you receive 50% of the net sale amount (after payment processing fees). Payouts and reporting details are shared once your book is approved.",
  },
  {
    q: "Do you guarantee sales?",
    a: "No. We do not and cannot guarantee sales or income. Actual sales depend on the concept, category demand, and market conditions. What we guarantee is a professionally produced, listable book if your idea passes quality review.",
  },
  {
    q: "Who owns the book?",
    a: "You retain creative credit as the idea author. SecretPDF holds the exclusive right to list and sell the produced ebook on our storefront. Full terms are shared before your book goes live.",
  },
  {
    q: "Can I request edits?",
    a: "Yes. You get a review round before publication. Substantial rewrites beyond that may be treated as a new submission.",
  },
  {
    q: "When do other categories open?",
    a: "We do not have a public date yet. Join by submitting a children's book idea today and we'll notify you when new categories open.",
  },
];

export default function Create() {
  const [themes, setThemes] = useState<KidsTheme[]>([]);
  const [sampleBook, setSampleBook] = useState<StorefrontEbook | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);
  const howRef = useRef<HTMLDivElement | null>(null);

  // form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [idea, setIdea] = useState("");
  const [ageBand, setAgeBand] = useState("4-6");
  const [themeSlug, setThemeSlug] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    document.title = "Create a Children's Ebook for $19 — Earn 50% Royalties | SecretPDF";
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", "Turn your story idea into a beautifully designed children's ebook. Sell it on SecretPDF and earn 50% royalties on every approved sale. $19 flat fee. Children's books only.");
  }, []);

  useEffect(() => {
    (async () => {
      const [t, books] = await Promise.all([
        listThemes().catch(() => []),
        fetchStorefront({ limit: 12, sort: "sales" }).catch(() => []),
      ]);
      setThemes(t);
      const withPreviews = books.find((b) => (b.preview_images?.length ?? 0) >= 2) ?? books[0] ?? null;
      setSampleBook(withPreviews);
    })();
  }, []);

  const ideaValid = idea.trim().length >= 30;
  const canSubmit = name.trim().length >= 1 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && ideaValid && !submitting;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    const { error } = await supabase.from("creator_submissions").insert({
      name: name.trim(),
      email: email.trim(),
      story_idea: idea.trim(),
      age_band: ageBand,
      theme_slug: themeSlug || null,
    });
    setSubmitting(false);
    if (error) {
      toast.error("Something went wrong. Please try again.");
      return;
    }
    setSubmitted(true);
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 40);
  };

  const scrollTo = (r: React.RefObject<HTMLDivElement>) =>
    r.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  const previewImages = useMemo(
    () => (sampleBook?.preview_images ?? []).slice(0, 3),
    [sampleBook],
  );

  return (
    <div className="bg-white">
      {/* HERO */}
      <section className="relative overflow-hidden bg-gradient-to-b from-[#FFF8EE] via-white to-white">
        <div className="container grid md:grid-cols-2 gap-10 md:gap-14 py-14 md:py-24 items-center">
          <div className="space-y-6">
            <span className="inline-flex items-center gap-2 rounded-full bg-amber-100/70 text-amber-900 px-3 py-1 text-xs font-semibold tracking-wide">
              <Sparkles className="h-3.5 w-3.5" /> Children's books only · Now open
            </span>
            <h1 style={{ fontFamily: '"Mali", "Baloo 2", system-ui, sans-serif' }} className="text-4xl md:text-5xl lg:text-6xl font-bold leading-[1.05] text-primary">
              Create a Children's Ebook for <span className="text-amber-600">$19</span> — Sell It on SecretPDF and Earn <span className="text-amber-600">50%</span> Royalties
            </h1>
            <p className="text-lg text-muted-foreground max-w-xl leading-relaxed">
              เปลี่ยนไอเดียของคุณเป็นหนังสือนิทานพร้อมขาย — รับส่วนแบ่ง 50% ทุกยอดขาย
            </p>
            <p className="text-base md:text-lg text-foreground/80 max-w-xl">
              Turn your story idea into a beautifully designed children's ebook. We help write, design, format, and prepare your book for sale on SecretPDF.
            </p>

            <div className="flex flex-wrap gap-3 pt-2">
              <Button
                size="lg"
                onClick={() => scrollTo(formRef)}
                className="bg-amber-500 hover:bg-amber-600 text-white shadow-brand rounded-full px-7 h-12 text-base font-semibold"
              >
                Start My Children's Ebook <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => scrollTo(howRef)}
                className="rounded-full px-6 h-12 border-border"
              >
                How It Works
              </Button>
            </div>

            <div className="flex flex-wrap gap-2 pt-3">
              {["$19 per book", "50% royalty share", "Children's books only", "We do the writing, design & PDF"].map((b) => (
                <span key={b} className="text-xs md:text-sm bg-secondary text-foreground/80 rounded-full px-3 py-1.5 border border-border-soft">
                  {b}
                </span>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-6 bg-gradient-to-tr from-amber-100/70 to-transparent blur-2xl rounded-full" aria-hidden />
            <img
              src={heroImg}
              alt="Illustrated children's storybook with cover art of a boy hero and his dog, plus a tablet preview and a royalty-flow diagram"
              width={1536}
              height={1024}
              className="relative w-full h-auto rounded-2xl"
            />
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section ref={howRef} className="py-20 md:py-28 bg-white">
        <div className="container">
          <div className="max-w-2xl mx-auto text-center mb-14">
            <p className="text-sm font-semibold text-amber-600 uppercase tracking-widest">How it works</p>
            <h2 style={{ fontFamily: '"Mali", "Baloo 2", system-ui, sans-serif' }} className="text-3xl md:text-4xl font-bold text-primary mt-2">
              Idea in. Book out. Royalty in your pocket.
            </h2>
          </div>

          <div className="grid md:grid-cols-5 gap-6">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              return (
                <div
                  key={i}
                  className="relative bg-white border border-border-soft rounded-2xl p-6 shadow-soft hover:shadow-elegant transition-shadow"
                >
                  <div className="absolute -top-3 left-6 bg-amber-500 text-white text-xs font-bold rounded-full w-7 h-7 flex items-center justify-center shadow-brand">
                    {i + 1}
                  </div>
                  <div className="w-11 h-11 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center mb-4">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="font-semibold text-primary mb-1.5">{s.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{s.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* WHAT YOU GET */}
      <section className="py-20 md:py-24 bg-[#FDFAF3]">
        <div className="container">
          <div className="max-w-2xl mx-auto text-center mb-12">
            <p className="text-sm font-semibold text-amber-600 uppercase tracking-widest">What you get</p>
            <h2 style={{ fontFamily: '"Mali", "Baloo 2", system-ui, sans-serif' }} className="text-3xl md:text-4xl font-bold text-primary mt-2">
              A complete, sale-ready children's ebook
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-5xl mx-auto">
            {WHAT_YOU_GET.map((w) => (
              <div key={w} className="flex items-start gap-3 bg-white rounded-xl p-4 border border-border-soft">
                <div className="mt-0.5 h-6 w-6 rounded-full bg-amber-500 flex items-center justify-center shrink-0">
                  <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
                </div>
                <span className="text-sm font-medium text-foreground/90">{w}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* WHY CHILDREN'S BOOKS FIRST */}
      <section className="py-20 md:py-24 bg-white">
        <div className="container max-w-4xl">
          <div className="relative rounded-3xl bg-gradient-to-br from-amber-50 via-white to-amber-50/40 border border-amber-100 p-8 md:p-12 shadow-soft overflow-hidden">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-10 w-10 rounded-full bg-amber-500 flex items-center justify-center shadow-brand">
                <ShieldCheck className="h-5 w-5 text-white" />
              </div>
              <p className="text-sm font-semibold text-amber-700 uppercase tracking-widest">Quality first</p>
            </div>
            <h2 style={{ fontFamily: '"Mali", "Baloo 2", system-ui, sans-serif' }} className="text-2xl md:text-3xl font-bold text-primary mb-4">
              Why children's storybooks — first
            </h2>
            <p className="text-base md:text-lg text-foreground/80 leading-relaxed">
              We're opening SecretPDF Creator with children's books only. Kids' picture books demand the highest craft bar in publishing — consistent characters across every page, age-perfect language, warm illustrations, and print-grade layout. We've built the whole pipeline for exactly that. Once we can promise the same standard in other categories, we'll open them next.
            </p>
          </div>
        </div>
      </section>

      {/* ROYALTY EXPLANATION */}
      <section className="py-20 md:py-24 bg-[#FDFAF3]">
        <div className="container grid md:grid-cols-2 gap-12 items-center">
          <div>
            <p className="text-sm font-semibold text-amber-600 uppercase tracking-widest">Royalty share</p>
            <h2 style={{ fontFamily: '"Mali", "Baloo 2", system-ui, sans-serif' }} className="text-3xl md:text-4xl font-bold text-primary mt-2 mb-5">
              A simple 50/50 split on every approved sale
            </h2>
            <p className="text-foreground/80 leading-relaxed mb-4">
              You earn <strong>50% of the net sale amount</strong> from every approved ebook sold through SecretPDF. Books remain listed as long as they meet our quality and content standards.
            </p>
            <p className="text-sm text-muted-foreground">
              Note: royalties are earned on actual sales only. We do not guarantee sales or minimum earnings.
            </p>
          </div>

          <div className="relative bg-white rounded-3xl border border-border-soft p-8 shadow-soft">
            <div className="text-center mb-6">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">Every net sale</p>
              <p className="text-4xl font-bold text-primary mt-1">= 100%</p>
            </div>
            <div className="flex rounded-2xl overflow-hidden h-20 shadow-inner">
              <div className="w-1/2 bg-amber-500 text-white flex flex-col items-center justify-center">
                <span className="text-2xl font-bold">50%</span>
                <span className="text-xs font-medium opacity-90">You (creator)</span>
              </div>
              <div className="w-1/2 bg-primary text-primary-foreground flex flex-col items-center justify-center">
                <span className="text-2xl font-bold">50%</span>
                <span className="text-xs font-medium opacity-90">Platform</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* EXAMPLE BOOK */}
      {sampleBook && (
        <section className="py-20 md:py-24 bg-white">
          <div className="container">
            <div className="max-w-2xl mx-auto text-center mb-10">
              <p className="text-sm font-semibold text-amber-600 uppercase tracking-widest">Made with the same pipeline</p>
              <h2 style={{ fontFamily: '"Mali", "Baloo 2", system-ui, sans-serif' }} className="text-3xl md:text-4xl font-bold text-primary mt-2">
                Here's an example from our catalog
              </h2>
            </div>

            <div className="grid md:grid-cols-[280px_1fr] gap-8 items-start max-w-4xl mx-auto">
              <div className="mx-auto md:mx-0">
                {sampleBook.cover_url && (
                  <img
                    src={sampleBook.store_thumbnail_url || sampleBook.cover_url}
                    alt={sampleBook.title}
                    className="w-64 h-auto rounded-xl shadow-elegant"
                    loading="lazy"
                  />
                )}
                <p className="mt-4 font-semibold text-primary text-center md:text-left">{sampleBook.title}</p>
                <Link
                  to={`/product/${sampleBook.id}`}
                  className="text-sm text-amber-600 hover:text-amber-700 font-medium inline-flex items-center gap-1 mt-1"
                >
                  View live listing <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {previewImages.map((src, i) => (
                  <div key={i} className="aspect-square rounded-lg overflow-hidden border border-border-soft bg-secondary">
                    <img src={src} alt={`Preview ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
                  </div>
                ))}
                {previewImages.length === 0 && (
                  <p className="col-span-3 text-sm text-muted-foreground">Interior previews coming soon.</p>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* FAQ */}
      <section className="py-20 md:py-24 bg-[#FDFAF3]">
        <div className="container max-w-3xl">
          <div className="text-center mb-10">
            <p className="text-sm font-semibold text-amber-600 uppercase tracking-widest">FAQ</p>
            <h2 style={{ fontFamily: '"Mali", "Baloo 2", system-ui, sans-serif' }} className="text-3xl md:text-4xl font-bold text-primary mt-2">
              Questions, answered honestly
            </h2>
          </div>
          <Accordion type="single" collapsible className="space-y-3">
            {FAQS.map((f, i) => (
              <AccordionItem key={i} value={`f-${i}`} className="bg-white border border-border-soft rounded-xl px-5">
                <AccordionTrigger className="text-left font-semibold text-primary hover:no-underline">
                  {f.q}
                </AccordionTrigger>
                <AccordionContent className="text-foreground/80 leading-relaxed">
                  {f.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      {/* SUBMISSION FORM + FINAL CTA */}
      <section ref={formRef} className="py-20 md:py-28 bg-gradient-to-b from-white to-[#FFF8EE]">
        <div className="container max-w-2xl">
          <div className="text-center mb-10">
            <h2 style={{ fontFamily: '"Mali", "Baloo 2", system-ui, sans-serif' }} className="text-3xl md:text-4xl font-bold text-primary">
              Start your children's ebook today
            </h2>
            <p className="text-muted-foreground mt-3">
              Submit your idea below. We'll review and reply by email — no payment collected yet.
            </p>
          </div>

          {submitted ? (
            <div className="bg-white rounded-2xl p-8 md:p-10 shadow-elegant border border-amber-100 text-center space-y-4">
              <div className="mx-auto h-14 w-14 rounded-full bg-amber-500 flex items-center justify-center">
                <Check className="h-7 w-7 text-white" strokeWidth={3} />
              </div>
              <h3 className="text-2xl font-bold text-primary" style={{ fontFamily: '"Mali", system-ui' }}>
                Idea received! 🎉
              </h3>
              <p className="text-foreground/80 leading-relaxed">
                เราได้รับไอเดียของคุณแล้ว! ทีมงานจะติดต่อกลับทาง email เพื่อยืนยันและชำระเงิน $19 เมื่อหนังสือผ่านการอนุมัติ
              </p>
              <p className="text-sm text-muted-foreground">
                We'll email you shortly to confirm your idea. The $19 fee is only requested once your book is approved for production.
              </p>
            </div>
          ) : (
            <form
              onSubmit={onSubmit}
              className="bg-white rounded-2xl p-6 md:p-8 shadow-elegant border border-border-soft space-y-5"
            >
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="cs-name">Your name</Label>
                  <Input id="cs-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" maxLength={120} required />
                </div>
                <div>
                  <Label htmlFor="cs-email">Email</Label>
                  <Input id="cs-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" maxLength={255} required />
                </div>
              </div>

              <div>
                <Label htmlFor="cs-idea">Your story idea</Label>
                <Textarea
                  id="cs-idea"
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                  placeholder="A brave little turtle who's afraid of the ocean until she meets a wise old crab..."
                  className="min-h-32"
                  maxLength={4000}
                  required
                />
                <p className={`text-xs mt-1 ${idea.length && !ideaValid ? "text-destructive" : "text-muted-foreground"}`}>
                  {idea.trim().length}/30 characters minimum
                </p>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="cs-age">Preferred age band</Label>
                  <Select value={ageBand} onValueChange={setAgeBand}>
                    <SelectTrigger id="cs-age"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {AGE_BANDS.map((a) => (
                        <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="cs-theme">Theme (optional)</Label>
                  <Select value={themeSlug} onValueChange={setThemeSlug}>
                    <SelectTrigger id="cs-theme"><SelectValue placeholder="Choose a theme" /></SelectTrigger>
                    <SelectContent>
                      {themes.map((t) => (
                        <SelectItem key={t.slug} value={t.slug}>{t.label_en || t.label_th}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button
                type="submit"
                disabled={!canSubmit}
                size="lg"
                className="w-full bg-amber-500 hover:bg-amber-600 text-white rounded-full h-12 text-base font-semibold shadow-brand"
              >
                {submitting ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting…</>
                ) : (
                  <>Submit my idea <ArrowRight className="ml-1 h-4 w-4" /></>
                )}
              </Button>

              <p className="text-xs text-muted-foreground text-center">
                No payment now. $19 is collected only after your idea passes review. Sales are not guaranteed.
              </p>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
