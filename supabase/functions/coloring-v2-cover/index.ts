// Coloring cover — Illustrated-Only lane.
//
// OWNER LAW `cover_illustrated_only_v12` (2026-07-23, PERMANENT):
//   Coloring-book covers MUST be fully painted illustrations where the
//   title is HAND-LETTERED as part of the artwork by the image model.
//   Deterministic SVG/font typography is FORBIDDEN on the coloring lane.
//
//   Provider ladder (smart-AI only, no Lovable gateway):
//     1. Gemini 2.5 Flash Image (google direct)
//     2. OpenAI gpt-image-1 (direct)
//
//   Sticky short-circuit: if ANY existing cover_final asset for the book
//   was produced by an illustrated law (`cover_illustrated_hand_lettered_once_v1`
//   OR `cover_illustrated_only_v12`), it is re-approved and the stage
//   advances to QC. Repair sweeps can never overwrite an owner-approved
//   hand-lettered cover.
//
//   Retry cap: 3 dispatches. On exhaustion, park + raise dashboard alert.
//
// @ts-nocheck
import { advance, corsHeaders, db, fetchBook, fireStage, json, recordError, signedUrl, uploadAsset } from "../_shared/coloring-v2/state.ts";
import { geminiDirectImageWithMeta } from "../_shared/gemini-direct.ts";
import { openaiDirectImage } from "../_shared/openai-direct.ts";

declare const Deno: any;

const GEMINI_IMAGE_MODEL = "google/gemini-2.5-flash-image";
const OPENAI_IMAGE_MODEL = "gpt-image-1";
const BAKE_ATTEMPTS = 3;
const COVER_HARD_ATTEMPT_CAP = 3;
const COVER_LAW = "cover_illustrated_only_v12";
const STICKY_LAWS = new Set([
  "cover_illustrated_hand_lettered_once_v1",
  "cover_illustrated_only_v12",
]);

type CoverProvider = "gemini" | "openai";

async function logProvider(book_id: string, provider: string, model: string, purpose: string, success: boolean, err: string | null, latency_ms: number) {
  try {
    await db().from("coloring_v2_provider_calls").insert({
      book_id, provider, model, purpose,
      prompt_version: COVER_LAW,
      success, error_message: err?.slice(0, 500) ?? null, latency_ms,
    });
  } catch (_) { /* best-effort */ }
}

function ensureColoringBookInTitle(t: string): string {
  const s = (t ?? "").trim();
  if (!s) return "Coloring Book";
  return /coloring/i.test(s) ? s : `${s} Coloring Book`;
}

// Subject-aware scene clause — mirrors the illustrated-cover-once helper so
// the cover matches the actual interior subject matter (unicorns vs oceans
// vs dinos etc.) rather than defaulting to any single theme.
async function buildSceneClause(book_id: string, title: string): Promise<string> {
  try {
    const c = db();
    const { data: concept } = await c.from("coloring_v2_assets")
      .select("meta").eq("book_id", book_id).eq("kind", "concept")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    const heroes: string[] = Array.isArray(concept?.meta?.hero_subjects) ? concept.meta.hero_subjects.slice(0, 3) : [];
    const motifs: string[] = Array.isArray(concept?.meta?.motif_inventory) ? concept.meta.motif_inventory.slice(0, 6) : [];
    if (heroes.length) {
      const heroText = heroes.join("; ");
      const motifText = motifs.length ? ` Motifs to include: ${motifs.join(", ")}.` : "";
      return `Depict a charming scene featuring: ${heroText}. Polished, print-ready art.${motifText}`;
    }
  } catch (_) { /* fall through */ }
  const t = title.toLowerCase();
  if (/unicorn/.test(t)) return "Depict charming cartoon unicorns — each with FOUR legs, ONE horn, ONE tail, correct proportions — playing among stars, rainbows, and sparkles. Every unicorn anatomically complete and non-deformed.";
  if (/dragon/.test(t)) return "Depict charming cartoon dragons — each with 4 legs, 2 wings, 1 tail — playing among clouds and treasure.";
  if (/mermaid/.test(t)) return "Depict charming cartoon mermaids — each with 2 arms, 1 tail-fin, complete anatomy — playing among coral and bubbles.";
  if (/ocean|sea|fish|bubbly/.test(t)) return "Depict charming cartoon ocean creatures (fish, octopus, turtle, dolphins) among coral and kelp — each anatomically complete.";
  if (/dino/.test(t)) return "Depict charming cartoon dinosaurs — each anatomically complete — playing among volcanoes and ferns.";
  if (/farm|woodland|forest/.test(t)) return "Depict charming cartoon farm and woodland animals — each anatomically complete — in a cheerful meadow.";
  return "Depict charming cartoon subjects from the book, each anatomically complete and non-deformed, in a playful storybook scene.";
}

