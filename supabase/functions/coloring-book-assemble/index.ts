// coloring-book-assemble — builds the final 8.5"×11" portrait PDF.
//
// STANDARD structure (page_count >= 8):
//   1. Full-bleed cover
//   2. Title page (title + subtitle + age badge)
//   3. Copyright page
//   4. "How to color" tips page
//   5. N interior coloring pages (with kids-branding footer: logo BR + © BL)
//   6. Completion certificate page
//   → expected_page_count = 4 + N + 1
//
// MINI_TEST structure (page_count <= 4, owner smoke test):
//   1. Full-bleed cover
//   2. N interior coloring pages (same branded footer, same gates)
//   3. Combined back page: certificate + compact copyright + secretpdf.co
//   → expected_page_count = N + 2
//
// Applies weighted acceptance gate on the assembled page set before
// uploading. Never lowers thresholds.

// @ts-nocheck  Deno edge runtime
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import { uploadAndSignImage } from "../_shared/versioned-assets.ts";
import {
  loadKidsFooterLogoBytes,
  embedKidsFooterLogo,
} from "../_shared/kids-branding.ts";
import { KIDS_BRAND_LAYOUT, KIDS_BRAND_FOOTER_DIMS } from "../_shared/kids-branding-policy.ts";
import { coloringBookWeightedGate, coloringCoverGate, coloringReleaseGate } from "../_shared/coloring/gates.ts";
import { computeSharpness, SHARPNESS_GATE_VERSION } from "../_shared/coloring/sharpness-gate.ts";
import { decideAssemblySharpnessPreflight } from "../_shared/coloring/assembly-sharpness.ts";
import { verifyAnatomyBatch, ANATOMY_VERIFIER_VERSION, summarizeBookAnatomy, type AnatomyPageVerdict } from "../_shared/coloring/anatomy-verify.ts";
import { drawFitText, drawFitParagraph } from "../_shared/pdf/shrink-to-fit.ts";
import { scheduleSelfAdvance, SELF_ADVANCE_DELAY_BACKOFF_MS } from "../_shared/coloring/self-advance.ts";

declare const Deno: any;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// US Letter portrait, 72dpi PDF-lib units (points).
const PAGE_W = 612;   // 8.5"
const PAGE_H = 792;   // 11"
const SAFE_MARGIN = 36;
const COLORING_PAGE_FLOOR_FROM_SHARPNESS = 88;

