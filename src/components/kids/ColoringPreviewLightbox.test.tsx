import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const insertMock = vi.fn(async () => ({ error: null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ insert: insertMock }) },
}));

import { ColoringPreviewLightbox } from "@/components/kids/ColoringPreviewLightbox";
import { __resetColoringEventDedupeForTests } from "@/lib/coloringFunnelEvents";

const PDF_URL = "https://storage.example/private/sold-book.pdf";
const PREVIEW = [
  "https://storage.example/preview/p1.png",
  "https://storage.example/preview/p2.png",
  "https://storage.example/preview/p3.png",
];

describe("ColoringPreviewLightbox — conversion core", () => {
  beforeEach(() => {
    insertMock.mockClear();
    __resetColoringEventDedupeForTests();
    cleanup();
  });

  it("renders cover + every watermarked preview URL", () => {
    render(
      <ColoringPreviewLightbox
        ebookId="book-1"
        title="Ocean Friends"
        coverUrl="https://storage.example/cover.png"
        previewUrls={PREVIEW}
        open
        onClose={() => {}}
      />
    );
    const imgs = screen.getAllByRole("img", { hidden: true });
    const srcs = imgs.map((i) => (i as HTMLImageElement).src);
    const joined = srcs.join(" ");
    expect(joined).toContain("cover.png");
    for (const p of PREVIEW) expect(joined).toContain(p.split("/").pop()!);
    // Sold PDF URL must NEVER appear anywhere in the lightbox output.
    expect(joined).not.toContain(PDF_URL);
  });

  it("emits preview_page_turn once per unique page index on nav", () => {
    render(
      <ColoringPreviewLightbox
        ebookId="book-2"
        title="Cute Sea Animals"
        coverUrl={null}
        previewUrls={PREVIEW}
        open
        onClose={() => {}}
      />
    );
    // Open emits page 0
    // Next button (desktop chevron)
    const nextBtn = screen.getByLabelText("Next page");
    fireEvent.click(nextBtn); // page 1
    fireEvent.click(nextBtn); // page 2
    fireEvent.click(nextBtn); // clamped -> still page 2 (dedupe)
    const pageEvents = insertMock.mock.calls
      .map((c: any[]) => c[0])
      .filter((r: any) => r.event_type === "preview_page_turn");
    const pages = pageEvents.map((r: any) => r.metadata?.page_index);
    expect(new Set(pages)).toEqual(new Set([0, 1, 2]));
  });

  it("renders nothing when there are zero slides (fallback = closed)", () => {
    const { container } = render(
      <ColoringPreviewLightbox
        ebookId="b" title="x" coverUrl={null} previewUrls={[]}
        open onClose={() => {}}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});