function buildIllustratedPrompt(title: string, sceneClause: string): string {
  return [
    `Beautiful full-color hand-painted children's coloring-book COVER illustration for "${title}".`,
    `Square 1:1 composition, warm cheerful storybook style — premium picture-book cover, gouache + watercolor feel, expressive, playful, high production value.`,
    sceneClause,
    `Every creature/character MUST be anatomically complete and non-deformed: correct number of legs, one head, one tail, complete limbs, no severed or floating body parts, no fused bodies, no extra heads, no missing features. Canonical proportions.`,
    `The title "${title}" MUST appear as HAND-LETTERED PAINTED TYPOGRAPHY integrated INTO the artwork itself — drawn by the illustrator as part of the painting (bubble-letter or brushed-script style, playful, colorful, with soft shadow and highlight painted in). NOT a font overlay, NOT flat digital text — it must look painted by hand.`,
    `Place the title in the upper third of the cover, arced or on a soft painted ribbon that is part of the scene.`,
    `Do NOT include: any logo, any watermark, any URL, any age badge, any subtitle, any extra text besides the title, any UI element, any book mockup, any border/frame.`,
    `Spelling of the title MUST be exact.`,
  ].join(" ");
}

async function renderIllustratedCover(prompt: string, attempt: number, book_id: string): Promise<{ bytes: Uint8Array; provider: CoverProvider; model: string }> {
  {
    const t0 = Date.now();
    try {
      const { bytes, meta } = await geminiDirectImageWithMeta({
        prompt,
        referenceUrls: [],
        model: GEMINI_IMAGE_MODEL,
      });
      if (bytes && bytes.length > 20_000) {
        await logProvider(book_id, meta.provider, meta.model, `cover_illustrated_a${attempt}_gemini`, true, null, Date.now() - t0);
        return { bytes, provider: "gemini", model: meta.model };
      }
      await logProvider(book_id, meta.provider, meta.model, `cover_illustrated_a${attempt}_gemini`, false, `empty_bytes:${meta.finishReason ?? meta.blockReason ?? "no_image"}`, Date.now() - t0);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      await logProvider(book_id, "google_direct", GEMINI_IMAGE_MODEL, `cover_illustrated_a${attempt}_gemini`, false, msg, Date.now() - t0);
      console.warn(`[coloring-v2-cover] gemini failed: ${msg.slice(0, 300)}`);
    }
  }
  {
    const t0 = Date.now();
    try {
      const { bytes } = await openaiDirectImage({
        prompt,
        model: OPENAI_IMAGE_MODEL,
        size: "1024x1024",
        quality: "high",
      });
      if (bytes && bytes.length > 20_000) {
        await logProvider(book_id, "openai_direct", OPENAI_IMAGE_MODEL, `cover_illustrated_a${attempt}_openai`, true, null, Date.now() - t0);
        return { bytes, provider: "openai", model: OPENAI_IMAGE_MODEL };
      }
      await logProvider(book_id, "openai_direct", OPENAI_IMAGE_MODEL, `cover_illustrated_a${attempt}_openai`, false, "empty_bytes", Date.now() - t0);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      await logProvider(book_id, "openai_direct", OPENAI_IMAGE_MODEL, `cover_illustrated_a${attempt}_openai`, false, msg, Date.now() - t0);
      console.warn(`[coloring-v2-cover] openai-image failed: ${msg.slice(0, 300)}`);
    }
  }
  throw new Error("cover_smart_ai_unavailable:gemini_and_openai_both_failed");
}

function isProviderBillingError(msg: string): boolean {
  const s = (msg ?? "").toLowerCase();
  return /billing|quota|credit|exhaust|insufficient|payment required|402|429|prepayment/.test(s);
}

async function raiseCoverAlert(book_id: string, title: string, reason: string, dispatchCount: number) {
  const billing = isProviderBillingError(reason);
  const alert_class = billing ? "provider_blocked" : "unbounded_retry";
  const dedupe_key = `cover_${alert_class}_${book_id}`;
  const alertTitle = billing
    ? `Provider billing block active: gemini+openai (cover ${book_id.slice(0, 8)})`
    : `Illustrated cover exceeded ${COVER_HARD_ATTEMPT_CAP} attempts for ${book_id.slice(0, 8)}`;
  const body = billing
    ? `Cover for "${title}" cannot generate — both smart-AI providers refused.\n• Book ${book_id.slice(0, 8)} parked at stage=failed after ${dispatchCount} dispatches.\n• Reason: ${reason.slice(0, 300)}`
    : `Cover for "${title}" rejected ${dispatchCount} times.\n• Last reason: ${reason.slice(0, 300)}`;
  try {
    await db().from("alert_log").upsert({
      alert_class, severity: "critical",
      title: alertTitle, body,
      evidence: { book_id, title, reason: reason.slice(0, 500), dispatchCount, law: COVER_LAW },
      dedupe_key,
    }, { onConflict: "dedupe_key" });
  } catch (_) { /* best-effort */ }
}

async function parkCoverAsFailed(book_id: string, reason: string) {
  try {
    await db().from("coloring_v2_books")
      .update({
        stage: "failed",
        stage_updated_at: new Date().toISOString(),
        last_error: `${COVER_LAW}: ${reason.slice(0, 400)}`,
        generation_status: "failed",
      })
      .eq("id", book_id);
  } catch (_) { /* best-effort */ }
}

