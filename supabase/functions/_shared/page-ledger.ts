// Page ledger — canonical page-number + content-hash bookkeeping for the
// staged kids picture-book PDF assembler.
//
// Root cause it prevents:
//   kids-build-picture-pdf appends interior pages in batches keyed by
//   pages_done in the DB. If the DB cursor is rolled back by a repair
//   worker while the in-progress PDF still holds later pages (or two
//   chained invocations race the double-tap ACK), a naive appender
//   duplicates entire batches — the exact "pages 4-8 repeat at 9-13"
//   pattern seen in Chef Pip's fixture.
//
// This module is a pure-TS, dependency-free helper so it can be unit-tested
// under vitest (node env) while also being imported by Deno edge functions.

export interface PageLedgerEntry {
  /** 1-based canonical story-page number (page 1 = first interior story page). */
  canonical_page_number: number;
  /** Monotonically increasing per-page content revision. */
  content_version: number;
  /** Deterministic 64-bit hex hash of the image bytes actually embedded. */
  image_hash: string;
  /** ISO timestamp for observability. */
  appended_at: string;
}

export type PageLedger = PageLedgerEntry[];

export interface IncomingSpread {
  canonical_page_number: number;
  content_version: number;
  image_bytes: Uint8Array;
}

export class PdfAssemblyMismatchError extends Error {
  constructor(
    public code:
      | "duplicate_page_number"
      | "duplicate_image_hash"
      | "ledger_pdf_page_count_mismatch"
      | "canonical_page_gap"
      | "canonical_page_out_of_range",
    message: string,
    public details: Record<string, unknown> = {},
  ) {
    super(`pdf_assembly_mismatch[${code}]: ${message}`);
  }
}

/** FNV-1a 64-bit hex — deterministic, dependency-free, collision-safe enough for exact-copy dedup. */
export function hashImageBytes(bytes: Uint8Array): string {
  // Two 32-bit halves to emulate 64-bit without BigInt cost per byte.
  let h1 = 0x811c9dc5 | 0;
  let h2 = 0xcbf29ce4 | 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    h1 ^= b;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= b;
    h2 = Math.imul(h2, 0x01000193);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return hex(h1) + hex(h2);
}

/**
 * Verify that `incoming` spreads can be appended to a PDF whose front-matter
 * page count is `frontMatterPages` and whose existing story pages are described
 * by `existingLedger`. Throws PdfAssemblyMismatchError on any violation.
 */
export function assertAppendable(params: {
  existingLedger: PageLedger;
  existingPdfPageCount: number;
  frontMatterPages: number;
  totalStoryPages: number;
  incoming: IncomingSpread[];
}): { hashes: string[] } {
  const {
    existingLedger,
    existingPdfPageCount,
    frontMatterPages,
    totalStoryPages,
    incoming,
  } = params;

  const expectedPageCount = frontMatterPages + existingLedger.length;
  if (existingPdfPageCount !== expectedPageCount) {
    throw new PdfAssemblyMismatchError(
      "ledger_pdf_page_count_mismatch",
      `PDF has ${existingPdfPageCount} pages, ledger implies ${expectedPageCount} ` +
        `(front_matter=${frontMatterPages} + ledger=${existingLedger.length}). ` +
        `Rebuild from prepare — do not append.`,
      { existingPdfPageCount, expectedPageCount, ledgerLength: existingLedger.length },
    );
  }

  const seenNums = new Set<number>(existingLedger.map((e) => e.canonical_page_number));
  const seenHashes = new Set<string>(existingLedger.map((e) => e.image_hash));
  const hashes: string[] = [];

  for (const s of incoming) {
    if (
      !Number.isInteger(s.canonical_page_number) ||
      s.canonical_page_number < 1 ||
      s.canonical_page_number > totalStoryPages
    ) {
      throw new PdfAssemblyMismatchError(
        "canonical_page_out_of_range",
        `canonical_page_number=${s.canonical_page_number} not in [1..${totalStoryPages}]`,
        { canonical_page_number: s.canonical_page_number, totalStoryPages },
      );
    }
    if (seenNums.has(s.canonical_page_number)) {
      throw new PdfAssemblyMismatchError(
        "duplicate_page_number",
        `canonical_page_number=${s.canonical_page_number} already in ledger`,
        { canonical_page_number: s.canonical_page_number },
      );
    }
    const h = hashImageBytes(s.image_bytes);
    if (seenHashes.has(h)) {
      throw new PdfAssemblyMismatchError(
        "duplicate_image_hash",
        `image_hash=${h} already appears in ledger (canonical_page_number=${s.canonical_page_number})`,
        { canonical_page_number: s.canonical_page_number, image_hash: h },
      );
    }
    // In-batch duplicates.
    seenNums.add(s.canonical_page_number);
    seenHashes.add(h);
    hashes.push(h);
  }

  return { hashes };
}

/**
 * Finalize-time gate: reject the whole book if the final ledger has any
 * canonical-page gap (page N missing but N+1 present) or any duplicate.
 */
export function assertLedgerContiguous(ledger: PageLedger, totalStoryPages: number): void {
  if (ledger.length !== totalStoryPages) {
    throw new PdfAssemblyMismatchError(
      "canonical_page_gap",
      `ledger has ${ledger.length} entries, expected ${totalStoryPages}`,
      { got: ledger.length, expected: totalStoryPages },
    );
  }
  const sorted = [...ledger].sort((a, b) => a.canonical_page_number - b.canonical_page_number);
  const nums = new Set<number>();
  const hashes = new Set<string>();
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    if (e.canonical_page_number !== i + 1) {
      throw new PdfAssemblyMismatchError(
        "canonical_page_gap",
        `expected page ${i + 1} at sorted position ${i}, got ${e.canonical_page_number}`,
        { position: i, canonical_page_number: e.canonical_page_number },
      );
    }
    if (nums.has(e.canonical_page_number)) {
      throw new PdfAssemblyMismatchError(
        "duplicate_page_number",
        `duplicate canonical_page_number=${e.canonical_page_number}`,
      );
    }
    if (hashes.has(e.image_hash)) {
      throw new PdfAssemblyMismatchError(
        "duplicate_image_hash",
        `duplicate image_hash=${e.image_hash}`,
      );
    }
    nums.add(e.canonical_page_number);
    hashes.add(e.image_hash);
  }
}

/** Merge new entries into a ledger, sorted by canonical page number. */
export function mergeLedger(
  existing: PageLedger,
  incoming: Array<Omit<PageLedgerEntry, "appended_at"> & { appended_at?: string }>,
): PageLedger {
  const now = new Date().toISOString();
  const out = [...existing];
  for (const e of incoming) {
    out.push({ ...e, appended_at: e.appended_at ?? now });
  }
  out.sort((a, b) => a.canonical_page_number - b.canonical_page_number);
  return out;
}
