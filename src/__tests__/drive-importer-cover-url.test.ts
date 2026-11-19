import { describe, it, expect } from "vitest";
import { buildDriveProductRow, needsCoverBackfill } from "../../supabase/functions/drive-importer/row";

// Regression: the importer fetched a Drive thumbnail but never wrote it to
// drive_products.cover_url, so every card on /shop rendered the "PDF"
// placeholder (persistence_contract: producer -> field -> reader mismatch).
const base = {
  file: { id: "1D8Nct_ujDfkpVzRpXhQkaf4tNayCsL5S", name: "Ocean-Dreams.pdf", modifiedTime: "2026-11-18T11:07:07.751Z", size: "5593644", parents: ["folder1"], thumbnailLink: "https://lh3.example/thumb=s220" },
  parentName: "Coloring Book",
  category: "coloring" as const,
  title: "Ocean Dreams",
  baseSlug: "ocean-dreams",
  priceCents: 2499,
  pdfUrl: "https://storage.example/signed.pdf",
  storagePath: "drive/1D8Nct.pdf",
  byteLength: 5593644,
  hash: "abc",
  isExisting: false,
};

describe("drive-importer product row", () => {
  it("persists the fetched thumbnail as cover_url (the field /shop reads)", () => {
    const row = buildDriveProductRow({ ...base, thumbUrl: "https://storage.example/thumb.jpg" });
    expect(row.cover_url).toBe("https://storage.example/thumb.jpg");
    expect(row.import_error).toBeNull();
  });

  it("stores null cover_url and a diagnostic when no thumbnail could be fetched", () => {
    const row = buildDriveProductRow({ ...base, thumbUrl: null });
    expect(row.cover_url).toBeNull();
    expect(row.import_error).toContain("thumb-debug");
  });

  it("never rewrites the slug of an existing product", () => {
    expect(buildDriveProductRow({ ...base, thumbUrl: null, isExisting: true }).slug).toBeUndefined();
    expect(buildDriveProductRow({ ...base, thumbUrl: null }).slug).toBe("ocean-dreams-1D8Nct");
  });

  it("flags unchanged products that still have no cover for backfill", () => {
    expect(needsCoverBackfill({ cover_url: null })).toBe(true);
    expect(needsCoverBackfill({ cover_url: "" })).toBe(true);
    expect(needsCoverBackfill({ cover_url: "/placeholder.svg" })).toBe(true);
    expect(needsCoverBackfill({ cover_url: "https://storage.example/thumb.jpg" })).toBe(false);
  });
});