// Sticky short-circuit: find any existing hand-lettered illustrated cover
// asset for this book (regardless of what approved_cover_asset_id currently
// points to). If found, re-approve and advance to QC.
async function findStickyIllustratedCover(book_id: string) {
  const { data } = await db().from("coloring_v2_assets")
    .select("id, meta, kind, created_at")
    .eq("book_id", book_id).eq("kind", "cover_final")
    .order("created_at", { ascending: false }).limit(20);
  const rows = data ?? [];
  return rows.find((r: any) => r?.meta?.law && STICKY_LAWS.has(String(r.meta.law))) ?? null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  const { book_id } = await req.json().catch(() => ({}));
  if (!book_id) return json({ error: "book_id required" }, 400);
  try {
    const book = await fetchBook(book_id);
    if (book.stage !== "cover") return json({ ok: true, skipped: true, stage: book.stage });

    // Sticky illustrated-cover short-circuit — defense in depth.
    const sticky = await findStickyIllustratedCover(book_id);
    if (sticky) {
      if (book.approved_cover_asset_id !== sticky.id) {
        await db().from("coloring_v2_books")
          .update({ approved_cover_asset_id: sticky.id }).eq("id", book_id);
      }
      await advance(book_id, "cover", "qc");
      await fireStage("coloring-v2-qc", { book_id });
      return json({ ok: true, skipped: true, reason: "illustrated_cover_preserved", sticky_asset: sticky.id, next: "qc" });
    }

    const priorAttempts = Number(book.stage_attempt_count ?? 0);
    if (priorAttempts >= COVER_HARD_ATTEMPT_CAP) {
      const reason = book.last_error ?? "cover_attempts_exhausted";
      await parkCoverAsFailed(book_id, reason);
      await raiseCoverAlert(book_id, book.title ?? "Untitled", reason, priorAttempts);
      return json({ ok: false, parked: true, reason: COVER_LAW, attempts: priorAttempts }, 200);
    }

    const rawTitle = book.title ?? "Untitled";
    const title = ensureColoringBookInTitle(rawTitle);
    if (title !== rawTitle) {
      await db().from("coloring_v2_books").update({ title }).eq("id", book_id);
    }

    const sceneClause = await buildSceneClause(book_id, title);
    const prompt = buildIllustratedPrompt(title, sceneClause);

    let bytes: Uint8Array | null = null;
    let usedProvider: CoverProvider | null = null;
    let usedModel = "";
    let lastErr: any = null;
    let smartAiUnavailableCount = 0;

    for (let attempt = 1; attempt <= BAKE_ATTEMPTS; attempt++) {
      try {
        const r = await renderIllustratedCover(prompt, attempt, book_id);
        if (r.bytes && r.bytes.length > 20_000) {
          bytes = r.bytes;
          usedProvider = r.provider;
          usedModel = r.model;
          break;
        }
      } catch (e: any) {
        lastErr = e;
        const em = String(e?.message ?? e);
        if (/cover_smart_ai_unavailable|billing|quota|prepayment|credit|402|429/i.test(em)) smartAiUnavailableCount++;
        console.warn(`[coloring-v2-cover] attempt ${attempt} error:`, em);
      }
    }

    if (!bytes && smartAiUnavailableCount >= BAKE_ATTEMPTS) {
      const reason = String(lastErr?.message ?? "cover_smart_ai_unavailable");
      await parkCoverAsFailed(book_id, reason);
      await raiseCoverAlert(book_id, title, reason, priorAttempts + 1);
      return json({ ok: false, parked: true, reason: "smart_ai_billing_locked", provider_error: reason }, 200);
    }

    if (!bytes) {
      const reason = String(lastErr?.message ?? "unknown");
      const nextAttempt = priorAttempts + 1;
      if (nextAttempt >= COVER_HARD_ATTEMPT_CAP) {
        await parkCoverAsFailed(book_id, reason);
        await raiseCoverAlert(book_id, title, reason, nextAttempt);
      }
      throw new Error(`cover_illustrated_hard_reject_after_${BAKE_ATTEMPTS}_attempts:${reason}`);
    }

    // Upload as PNG (both providers return PNG bytes).
    const asset = await uploadAsset(book_id, "cover_final", bytes, "png", {
      law: COVER_LAW,
      text_mode: "illustrated_hand_lettered_baked",
      typography_source: "illustrated_hand_lettered_baked",
      provider: usedProvider,
      model: usedModel,
      prompt_len: prompt.length,
    });
    await db().from("coloring_v2_books").update({ approved_cover_asset_id: asset.id }).eq("id", book_id);

    await advance(book_id, "cover", "qc");
    await fireStage("coloring-v2-qc", { book_id });
    return json({
      ok: true, cover_asset: asset.id, next: "qc",
      text_mode: "illustrated_hand_lettered_baked",
      provider: usedProvider, model: usedModel, law: COVER_LAW,
    });
  } catch (e: any) {
    await recordError(book_id, "cover", e);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
