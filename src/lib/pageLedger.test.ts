// Regression fixture for the Chef Pip "pages 4-8 repeat at 9-13" defect.
//
// Simulates the exact race that produced duplicate blocks in the sold PDF:
//   1. Batch A (pages 1-5) appended → PDF has 3 front-matter + 5 = 8 pages.
//   2. Repair worker rolls the DB cursor back to 0, but the in-progress
//      PDF still has 8 pages.
//   3. Worker calls the appender again with pages 1-5 → OLD behavior
//      silently produces a 13-page PDF containing duplicates.
//
// The new page-ledger contract MUST throw PdfAssemblyMismatchError on
// step 3 so the caller deletes the stale in-progress PDF and restarts
// from prepare instead of shipping duplicates.

import { describe, it, expect } from "vitest";
import {
  hashImageBytes,
  assertAppendable,
  assertLedgerContiguous,
  mergeLedger,
  PdfAssemblyMismatchError,
  type PageLedger,
  type IncomingSpread,
} from "../../supabase/functions/_shared/page-ledger";

function bytesFor(seed: string): Uint8Array {
  const enc = new TextEncoder();
  return enc.encode(seed.repeat(32));
}

function spread(canonical: number, seed = `p${canonical}`): IncomingSpread {
  return { canonical_page_number: canonical, content_version: 1, image_bytes: bytesFor(seed) };
}

const FRONT = 3;
const TOTAL = 28;

describe("page-ledger — Chef Pip duplicate-block regression", () => {
  it("hash is deterministic and different for different bytes", () => {
    expect(hashImageBytes(bytesFor("a"))).toBe(hashImageBytes(bytesFor("a")));
    expect(hashImageBytes(bytesFor("a"))).not.toBe(hashImageBytes(bytesFor("b")));
  });

  it("first batch passes when PDF has only front-matter", () => {
    const ledger: PageLedger = [];
    expect(() =>
      assertAppendable({
        existingLedger: ledger,
        existingPdfPageCount: FRONT,
        frontMatterPages: FRONT,
        totalStoryPages: TOTAL,
        incoming: [spread(1), spread(2), spread(3), spread(4), spread(5)],
      }),
    ).not.toThrow();
  });

  it("REGRESSION: rejects re-append of already-persisted page numbers (the Chef Pip bug)", () => {
    // Batch A already committed pages 1..5.
    const ledger = mergeLedger(
      [],
      [1, 2, 3, 4, 5].map((n) => ({
        canonical_page_number: n,
        content_version: 1,
        image_hash: hashImageBytes(bytesFor(`p${n}`)),
      })),
    );
    // PDF correctly holds front + 5 story pages.
    expect(() =>
      assertAppendable({
        existingLedger: ledger,
        existingPdfPageCount: FRONT + 5,
        frontMatterPages: FRONT,
        totalStoryPages: TOTAL,
        // Repair rolled cursor back; naive worker resubmits 1..5.
        incoming: [spread(1), spread(2), spread(3), spread(4), spread(5)],
      }),
    ).toThrowError(/duplicate_page_number/);
  });

  it("REGRESSION: rejects re-append when the incoming batch happens to have identical image bytes on a *different* page", () => {
    const ledger = mergeLedger([], [
      {
        canonical_page_number: 4,
        content_version: 1,
        image_hash: hashImageBytes(bytesFor("shared-image")),
      },
    ]);
    expect(() =>
      assertAppendable({
        existingLedger: ledger,
        existingPdfPageCount: FRONT + 1,
        frontMatterPages: FRONT,
        totalStoryPages: TOTAL,
        // Different canonical page but identical bytes → still a dup asset.
        incoming: [{ canonical_page_number: 9, content_version: 1, image_bytes: bytesFor("shared-image") }],
      }),
    ).toThrowError(/duplicate_image_hash/);
  });

  it("REGRESSION: detects PDF/ledger drift (in-progress file has extra pages the ledger doesn't know about)", () => {
    const ledger: PageLedger = [];
    // Cursor was reset to 0 but the file still contains 5 story pages.
    expect(() =>
      assertAppendable({
        existingLedger: ledger,
        existingPdfPageCount: FRONT + 5,
        frontMatterPages: FRONT,
        totalStoryPages: TOTAL,
        incoming: [spread(1)],
      }),
    ).toThrowError(/ledger_pdf_page_count_mismatch/);
  });

  it("rejects in-batch duplicates too", () => {
    expect(() =>
      assertAppendable({
        existingLedger: [],
        existingPdfPageCount: FRONT,
        frontMatterPages: FRONT,
        totalStoryPages: TOTAL,
        incoming: [spread(1), spread(1, "different-bytes")],
      }),
    ).toThrowError(/duplicate_page_number/);
  });

  it("rejects out-of-range canonical page numbers", () => {
    expect(() =>
      assertAppendable({
        existingLedger: [],
        existingPdfPageCount: FRONT,
        frontMatterPages: FRONT,
        totalStoryPages: TOTAL,
        incoming: [spread(0), spread(TOTAL + 1)].slice(0, 1),
      }),
    ).toThrowError(/canonical_page_out_of_range/);
  });

  it("finalize gate detects missing page and duplicate image hash", () => {
    const good: PageLedger = Array.from({ length: TOTAL }, (_, i) => ({
      canonical_page_number: i + 1,
      content_version: 1,
      image_hash: hashImageBytes(bytesFor(`p${i + 1}`)),
      appended_at: "t",
    }));
    expect(() => assertLedgerContiguous(good, TOTAL)).not.toThrow();

    const missing = good.filter((e) => e.canonical_page_number !== 7);
    expect(() => assertLedgerContiguous(missing, TOTAL)).toThrow(PdfAssemblyMismatchError);

    const dupHash: PageLedger = good.map((e, i) =>
      i === 5 ? { ...e, image_hash: good[4].image_hash } : e,
    );
    expect(() => assertLedgerContiguous(dupHash, TOTAL)).toThrowError(/duplicate_image_hash/);
  });
});
