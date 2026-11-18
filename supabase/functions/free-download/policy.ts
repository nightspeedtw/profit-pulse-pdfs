// Pure policy for the free-download endpoint (unit-tested from vitest).
//
// Kids / coloring books are sold through the Paddle checkout. This endpoint
// may only hand out a kids PDF when the book is genuinely free.

export type KidsBookForDownload = { price_cents?: number | null; pdf_url?: string | null };

export function kidsFreeDownloadDecision(book: KidsBookForDownload): { allowed: boolean; reason?: 'payment_required' | 'pdf_not_available' } {
  // Missing or invalid price is NOT free: only an explicit numeric 0 qualifies.
  const isFree = typeof book.price_cents === 'number' && book.price_cents === 0;
  if (!isFree) return { allowed: false, reason: 'payment_required' };
  if (!book.pdf_url) return { allowed: false, reason: 'pdf_not_available' };
  return { allowed: true };
}
