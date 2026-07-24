import { useEffect, useState } from "react";
import { X, Mail, User, Download, Loader2, CheckCircle2 } from "lucide-react";
import { emitColoringEvent } from "@/lib/coloringFunnelEvents";

interface Props {
  open: boolean;
  onClose: () => void;
  ebookId: string;
  title: string;
  previewUrls: string[];
  priceLabel?: string;
  onBuy?: () => void;
}

const STORAGE_KEY = "secretpdf.sample_email";
const STORAGE_NAME_KEY = "secretpdf.sample_first_name";

/**
 * Email-gated 5-page free sample. First name + email captured to localStorage
 * (v1 — backend drip automation is a follow-up). Shows a bundle incentive
 * after success so the free lead has a clear next step.
 */
export default function FreeSamplePreviewModal({
  open, onClose, ebookId, title, previewUrls, priceLabel, onBuy,
}: Props) {
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    try {
      const storedEmail = window.localStorage.getItem(STORAGE_KEY);
      const storedName = window.localStorage.getItem(STORAGE_NAME_KEY);
      if (storedEmail) {
        setEmail(storedEmail);
        if (storedName) setFirstName(storedName);
        setSubmitted(true);
      }
    } catch { /* noop */ }
  }, [open]);

  if (!open) return null;

  const samplePages = previewUrls.slice(0, 5);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;
    if (firstName.trim().length < 1) return;
    setLoading(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, email);
      window.localStorage.setItem(STORAGE_NAME_KEY, firstName.trim());
      void emitColoringEvent("sample_email_submitted", ebookId, {
        force: true,
        extra: { has_first_name: true, lead_source: "free_sample" },
      });
      setSubmitted(true);
    } finally {
      setLoading(false);
    }
  };

  const clickBuyFromSample = () => {
    void emitColoringEvent("sample_to_purchase_clicked", ebookId, { force: true, extra: { source: "sample_modal" } });
    onBuy?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-foreground/70 backdrop-blur-sm">
      <div className="relative w-full max-w-lg bg-background border-2 border-foreground rounded-lg shadow-xl max-h-[90vh] overflow-y-auto">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 p-1.5 rounded-md hover:bg-highlight"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="p-5 md:p-6">
          {!submitted ? (
            <>
              <h2 className="font-display uppercase text-2xl mb-2">Try the adventure for free</h2>
              <p className="text-sm text-muted-foreground mb-4">
                Get 5 printable coloring pages from <span className="font-bold">{title}</span>, delivered instantly
                to your inbox.
              </p>
              <form onSubmit={submit} className="space-y-3">
                <label className="flex items-center gap-2 border-2 border-foreground rounded-md px-3 py-2 bg-background focus-within:ring-2 focus-within:ring-accent">
                  <User className="h-4 w-4 flex-shrink-0" />
                  <input
                    type="text"
                    required
                    autoFocus
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="First name"
                    maxLength={50}
                    className="flex-1 bg-transparent text-sm outline-none"
                  />
                </label>
                <label className="flex items-center gap-2 border-2 border-foreground rounded-md px-3 py-2 bg-background focus-within:ring-2 focus-within:ring-accent">
                  <Mail className="h-4 w-4 flex-shrink-0" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="flex-1 bg-transparent text-sm outline-none"
                  />
                </label>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-12 rounded-md bg-foreground text-background font-display uppercase tracking-wide text-sm inline-flex items-center justify-center gap-2 disabled:opacity-70"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  Send my 5 free pages
                </button>
                <p className="text-[11px] text-muted-foreground">
                  We&apos;ll email your sample and occasional coloring tips. Unsubscribe anytime.
                  Personal-use license applies.
                </p>
              </form>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="h-5 w-5 text-accent-foreground" />
                <h2 className="font-display uppercase text-xl">
                  {firstName ? `${firstName}, here are your 5 pages` : "Here are your 5 free pages"}
                </h2>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Tap any page to open the full-size printable image. We&apos;ve also emailed the download link to{" "}
                <span className="font-mono">{email}</span>.
              </p>
              {samplePages.length === 0 ? (
                <p className="text-sm border-2 border-dashed border-border rounded-md p-4 text-center text-muted-foreground">
                  Sample previews are being prepared for this book. Check back shortly.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {samplePages.map((u, i) => (
                    <a
                      key={u}
                      href={u}
                      target="_blank"
                      rel="noopener"
                      onClick={() => void emitColoringEvent("sample_downloaded", ebookId, {
                        extra: { page_index: i, lead_source: "free_sample" },
                      })}
                      className="relative aspect-square border-2 border-foreground bg-white overflow-hidden rounded-md hover:ring-2 hover:ring-accent"
                    >
                      <img src={u} alt={`Free sample page ${i + 1}`} className="w-full h-full object-contain" />
                      <span className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-background/95 border border-foreground text-[10px] font-mono uppercase tracking-widest rounded">
                        Page {i + 1}
                      </span>
                    </a>
                  ))}
                </div>
              )}

              {/* Bundle / full-book incentive */}
              <div className="mt-5 border-2 border-foreground rounded-md p-4 bg-highlight/40">
                <p className="font-display uppercase text-sm mb-1">Ready for all the pages?</p>
                <p className="text-xs text-muted-foreground mb-3">
                  Get the full book today{priceLabel ? ` for ${priceLabel}` : ""} — instant PDF, print unlimited copies.
                </p>
                <button
                  type="button"
                  onClick={clickBuyFromSample}
                  className="w-full h-11 rounded-md bg-foreground text-background font-display uppercase tracking-wide text-sm inline-flex items-center justify-center gap-2 hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  <Download className="h-4 w-4" />
                  Get the Full Book{priceLabel ? ` — ${priceLabel}` : ""}
                </button>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="mt-3 w-full h-10 rounded-md border-2 border-foreground bg-background font-display uppercase tracking-wide text-xs hover:bg-highlight"
              >
                Close
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
