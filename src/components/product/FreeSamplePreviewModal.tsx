import { useEffect, useState } from "react";
import { X, Mail, Download, Loader2, CheckCircle2 } from "lucide-react";
import { emitColoringEvent } from "@/lib/coloringFunnelEvents";

interface Props {
  open: boolean;
  onClose: () => void;
  ebookId: string;
  title: string;
  previewUrls: string[];
}

const STORAGE_KEY = "secretpdf.sample_email";

/**
 * Lightweight email gate for the 5-page free coloring sample. Email is stored
 * locally (localStorage) — no backend write, no email deliverability required
 * for v1. On success, the shopper sees the 5 preview pages in a printable list
 * with a per-page "Save PDF" (opens image in new tab, ready to print).
 */
export default function FreeSamplePreviewModal({ open, onClose, ebookId, title, previewUrls }: Props) {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (stored) {
      setEmail(stored);
      setSubmitted(true);
    }
  }, [open]);

  if (!open) return null;

  const samplePages = previewUrls.slice(0, 5);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;
    setLoading(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, email);
      void emitColoringEvent("preview_email_gate", ebookId, { force: true, extra: { email_captured: true } });
      setSubmitted(true);
    } finally {
      setLoading(false);
    }
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
              <h2 className="font-display uppercase text-2xl mb-2">Preview 5 free coloring pages</h2>
              <p className="text-sm text-muted-foreground mb-4">
                Enter your email and we&apos;ll show you 5 pages from <span className="font-bold">{title}</span> right
                now — no credit card, no waiting.
              </p>
              <form onSubmit={submit} className="space-y-3">
                <label className="flex items-center gap-2 border-2 border-foreground rounded-md px-3 py-2 bg-background focus-within:ring-2 focus-within:ring-accent">
                  <Mail className="h-4 w-4 flex-shrink-0" />
                  <input
                    type="email"
                    required
                    autoFocus
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
                  Show my 5 free pages
                </button>
                <p className="text-[11px] text-muted-foreground">
                  We&apos;ll never share your email. Personal-use license applies to sample pages.
                </p>
              </form>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="h-5 w-5 text-accent-foreground" />
                <h2 className="font-display uppercase text-xl">Here are your 5 free pages</h2>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Tap any page to open the full-size PDF-ready image. Print from your browser or save to your device.
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
              <button
                type="button"
                onClick={onClose}
                className="mt-4 w-full h-11 rounded-md border-2 border-foreground bg-background font-display uppercase tracking-wide text-sm hover:bg-highlight"
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