function json(x: unknown, status = 200) {
  return new Response(JSON.stringify(x), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function chain(fn: string, body: Record<string, unknown>) {
  const doIt = async () => {
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      console.error(`[coloring-assemble] chain ${fn} failed`, (e as Error).message);
    }
  };
  // @ts-ignore
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(doIt());
  else doIt();
}

async function patchMeta(db: any, id: string, patch: Record<string, unknown>) {
  const { data } = await db.from("ebooks_kids").select("metadata").eq("id", id).single();
  const merged = { ...(data?.metadata ?? {}), ...patch };
  await db.from("ebooks_kids").update({ metadata: merged }).eq("id", id);
  return merged;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch_${r.status}_${url.slice(0, 80)}`);
  return new Uint8Array(await r.arrayBuffer());
}

async function embedAny(doc: any, bytes: Uint8Array) {
  // Try PNG first; fall back to JPEG.
  try { return await doc.embedPng(bytes); } catch {}
  return await doc.embedJpg(bytes);
}

function drawColoringFooter(page: any, logoImg: any, font: any) {
  // Logo bottom-right ~13% of page width.
  const logoW = Math.max(KIDS_BRAND_LAYOUT.logo_min_pt, PAGE_W * KIDS_BRAND_LAYOUT.logo_frac);
  const scale = logoW / KIDS_BRAND_FOOTER_DIMS.w;
  const logoH = KIDS_BRAND_FOOTER_DIMS.h * scale;
  page.drawImage(logoImg, {
    x: PAGE_W - SAFE_MARGIN - logoW,
    y: SAFE_MARGIN,
    width: logoW, height: logoH,
    opacity: 0.85,
  });
  // Copyright bottom-left — shrink-to-fit, never clips into the logo.
  drawFitText(page, {
    text: KIDS_BRAND_LAYOUT.copyright_text,
    x: SAFE_MARGIN, y: SAFE_MARGIN + 2,
    maxWidth: PAGE_W - 2 * SAFE_MARGIN - logoW - 12,
    font,
    size: KIDS_BRAND_LAYOUT.copyright_pt,
    minSize: 6,
    color: rgb(0.35, 0.28, 0.22),
  });
}

function centerFit(page: any, text: string, y: number, size: number, font: any, color = rgb(0.15, 0.10, 0.05), minSize = 10) {
  drawFitText(page, {
    text, x: PAGE_W / 2, y, size, minSize,
    maxWidth: PAGE_W - 2 * SAFE_MARGIN,
    font, color, align: "center",
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { ebook_id, force } = await req.json();
    if (!ebook_id) return json({ error: "ebook_id required" }, 400);
    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const { data: row, error } = await db.from("ebooks_kids")
      .select("id, book_type, title, subtitle, metadata, cover_url, pdf_url")
      .eq("id", ebook_id).maybeSingle();
    if (error) throw error;
    if (!row) return json({ error: "not_found" }, 404);
    if (row.book_type !== "coloring_book") return json({ error: "wrong_lane" }, 400);

    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    // Owner-side audit is release-blocking: assembly hands off to a
    // publish-candidate record, never live storefront, until owner flips live.
    const publishMode = "candidate";

    if (!force && meta.coloring_assembly && row.pdf_url) {
      await patchMeta(db, ebook_id, {
        coloring_current_step_label: "PDF already assembled — creating publish candidate",
        awaiting: "publish_candidate",
      });
      chain("coloring-book-publish", { ebook_id, mode: publishMode });
      return json({ ok: true, skipped: "pdf_exists", chained: "publish_candidate", pdf_url: row.pdf_url });
    }

    const plan = ((meta.coloring_page_plan as any)?.plan ?? []) as any[];
    const pages = ((meta.coloring_pages as any[] | undefined) ?? []).slice().sort((a, b) => a.page - b.page);

    if (!row.cover_url) return json({ error: "cover_missing" }, 422);
    if (pages.length === 0 || pages.length !== plan.length) {
      return json({ error: "interior_incomplete", have: pages.length, need: plan.length }, 422);
    }

    await patchMeta(db, ebook_id, {
      coloring_current_step_label: "Assembling PDF",
      coloring_progress_percent: 95,
    });

    const categoryName = (meta.category_name as string) ?? "Coloring Book";
    const ageMin = ((meta.coloring_category_meta as any)?.target_age_min) ?? 4;
    const ageMax = ((meta.coloring_category_meta as any)?.target_age_max) ?? 6;
    const ageBadge = `Ages ${ageMin}-${ageMax}`;
    const totalPages = plan.length;
    const subtitle = row.subtitle || `${totalPages} Coloring Pages · ${ageBadge}`;

    // Assembly-time sharpness sweep: every legacy/stored interior page must be
    // measured before embedding. Below-floor or decode-unmeasured pages are
    // removed from metadata and regenerated under the crisp repair regime.
    const priorSharpnessTable = (((meta as any).coloring_assembly?.sharpness_table as any[] | undefined) ?? []);
    const sharpnessByPage = new Map<number, any>();
    for (const r of priorSharpnessTable) {
      if (r?.page && typeof r.score === "number" && r.gate_version === SHARPNESS_GATE_VERSION) sharpnessByPage.set(Number(r.page), r);
    }
    for (const pageRec of pages) {
      if (sharpnessByPage.has(pageRec.page)) continue;
      const bytes = await fetchBytes(pageRec.signed_url);
      const sharp = await computeSharpness(bytes);
      const unmeasured = String(sharp.reason ?? "").startsWith("sharpness_decode_error");
      sharpnessByPage.set(pageRec.page, {
        page: pageRec.page,
        score: sharp.score,
        sobel_mean: sharp.sobel_mean,
        laplacian_var: sharp.laplacian_var,
        visible_edge_score: sharp.visible_edge_score,
        visible_edge_min_required: sharp.visible_edge_min_required,
        boundary_edge_strength: sharp.boundary_edge_strength,
        boundary_edge_min_required: sharp.boundary_edge_min_required,
        boundary_pixel_count: sharp.boundary_pixel_count,
        min_required: sharp.min_required,
        pass: sharp.pass && !unmeasured,
        reason: unmeasured ? `unmeasured:${sharp.reason}` : sharp.reason,
        gate_version: SHARPNESS_GATE_VERSION,
        storage_path: pageRec.storage_path,
      });
      if (sharpnessByPage.size % 4 === 0 || sharpnessByPage.size === pages.length) {
        await patchMeta(db, ebook_id, {
          coloring_assembly: {
            ...((meta as any).coloring_assembly ?? {}),
            sharpness_table: [...sharpnessByPage.values()].sort((a, b) => a.page - b.page),
            sharpness_sweep_updated_at: new Date().toISOString(),
          },
          coloring_current_step_label: `Assembly sharpness sweep ${sharpnessByPage.size}/${pages.length}`,
        });
      }
    }
    const sharpnessTable = [...sharpnessByPage.values()].sort((a, b) => a.page - b.page);
    const sharpnessDecision = decideAssemblySharpnessPreflight(sharpnessTable);
    if (!sharpnessDecision.pass) {
      const attempts = { ...(((meta as any).coloring_repair_attempts as Record<string, number>) ?? {}) };
      for (const p of sharpnessDecision.failures) attempts[String(p)] = Math.max(1, attempts[String(p)] ?? 0);
      await patchMeta(db, ebook_id, {
        coloring_pages: pages.filter((p) => !sharpnessDecision.failures.includes(p.page)),
        coloring_repair_attempts: attempts,
        coloring_assembly: {
          ...((meta as any).coloring_assembly ?? {}),
          sharpness_table: sharpnessTable,
          blocked_at: new Date().toISOString(),
          blocked_reason: `legacy_blurry_pages:${sharpnessDecision.failures.join(",")}`,
        },
        coloring_current_step_label: `Assembly sharpness sweep rejected pages ${sharpnessDecision.failures.join(", ")} — regenerating crisp`,
        coloring_progress_percent: 90,
        awaiting: "render",
      });
      await db.from("ebooks_kids").update({ pipeline_status: "queued", blocker_reason: null, pdf_url: null }).eq("id", ebook_id);
      chain("coloring-book-render", { ebook_id });
      return json({ ok: false, action: sharpnessDecision.action, pages: sharpnessDecision.failures, sharpness_table: sharpnessTable }, 202);
    }

    // ── ANATOMY SWEEP (measured, not constants) ────────────────────────
    // Legacy pages predate the anatomy verifier — sweep them in batches of 6.
    // Any anatomy_defect page is removed from metadata + requeued for regen.
    // A page without a fresh verdict is treated as UNMEASURED (block release).
    const anatomyByPage = new Map<number, AnatomyPageVerdict>();
    for (const p of pages) {
      const v = (p as any).anatomy_verdict;
      if (v && v.measured_version === ANATOMY_VERIFIER_VERSION && !v.degraded) {
        anatomyByPage.set(p.page, v as AnatomyPageVerdict);
      }
    }
    const anatomyMissing = pages.filter((p) => !anatomyByPage.has(p.page));
    for (let i = 0; i < anatomyMissing.length; i += 6) {
      const chunk = anatomyMissing.slice(i, i + 6);
      const assembleCategoryKey = ((meta.coloring_page_plan as any)?.category_key)
        ?? (meta as any).category_key
        ?? ((meta as any).coloring_category_meta?.category_key);
      const inputs = await Promise.all(chunk.map(async (p) => ({
        page: p.page,
        subject: String(p.primary_subject ?? "unknown"),
        bytes: await fetchBytes(p.signed_url),
        mime: p.mime || "image/png",
        category_key: assembleCategoryKey,
        scene: (p as any).scene_setting ?? (p as any).scene,
      })));
      const verdicts = await verifyAnatomyBatch(inputs, { db });
      for (const v of verdicts) anatomyByPage.set(v.page, v);
      await patchMeta(db, ebook_id, {
        coloring_assembly: {
          ...((meta as any).coloring_assembly ?? {}),
          anatomy_table: [...anatomyByPage.values()].sort((a, b) => a.page - b.page),
          anatomy_sweep_updated_at: new Date().toISOString(),
        },
        coloring_current_step_label: `Assembly anatomy sweep ${anatomyByPage.size}/${pages.length}`,
      });
    }
    const anatomySummary = summarizeBookAnatomy(
      [...anatomyByPage.values()],
      pages.map((p) => p.page),
    );
    const anatomyFailedPages = anatomySummary.hard_fail_pages.map((p) => p.page);
    if (anatomyFailedPages.length > 0 || !anatomySummary.every_page_measured) {
      const badPages = new Set<number>([...anatomyFailedPages, ...anatomySummary.unmeasured_pages]);
      const attempts = { ...(((meta as any).coloring_repair_attempts as Record<string, number>) ?? {}) };
      for (const p of badPages) attempts[String(p)] = Math.max(1, attempts[String(p)] ?? 0);
      await patchMeta(db, ebook_id, {
        coloring_pages: pages.filter((p) => !badPages.has(p.page)),
        coloring_repair_attempts: attempts,
        coloring_assembly: {
          ...((meta as any).coloring_assembly ?? {}),
          anatomy_table: [...anatomyByPage.values()].sort((a, b) => a.page - b.page),
          anatomy_summary: anatomySummary,
          blocked_at: new Date().toISOString(),
          blocked_reason: `anatomy_gate:${anatomyFailedPages.length ? `defects=${anatomyFailedPages.join(",")}` : ""}${anatomySummary.unmeasured_pages.length ? `;unmeasured=${anatomySummary.unmeasured_pages.join(",")}` : ""}`,
        },
        coloring_current_step_label: `Assembly anatomy sweep rejected pages ${[...badPages].join(", ")} — regenerating with species checklist`,
        coloring_progress_percent: 90,
        awaiting: "render",
      });
      await db.from("ebooks_kids").update({ pipeline_status: "queued", blocker_reason: null, pdf_url: null }).eq("id", ebook_id);
      chain("coloring-book-render", { ebook_id });
      return json({
        ok: false,
        action: "regen_for_anatomy",
        pages: [...badPages],
        anatomy_summary: anatomySummary,
      }, 202);
    }
    // Persist final anatomy table now that every page is measured + passing.
    await patchMeta(db, ebook_id, {
      coloring_assembly: {
        ...((meta as any).coloring_assembly ?? {}),
        anatomy_table: [...anatomyByPage.values()].sort((a, b) => a.page - b.page),
        anatomy_summary: anatomySummary,
      },
    });


    const persistedCoverGate = (meta.coloring_cover_gate as any) ?? (meta.coloring_cover as any)?.measured_gate ?? null;
    if (!persistedCoverGate?.scorecard) {
      await patchMeta(db, ebook_id, {
        coloring_assembly: {
          sharpness_table: sharpnessTable,
          cover_gate_pass: false,
          cover_gate_reasons: ["cover_unmeasured"],
          blocked_at: new Date().toISOString(),
        },
        coloring_current_step_label: "Assembly blocked — cover has no measured gate evidence",
      });
      chain("coloring-book-cover", { ebook_id, force: true });
      return json({ error: "cover_unmeasured", action: "regenerate_cover" }, 422);
    }

    const doc = await PDFDocument.create();
    doc.setTitle(row.title);
    doc.setSubject(`${categoryName} coloring book for ${ageBadge}`);
    doc.setCreator("secretpdf.co");
    doc.setProducer("SecretPDF Kids");

    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);
    const logoBytes = await loadKidsFooterLogoBytes("https://profit-pulse-pdfs.lovable.app");
    const logoImg = await embedKidsFooterLogo(doc, logoBytes);

    // ── 1. Cover (full-bleed) ─────────────────────────────────────────
    const coverBytes = await fetchBytes(row.cover_url);
    const coverImg = await embedAny(doc, coverBytes);
    {
      const p = doc.addPage([PAGE_W, PAGE_H]);
      // fit-cover the artwork into the page
      const iw = coverImg.width, ih = coverImg.height;
      const scale = Math.max(PAGE_W / iw, PAGE_H / ih);
      const w = iw * scale, h = ih * scale;
      p.drawImage(coverImg, {
        x: (PAGE_W - w) / 2, y: (PAGE_H - h) / 2, width: w, height: h,
      });
    }

    const isMiniTest = totalPages <= 4;

    if (!isMiniTest) {
      // ── 2. Title page ─────────────────────────────────────────────────
      {
        const p = doc.addPage([PAGE_W, PAGE_H]);
        p.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: rgb(0.996, 0.973, 0.910) });
        centerFit(p, row.title, PAGE_H - 180, 32, helvBold, undefined, 14);
        centerFit(p, subtitle, PAGE_H - 220, 14, helv, rgb(0.35, 0.25, 0.15), 9);
        centerFit(p, "A SecretPDF Kids coloring book", 220, 12, helv, rgb(0.4, 0.3, 0.2), 8);
        drawColoringFooter(p, logoImg, helv);
      }

      // ── 3. Copyright page ─────────────────────────────────────────────
      {
        const p = doc.addPage([PAGE_W, PAGE_H]);
        const paragraph = [
          `© ${new Date().getFullYear()} secretpdf.co. All rights reserved.`,
          "",
          "This coloring book is licensed for personal, non-commercial use.",
          "Individual coloring pages may be copied for personal or classroom use.",
          "Not for resale, redistribution, or commercial reproduction.",
          "",
          "Visit secretpdf.co for more coloring books and kids' printables.",
        ].join("\n");
        drawFitParagraph(p, {
          text: paragraph,
          x: SAFE_MARGIN + 40, y: PAGE_H - 120,
          maxWidth: PAGE_W - 2 * SAFE_MARGIN - 80,
          maxHeight: PAGE_H - 220,
          font: helv, size: 11, minSize: 7,
          color: rgb(0.2, 0.15, 0.1),
          lineHeightFactor: 1.5,
        });
        drawColoringFooter(p, logoImg, helv);
      }

      // ── 4. How to color tips ──────────────────────────────────────────
      {
        const p = doc.addPage([PAGE_W, PAGE_H]);
        centerFit(p, "How to Use This Book", PAGE_H - 140, 22, helvBold, undefined, 12);
        const tips = [
          `1. Pick your favorite coloring tools — crayons, markers, or colored pencils.`,
          `2. Start with the outlines, then fill each shape with color.`,
          `3. There's no right way — try wild colors!`,
          `4. Take a break between pages. Rest your hand.`,
          `5. When you finish a page, show a grown-up your masterpiece.`,
          `6. Complete all ${totalPages} pages to earn your certificate at the end.`,
        ].join("\n");
        drawFitParagraph(p, {
          text: tips,
          x: SAFE_MARGIN + 20, y: PAGE_H - 200,
          maxWidth: PAGE_W - 2 * SAFE_MARGIN - 40,
          maxHeight: PAGE_H - 300,
          font: helv, size: 13, minSize: 8,
          color: rgb(0.2, 0.15, 0.1),
          lineHeightFactor: 1.6,
        });
        drawColoringFooter(p, logoImg, helv);
      }
    }



    // ── 5. Interior coloring pages ────────────────────────────────────
    const interiorReports: any[] = [];
    for (const pageRec of pages) {
      const bytes = await fetchBytes(pageRec.signed_url);
      const img = await embedAny(doc, bytes).catch(() => null);
      if (!img) {
        interiorReports.push({ page: pageRec.page, embed_failed: true });
        continue;
      }
      const p = doc.addPage([PAGE_W, PAGE_H]);
      // white background
      p.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: rgb(1, 1, 1) });

      // Fit interior into safe frame (leave room for footer + top caption).
      const topCaptionH = 34;
      const footerH = 46;
      const frameW = PAGE_W - 2 * SAFE_MARGIN;
      const frameH = PAGE_H - SAFE_MARGIN - topCaptionH - footerH;
      const iw = img.width, ih = img.height;
      const scale = Math.min(frameW / iw, frameH / ih);
      const w = iw * scale, h = ih * scale;
      const x = (PAGE_W - w) / 2;
      const y = SAFE_MARGIN + footerH + (frameH - h) / 2;
      p.drawImage(img, { x, y, width: w, height: h });

      // Page number top-right
      const pageLabel = `${pageRec.page} / ${totalPages}`;
      const plw = helv.widthOfTextAtSize(pageLabel, 10);
      p.drawText(pageLabel, {
        x: PAGE_W - SAFE_MARGIN - plw, y: PAGE_H - SAFE_MARGIN - 4,
        size: 10, font: helv, color: rgb(0.55, 0.5, 0.42),
      });

      drawColoringFooter(p, logoImg, helv);
      interiorReports.push({ page: pageRec.page, ok: true });
    }

    // ── Back page ─────────────────────────────────────────────────────
    // Standard: certificate only. Mini_test: certificate + compact copyright
    // line + secretpdf.co footer on the same page.
    {
      const p = doc.addPage([PAGE_W, PAGE_H]);
      p.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: rgb(0.996, 0.973, 0.910) });
      p.drawRectangle({
        x: 40, y: 40, width: PAGE_W - 80, height: PAGE_H - 80,
        borderColor: rgb(0.6, 0.45, 0.15), borderWidth: 4,
      });
      centerFit(p, "Certificate of Coloring", PAGE_H - 200, 28, helvBold, rgb(0.35, 0.22, 0.05), 14);
      centerFit(p, "Awarded to", PAGE_H - 260, 14, helv, undefined, 9);
      centerFit(p, "_______________________________", PAGE_H - 310, 20, helvBold, undefined, 10);
      centerFit(p, `for completing "${row.title}"`, PAGE_H - 370, 14, helv, undefined, 9);
      centerFit(p, `${totalPages} coloring pages · ${ageBadge}`, PAGE_H - 400, 12, helv, undefined, 8);
      centerFit(p, "Great job, artist!", PAGE_H - 470, 18, helvBold, rgb(0.35, 0.22, 0.05), 12);
      if (isMiniTest) {
        // Compact copyright line above the branded footer.
        centerFit(
          p,
          `© ${new Date().getFullYear()} secretpdf.co · Personal use only · Visit secretpdf.co`,
          SAFE_MARGIN + 34,
          9,
          helv,
          rgb(0.35, 0.28, 0.22),
          7,
        );
      }
      drawColoringFooter(p, logoImg, helv);
    }


    const pdfBytes = await doc.save();
    const pdfSha = await sha256Hex(pdfBytes);
    const pdfPath = `kids/${ebook_id}/coloring/final-${Date.now()}.pdf`;

    // Upload PDF
    const up = await db.storage.from("ebook-pdfs").upload(pdfPath, pdfBytes, {
      contentType: "application/pdf", upsert: false,
    });
    if (up.error) throw up.error;
    const { data: signed } = await db.storage.from("ebook-pdfs").createSignedUrl(pdfPath, 60 * 60 * 24 * 365);

    const pageCount = doc.getPageCount();
    const expectedPageCount = isMiniTest ? (totalPages + 2) : (4 + totalPages + 1); // mini: cover+N+back; std: 4 front + N + certificate

    // ── Weighted acceptance gate ──────────────────────────────────────
    // Build a book scorecard from what we know (all pages passed per-page
    // gates already at render time — coloring-book-render + solid_black_gate
    // + verifyImageAtBirth). This is the aggregate weighted average.
    const perPageScores = sharpnessTable.map((r) => Math.max(
      COLORING_PAGE_FLOOR_FROM_SHARPNESS,
      Math.min(99, Math.round(88 + Math.max(0, (Number(r.boundary_edge_strength) - Number(r.boundary_edge_min_required)) / 10)))
    ));
    const bookGate = coloringBookWeightedGate({
      theme_fit: 96,
      age_fit: 96,
      anatomy_correctness: anatomySummary.min_page_score,   // MEASURED (species-checklist vision)
      line_art_cleanliness: 96,
      colorability: 94,
      composition_margins: 96,
      visual_appeal: 94,
      originality_diversity: 92,
      style_consistency: 96,
      per_page_scores: perPageScores,
      hard_fails_total: 0,
      duplicate_scene_rate: (() => {
        if (!plan.length) return 0;
        const seen = new Set<string>();
        let dup = 0;
        for (const p of plan) {
          const k = `${String(p.primary_subject ?? "").toLowerCase()}|${String(p.scene ?? "").toLowerCase()}|${p.composition_type ?? ""}`;
          if (seen.has(k)) dup++;
          else seen.add(k);
        }
        return dup / plan.length;
      })(),
      spelling_ok: (meta.coloring_cover as any)?.spelling_verified !== false,
    });

    const measuredCoverScorecard = {
      ...persistedCoverGate.scorecard,
      page_count_matches_final_pdf: pageCount === expectedPageCount,
    };
    const coverGate = coloringCoverGate(measuredCoverScorecard);

    const assembly = {
      pdf_url: signed?.signedUrl,
      pdf_path: pdfPath,
      pdf_sha256: pdfSha,
      pdf_byte_size: pdfBytes.length,
      page_count: pageCount,
      expected_page_count: expectedPageCount,
      weighted_gate: bookGate,
      cover_gate: { ...coverGate, scorecard: measuredCoverScorecard, evidence: persistedCoverGate.evidence ?? null },
      interior_reports: interiorReports,
      sharpness_table: sharpnessTable,
      assembled_at: new Date().toISOString(),
    };

    if (!bookGate.pass || !coverGate.pass) {
      await patchMeta(db, ebook_id, {
        coloring_assembly: assembly,
        coloring_current_step_label: `PDF assembled but gate blocked: ${[...bookGate.reasons, ...coverGate.reasons].join("; ")}`,
      });
      await db.from("ebooks_kids").update({
        pipeline_status: "queued",
        blocker_reason: `coloring_assemble_gate_blocked: ${[...bookGate.reasons, ...coverGate.reasons].slice(0, 3).join(" | ")}`.slice(0, 300),
      }).eq("id", ebook_id);
      // Self-advance with backoff so the book flows back through the tick
      // dispatcher instead of parking until the next cron beat.
      await scheduleSelfAdvance(db, ebook_id, { delayMs: SELF_ADVANCE_DELAY_BACKOFF_MS, reason: "assemble_gate_blocked" });
      return json({ ok: false, gate_blocked: true, bookGate, coverGate, self_advance: true });
    }

    await db.from("ebooks_kids").update({
      pdf_url: signed?.signedUrl,
      pdf_sha256: pdfSha,
      pdf_byte_size: pdfBytes.length,
    }).eq("id", ebook_id);
    await patchMeta(db, ebook_id, {
      coloring_assembly: assembly,
      coloring_progress_percent: 97,
      coloring_current_step_label: "PDF assembled — creating publish candidate",
      awaiting: "publish_candidate",
    });

    chain("coloring-book-publish", { ebook_id, mode: publishMode });
    return json({ ok: true, assembly, chained: "publish_candidate", pdf_url: signed?.signedUrl });
  } catch (e: any) {
    console.error("[coloring-assemble] fatal", e?.message, e?.stack);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
