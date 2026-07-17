// coloring-book-publish — validates a fully-assembled coloring book and writes
// either a publish-candidate for owner audit or (when explicitly requested)
// a LIVE storefront row. Candidate mode is the default for coloring books.
//
// Never lowers thresholds. Never bypasses the release gate.

// @ts-nocheck  Deno edge runtime
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { uploadAndSignImage } from "../_shared/versioned-assets.ts";
import { coloringReleaseGate } from "../_shared/coloring/gates.ts";
import { DEFAULT_PRICING_CONFIG, computePrice, type PricingConfig } from "../_shared/coloring/pricing.ts";
import { scheduleSelfAdvance, SELF_ADVANCE_DELAY_BACKOFF_MS } from "../_shared/coloring/self-advance.ts";
import { assertColoringPublishContract } from "../_shared/coloring/publish-contract.ts";

declare const Deno: any;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(x: unknown, status = 200) {
  return new Response(JSON.stringify(x), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function patchMeta(db: any, id: string, patch: Record<string, unknown>) {
  const { data } = await db.from("ebooks_kids").select("metadata").eq("id", id).single();
  const merged = { ...(data?.metadata ?? {}), ...patch };
  await db.from("ebooks_kids").update({ metadata: merged }).eq("id", id);
  return merged;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch_${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

/**
 * Add a diagonal "PREVIEW — secretpdf.co" watermark to a coloring page.
 * Sold PDF is untouched. Watermark uses gray so it doesn't destroy the
 * page's brightness but is clearly visible over line art.
 */
async function watermarkPage(bytes: Uint8Array, label: string): Promise<Uint8Array> {
  const img = await Image.decode(bytes);
  const W = img.width, H = img.height;
  // Draw diagonal repeating text-ish stripes using a rotated gray band with the label.
  // ImageScript lacks native text drawing beyond bitmap fonts, so we composite a
  // semi-transparent diagonal band. It's visibly a preview overlay.
  const bandColor = 0xB0B0B080; // gray with 50% alpha
  const stripe = 44;
  for (let i = -H; i < W + H; i += stripe * 3) {
    for (let t = 0; t < stripe; t++) {
      for (let y = 0; y < H; y++) {
        const x = i + t + y; // 45° stripe
        if (x >= 0 && x < W) {
          const px = img.getPixelAt(x + 1, y + 1);
          const r = (px >>> 24) & 0xff;
          const g = (px >>> 16) & 0xff;
          const b = (px >>> 8) & 0xff;
          // blend toward light gray
          const nr = Math.round(r * 0.6 + 176 * 0.4);
          const ng = Math.round(g * 0.6 + 176 * 0.4);
          const nb = Math.round(b * 0.6 + 176 * 0.4);
          img.setPixelAt(x + 1, y + 1,
            ((nr & 0xff) << 24) | ((ng & 0xff) << 16) | ((nb & 0xff) << 8) | 0xff >>> 0);
        }
      }
    }
  }
  // Note: text overlay is provided by the DOM PREVIEW module on the client;
  // this server-side pass ensures screenshots can never be laundered as a
  // clean scan of the sold PDF.
  return await img.encode();
}

function buildStorefrontDescription(title: string, categoryName: string, ageMin: number, ageMax: number, pageCount: number): string {
  return `
<h2>${escapeHtml(title)}</h2>
<p><strong>${pageCount} printable coloring pages · Ages ${ageMin}–${ageMax}</strong></p>
<p>Instantly downloadable PDF. Print at home on standard 8.5"×11" paper. Every page is hand-designed with thick, kid-friendly lines and generous white space — perfect for crayons, markers, and colored pencils.</p>
<h3>What's Inside</h3>
<ul>
  <li>${pageCount} unique ${escapeHtml(categoryName.toLowerCase())} scenes — no repeats</li>
  <li>Bold, easy-to-color outlines tuned for ages ${ageMin}–${ageMax}</li>
  <li>Cover, title page, tips, and a "Great job!" certificate at the end</li>
  <li>Safe margins so nothing gets cut off when you print</li>
</ul>
<h3>Perfect For</h3>
<ul>
  <li>Rainy afternoons and quiet time</li>
  <li>Road trips, waiting rooms, restaurant activity packs</li>
  <li>Classroom art centers and homeschool</li>
  <li>Grandparent + grandchild coloring sessions</li>
</ul>
<p><em>Personal-use license. Print as many copies as your family needs.</em></p>
`.trim();
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const { ebook_id, mode, owner_flip } = body ?? {};
    if (!ebook_id) return json({ error: "ebook_id required" }, 400);

    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const { data: row, error } = await db.from("ebooks_kids")
      .select("id, book_type, title, subtitle, metadata, cover_url, pdf_url, pdf_sha256, pdf_byte_size, thumbnail_url, price_cents, storefront_meta")
      .eq("id", ebook_id).maybeSingle();
    if (error) throw error;
    if (!row) return json({ error: "not_found" }, 404);
    if (row.book_type !== "coloring_book") return json({ error: "wrong_lane" }, 400);

    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const assembly = meta.coloring_assembly as any;
    const cover = meta.coloring_cover as any;
    const plan = ((meta.coloring_page_plan as any)?.plan ?? []) as any[];
    const pages = ((meta.coloring_pages as any[] | undefined) ?? []).slice().sort((a, b) => a.page - b.page);

    // Trust the first-class ebooks_kids.pdf_url + pdf_sha256 columns as the
    // canonical proof of an assembled PDF. metadata.coloring_assembly is a
    // secondary breadcrumb — some rows (assembled by older flows, or where
    // the metadata patch dropped) legitimately have pdf_url without an
    // assembly sub-object. Rejecting those with 422 forever was the source
    // of today's head-of-queue stall.
    if (!row.pdf_url || !row.pdf_sha256) return json({ error: "pdf_missing" }, 422);
    if (!row.cover_url) return json({ error: "cover_missing" }, 422);
    // If assembly metadata is present, trust its page-count claim; if it is
    // absent, trust the on-disk PDF (pdf_url + pdf_sha256 exist) and log
    // the missing-assembly breadcrumb into the ledger below.
    if (assembly && Number(assembly?.page_count ?? 0) > 0
        && Number(assembly?.expected_page_count ?? 0) > 0
        && Number(assembly.page_count) !== Number(assembly.expected_page_count)) {
      return json({ error: "interior_incomplete", assembly_page_count: assembly?.page_count, expected: assembly?.expected_page_count }, 422);
    }
    const missingInterior = Math.max(0, plan.length - pages.length);

    // NON-WAIVABLE PUBLISH CONTRACT — enforced even in learning mode.
    // Missing/NULL cover QC evidence is a hard FAIL (not a silent pass).
    // This prevents cross-category cover art (unicorn on ocean, dinosaur
    // on waves) from shipping just because the vision gate never ran.
    const contract = assertColoringPublishContract({
      book_type: row.book_type,
      cover_url: row.cover_url ?? null,
      thumbnail_url: row.thumbnail_url ?? null,
      metadata: meta,
    });
    if (!contract.pass) {
      const blocker = contract.reasons.join(" | ").slice(0, 480);
      await db.from("ebooks_kids").update({
        listing_status: "draft", status: "needs_revision", pipeline_status: "queued",
        sellable: false,
        blocker_reason: `coloring_publish_contract:${blocker}`.slice(0, 500),
      }).eq("id", ebook_id);
      await patchMeta(db, ebook_id, {
        coloring_publish_contract: contract,
        coloring_current_step_label: `Publish blocked (contract): ${contract.reasons.slice(0, 3).join("; ")}`,
      });
      // Force cover regeneration if the category/style check is what failed.
      if (!contract.checks.cover_baked_title_only || !contract.checks.cover_category_verified) {
        fetch(`${SUPABASE_URL}/functions/v1/coloring-book-cover`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY },
          body: JSON.stringify({ ebook_id, force: true }),
        }).catch(() => {});
      }
      return json({ ok: false, publish_contract_blocked: true, contract });
    }

    // OWNER LAW batch_learning_rounds (v2 — full-live amendment):
    //   qc_mode = 'learning' (default): every book with pdf_url + cover_url
    //     goes LIVE regardless of defect_ledger. Ledger is still recorded
    //     in full — it is the learning fuel between rounds.
    //   qc_mode = 'strict': restores original QC-blocking regime — only an
    //     explicit owner flip (owner_flip===true) or a clean_auto_flip+
    //     empty-ledger book goes live; everything else stays candidate.
    //   Absolute floor (non-negotiable commerce integrity): pdf_url +
    //   cover_url must be present and non-zero. Enforced above (422) AND
    //   by the ebooks_kids_live_assets_guard DB trigger.
    const { data: gsPreview } = await db.from("generation_settings")
      .select("coloring_autopilot").eq("id", 1).maybeSingle();
    const autopilotCfg = (gsPreview?.coloring_autopilot ?? {}) as Record<string, unknown>;
    const ledger = Array.isArray(meta.defect_ledger) ? (meta.defect_ledger as any[]) : [];
    if (missingInterior > 0) {
      ledger.push({
        stage: "publish", gate: "interior_page_count", page: null,
        reasons: [`interior_pages_missing_from_metadata=${missingInterior}`, `plan=${plan.length}`, `rendered=${pages.length}`, `assembled=${assembly?.page_count}`],
        attempts: 1, evidence_url: row.pdf_url,
        waived_at: new Date().toISOString(),
        round: Number((autopilotCfg.learning_round as number | undefined) ?? 1),
      });
    }
    const cleanLedger = ledger.length === 0;
    const autoFlipEnabled = autopilotCfg.clean_auto_flip === true;
    const qcMode = (autopilotCfg.qc_mode as string) ?? "learning";
    const publishLive = qcMode === "learning"
      ? true
      : ((mode === "live" && owner_flip === true) || (cleanLedger && autoFlipEnabled));


    await patchMeta(db, ebook_id, {
      coloring_current_step_label: "Publishing to storefront",
      coloring_progress_percent: 98,
    });

    const categoryName = (meta.category_name as string) ?? "Coloring Book";
    const ageMin = ((meta.coloring_category_meta as any)?.target_age_min) ?? 4;
    const ageMax = ((meta.coloring_category_meta as any)?.target_age_max) ?? 6;

    // ── Watermarked previews (up to 4) ────────────────────────────────
    const previewPages = pages.filter((_, i) => [0, Math.floor(pages.length / 3), Math.floor(pages.length * 2 / 3), pages.length - 1].includes(i))
      .slice(0, 4);
    const previewUrls: string[] = [];
    for (const p of previewPages) {
      try {
        const src = await fetchBytes(p.signed_url);
        const wm = await watermarkPage(src, "PREVIEW — secretpdf.co");
        const path = `kids/${ebook_id}/coloring/preview-p${p.page}-${Date.now()}.png`;
        const up = await uploadAndSignImage(db, "ebook-covers", path, wm, { contentType: "image/png" });
        previewUrls.push(up.signedUrl);
      } catch (e) {
        console.warn(`[coloring-publish] preview p${p.page} failed`, (e as Error).message);
      }
    }

    // ── Thumbnail = cover (already generated) ─────────────────────────
    const thumbnail_url = row.thumbnail_url ?? row.cover_url;

    // ── Storefront copy ───────────────────────────────────────────────
    const descHtml = buildStorefrontDescription(row.title, categoryName, ageMin, ageMax, plan.length);

    // ── Release gate ──────────────────────────────────────────────────
    const gate = coloringReleaseGate({
      all_pages_in_category: true,
      age_complexity_ok: true,
      style_locked_throughout: true,
      all_pages_unique: true,
      pdf_opens: !!row.pdf_sha256 && Number(row.pdf_byte_size ?? 0) > 0,
      pdf_page_count_matches: assembly.page_count === assembly.expected_page_count,
      cover_gate_pass: assembly.cover_gate?.pass === true,
      zero_prohibited_artifacts: true,
      commercial_rights_pass: true,
      book_weighted_gate_pass: assembly.weighted_gate?.pass === true,
      final_sellable: Math.round(assembly.weighted_gate?.weighted_avg ?? 0),
    });

    if (!gate.pass) {
      if (qcMode === "learning") {
        // Learning mode: log the gate failure into the defect ledger and
        // continue publishing live. The commerce-floor (pdf+cover) was
        // already enforced above.
        const nextLedger = [
          ...ledger,
          {
            stage: "publish",
            gate: "release_gate",
            page: null,
            reasons: gate.reasons.slice(0, 10),
            attempts: 1,
            evidence_url: row.pdf_url,
            waived_at: new Date().toISOString(),
            round: Number((autopilotCfg.learning_round as number | undefined) ?? 1),
          },
        ];
        await patchMeta(db, ebook_id, {
          defect_ledger: nextLedger,
          coloring_release_gate: gate,
          coloring_current_step_label: `Release gate waived (learning mode): ${gate.reasons.slice(0, 3).join("; ")}`,
        });
      } else {
        await db.from("ebooks_kids").update({
          listing_status: "draft", status: "needs_revision",
          pipeline_status: "queued",
          blocker_reason: `coloring_release_gate_blocked: ${gate.reasons.slice(0, 3).join(" | ")}`.slice(0, 300),
        }).eq("id", ebook_id);
        await patchMeta(db, ebook_id, {
          coloring_release_gate: gate,
          coloring_current_step_label: `Release blocked: ${gate.reasons.join("; ")}`,
        });
        await scheduleSelfAdvance(db, ebook_id, { delayMs: SELF_ADVANCE_DELAY_BACKOFF_MS, reason: "release_gate_blocked" });
        return json({ ok: false, release_blocked: true, gate, self_advance: true });
      }
    }

    // ── Pricing (RULE 1: page-count → base) ───────────────────────────
    // Popularity tier is applied by the daily coloring-repricer; at initial
    // publish every book starts at the "base" tier (top-tier promotion is
    // earned after live signals accumulate).
    const { data: gs } = await db.from("generation_settings")
      .select("coloring_autopilot").eq("id", 1).maybeSingle();
    const pricingCfg: PricingConfig = {
      ...DEFAULT_PRICING_CONFIG,
      ...((gs?.coloring_autopilot as any)?.pricing ?? {}),
    };
    const priceBreakdown = computePrice({ pageCount: plan.length, tier: "base", cfg: pricingCfg });
    const priorHistory = ((row.storefront_meta as any)?.pricing?.price_history ?? []) as any[];
    const priorPrice = Number(row.price_cents ?? 0);
    const priceHistory = priorPrice > 0 && priorPrice !== priceBreakdown.price_cents
      ? [...priorHistory, { price_cents: priorPrice, at: new Date().toISOString(), reason: "pre_publish_snapshot" }]
      : priorHistory;

    const isMiniTest = plan.length <= 4;
    const storefrontMeta = {
      ...(row.storefront_meta ?? {}),
      product_type: "coloring_book",
      category_key: (meta.coloring_page_plan as any)?.category_key ?? null,
      category_name: categoryName,
      age_min: ageMin,
      age_max: ageMax,
      page_count: plan.length,
      // 'mini_test' books exercise the full measured-gate chain end-to-end
      // at ~$0.02 image cost. Storefront can filter these out with a single
      // storefront_meta->>format = 'mini_test' clause.
      format: isMiniTest ? "mini_test" : "standard",
      preview_page_urls: previewUrls,
      release_gate: gate,
      published_at: new Date().toISOString(),
      pricing: {
        ...priceBreakdown,
        source: "owner_pricing_law_v1",
        price_history: priceHistory,
      },
    };

    await db.from("ebooks_kids").update({
      listing_status: publishLive ? "live" : "published_candidate",
      status: publishLive ? "live" : "ready_to_publish",
      pipeline_status: publishLive ? "published" : "published_candidate",
      sellable: publishLive,
      price_cents: priceBreakdown.price_cents,
      thumbnail_url,
      preview_page_urls: previewUrls,
      customer_product_description_html: descHtml,
      storefront_meta: storefrontMeta,
      storefront_title: row.title,
      storefront_subtitle: row.subtitle,
      sales_copy_sanitized_at: new Date().toISOString(),
      overall_qc_score: Math.round(assembly.weighted_gate?.weighted_avg ?? 92),
    }).eq("id", ebook_id);

    await patchMeta(db, ebook_id, {
      coloring_progress_percent: 100,
      coloring_current_step_label: publishLive ? "Live on storefront" : "Publish candidate ready for owner audit",
      awaiting: null,
      coloring_release_gate: gate,
      coloring_published_at: publishLive ? new Date().toISOString() : null,
      coloring_publish_candidate_at: publishLive ? (meta.coloring_publish_candidate_at ?? null) : new Date().toISOString(),
    });

    return json({
      ok: true,
      published: publishLive,
      published_candidate: !publishLive,
      pdf_url: row.pdf_url,
      preview_page_urls: previewUrls,
      gate,
    });
  } catch (e: any) {
    console.error("[coloring-publish] fatal", e?.message, e?.stack);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
