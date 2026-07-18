// coloring-cover-generate — HALF 1 of the split cover pipeline.
//
// OOM defense (cover-function-worker-oom-v1 + edge-function-resource-budget):
// this function does the MINIMUM inside a single isolate:
//   1. ceiling / invocation check
//   2. build prompt (no images decoded)
//   3. ONE provider call (generateIdeogramIntegratedCover)
//   4. upload raw bytes to storage under pending-verify/ path
//   5. stamp metadata.cover_pending_verify with signed URL + context
//   6. enqueue coloring-cover-verify (HALF 2)
//
// No decodes. No RGBA buffers. No vision QC. No fingerprinting. All of that
// runs in a fresh isolate (verify) so a crash in either half is isolated,
// stamped, and resumable via the existing 5-invocation ceiling. Retries are
// cross-invocation; MAX_IDEOGRAM_ATTEMPTS stays at 1 per invocation because
// the queue re-dispatches each attempt with a fresh heap.

// @ts-nocheck  Deno edge runtime
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildColoringCoverArtPrompt } from "../_shared/coloring/cover-prompt.ts";
import { generateIdeogramIntegratedCover } from "../_shared/coloring/ideogram-integrated-cover.ts";
import { resolveTrimProfileKey, TRIM_PROFILES } from "../_shared/coloring/trim-lock.ts";
import { loadActivePreventionRules, indexRulesBySpecies, pickLearnedRulesFor, learnedClauseFromRules } from "../_shared/coloring/first-pass-learner.ts";
import { uploadAndSignImage } from "../_shared/versioned-assets.ts";
import { classifyProviderError } from "../_shared/covers/provider-errors.ts";
import { scheduleSelfAdvance, SELF_ADVANCE_DELAY_BACKOFF_MS, fireAndForgetPost } from "../_shared/coloring/self-advance.ts";

declare const Deno: any;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const IDEOGRAM_GEN_TIMEOUT_MS = 70_000;
const MAX_COVER_INVOCATIONS_PER_BOOK = 5;
const COVER_RETRY_CEILING_REASON = "coloring_cover_retry_ceiling_reached";
const SPLIT_VERSION = "coloring_cover_split_v1_generate";

function json(x: unknown, status = 200) {
  return new Response(JSON.stringify(x), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`wallclock_timeout:${label}:${ms}ms`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}
async function patchMeta(db: any, id: string, patch: Record<string, unknown>) {
  const { data } = await db.from("ebooks_kids").select("metadata").eq("id", id).single();
  const merged = { ...(data?.metadata ?? {}), ...patch };
  await db.from("ebooks_kids").update({ metadata: merged }).eq("id", id);
  return merged;
}
function uniq(xs: unknown[]): string[] {
  const out: string[] = []; const seen = new Set<string>();
  for (const x of xs) { const s = String(x ?? "").trim(); const k = s.toLowerCase(); if (!s || seen.has(k)) continue; seen.add(k); out.push(s); }
  return out;
}
function compactSeaAnatomy(subjects: string[]): string {
  const s = subjects.join(" ").toLowerCase();
  return [
    /(dolphin|whale|orca|narwhal|porpoise|beluga)/.test(s) ? "Cetaceans: horizontal two-lobed flukes only, side profile, no vertical fish tail." : "",
    /narwhal/.test(s) ? "Narwhal: one straight spiral tusk from upper lip." : "",
    /(seal|sea lion)/.test(s) ? "Seal: two front flippers only." : "",
    /(ray|manta|stingray)/.test(s) ? "Ray: dorsal/top or side view only." : "",
  ].filter(Boolean).join(" ");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  let ebookId: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    ebookId = body?.ebook_id ?? null;
    if (!ebookId) return json({ error: "ebook_id required" }, 400);

    const { data: row, error } = await db.from("ebooks_kids")
      .select("id, book_type, title, subtitle, metadata, cover_url, created_at")
      .eq("id", ebookId).maybeSingle();
    if (error) throw error;
    if (!row) return json({ error: "not_found" }, 404);
    if (row.book_type !== "coloring_book") return json({ error: "wrong_lane" }, 400);

    const meta = (row.metadata ?? {}) as Record<string, unknown>;

    // Phase A: resolve trim profile → cover dims. Missing on post-cutoff row = hard blocker.
    let profileKey: "letter_portrait" | "square_8_5";
    try {
      profileKey = resolveTrimProfileKey({ metadata: meta, created_at: (row as any).created_at ?? null });
    } catch (e) {
      const reason = `trim_profile_unresolved:${String((e as Error)?.message ?? e).slice(0, 200)}`;
      await patchMeta(db, ebookId, {
        coloring_current_step_label: `Cover blocked — ${reason}`,
        coloring_blocker: { class: "persistence_contract_bug", reason, detected_at: new Date().toISOString() },
      });
      await db.from("ebooks_kids").update({ pipeline_status: "queued", blocker_reason: reason }).eq("id", ebookId);
      return json({ error: reason }, 422);
    }
    const profile = TRIM_PROFILES[profileKey];

    // If cover already exists, advance immediately.
    if (row.cover_url && meta.coloring_cover) {
      await fireAndForgetPost(`${SUPABASE_URL}/functions/v1/coloring-book-assemble`,
        { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY }, { ebook_id: ebookId }, 3_000);
      return json({ ok: true, skipped: "cover_exists", chained: "assemble" });
    }

    // ── HARD CEILING (owner law) ──
    const priorInvocations = Number((meta as any).coloring_cover_invocations ?? 0);
    if (priorInvocations >= MAX_COVER_INVOCATIONS_PER_BOOK) {
      await patchMeta(db, ebookId, {
        coloring_current_step_label: `Cover retry ceiling reached (${priorInvocations}/${MAX_COVER_INVOCATIONS_PER_BOOK}) — parked for human review.`,
        coloring_blocker: { class: "non_recoverable_config", reason: COVER_RETRY_CEILING_REASON, invocations: priorInvocations, ceiling: MAX_COVER_INVOCATIONS_PER_BOOK, detected_at: new Date().toISOString() },
        awaiting: "human_review",
      });
      await db.from("ebooks_kids").update({ pipeline_status: "queued", blocker_reason: `${COVER_RETRY_CEILING_REASON}:${priorInvocations}` }).eq("id", ebookId);
      return json({ ok: false, parked: true, reason: COVER_RETRY_CEILING_REASON, invocations: priorInvocations }, 202);
    }
    await patchMeta(db, ebookId, { coloring_cover_invocations: priorInvocations + 1 });

    // ── INTERIOR-FIRST LAW ──
    const pages = (meta.coloring_pages as any[] | undefined) ?? [];
    const plan = ((meta.coloring_page_plan as any)?.plan ?? []) as any[];
    const totalPages = plan.length || pages.length || 32;
    const renderedPages = pages.filter((p: any) => p && typeof p.signed_url === "string");
    if (renderedPages.length < Math.max(4, Math.floor((plan.length || 8) * 0.5))) {
      await patchMeta(db, ebookId, {
        awaiting: undefined,
        coloring_current_step_label: `Cover deferred — interior only ${renderedPages.length}/${plan.length || totalPages} pages rendered.`,
      });
      await db.from("ebooks_kids").update({ pipeline_status: "queued" }).eq("id", ebookId);
      await fireAndForgetPost(`${SUPABASE_URL}/functions/v1/coloring-book-render`,
        { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY }, { ebook_id: ebookId }, 3_000);
      return json({ ok: true, deferred: "interior_first_law", rendered: renderedPages.length });
    }
    const referenceImageURLs: string[] = renderedPages.slice().sort((a: any, b: any) => (a.page ?? 999) - (b.page ?? 999)).slice(0, 3).map((p: any) => p.signed_url as string);

    // ── CATEGORY CONTEXT (kept lean; no DB writes we don't need) ──
    const categoryName = (meta.category_name as string) ?? "Coloring Book";
    const ageMin = ((meta.coloring_category_meta as any)?.target_age_min) ?? 4;
    const ageMax = ((meta.coloring_category_meta as any)?.target_age_max) ?? 6;
    const ageBadge = `Ages ${ageMin}-${ageMax}`;
    const subtitle = `A Coloring Adventure`;
    const categoryKey = ((meta.coloring_page_plan as any)?.category_key as string) ?? (meta.category_key as string | undefined);
    let allowedSubjects: string[] = ((meta.coloring_category_meta as any)?.allowed_subjects as string[]) ?? [];
    let forbiddenSubjects: string[] = ((meta.coloring_category_meta as any)?.forbidden_subjects as string[]) ?? [];
    if (categoryKey && (allowedSubjects.length === 0 || forbiddenSubjects.length === 0)) {
      const { data: cat } = await db.from("coloring_categories").select("category_name, allowed_subjects, forbidden_subjects").eq("category_key", categoryKey).maybeSingle();
      if (cat?.allowed_subjects) allowedSubjects = cat.allowed_subjects;
      if (cat?.forbidden_subjects) forbiddenSubjects = cat.forbidden_subjects;
    }
    const categoryNameFinal = (meta.category_name as string) ?? ((meta.coloring_page_plan as any)?.category_name as string) ?? categoryName;
    const planSubjects = uniq(plan.flatMap((p) => [p.primary_subject, ...(p.secondary_subjects ?? [])]));
    const heroSubjects = uniq([...planSubjects, ...allowedSubjects]).slice(0, 10);
    const rules = await loadActivePreventionRules(db);
    const rulesIndex = indexRulesBySpecies(rules);
    const learnedRules = new Map<string, any>();
    for (const subject of heroSubjects) for (const r of pickLearnedRulesFor(rulesIndex, subject, "cover scene")) learnedRules.set(`${r.pattern_key}|${r.species_key}`, r);
    const learnedClause = learnedClauseFromRules([...learnedRules.values()]).replace(/^Learned prevention rules[^:]*:\s*/i, "Learned corrections: ").slice(0, 420);
    const anatomyClauses = compactSeaAnatomy(heroSubjects);

    const prompt = buildColoringCoverArtPrompt({
      categoryName: categoryNameFinal, ageMin, ageMax, heroSubjects, forbiddenSubjects,
      extraClauses: [anatomyClauses, learnedClause], bannedTitle: row.title,
    });

    await patchMeta(db, ebookId, {
      coloring_current_step_label: "Cover generate (split v1) — provider call in flight",
      coloring_progress_percent: 92,
      coloring_cover_generate_attempt: {
        version: SPLIT_VERSION, invocation: priorInvocations + 1,
        started_at: new Date().toISOString(), status: "started",
      },
    });

    // ── PROVIDER CALL (single attempt; retries via cross-invocation) ──
    let ideo: any;
    try {
      ideo = await withTimeout(
        generateIdeogramIntegratedCover({
          categoryName: categoryNameFinal, heroSubjects, title: row.title, subtitle, ageBadge,
          ageMin, ageMax, totalPages, forbiddenSubjects, forbiddenBackgrounds: forbiddenSubjects,
          referenceImageURLs, ebook_id: ebookId,
          dims: {
            runwareWidth: profile.runwareIdeogram.width,
            runwareHeight: profile.runwareIdeogram.height,
            runwareFallbackWidth: profile.runwareIdeogram.fallbackWidth,
            runwareFallbackHeight: profile.runwareIdeogram.fallbackHeight,
            gptImageSize: profile.gptImageSize,
          },
        }, { timeoutMs: IDEOGRAM_GEN_TIMEOUT_MS, seed: (priorInvocations + 1) * 1009, db }),
        IDEOGRAM_GEN_TIMEOUT_MS + 5_000, `ideogram_inv${priorInvocations + 1}`,
      );
    } catch (e: any) {
      const rawReason = String(e?.message ?? e).slice(0, 240);
      const providerClass = classifyProviderError(rawReason);
      const reason = providerClass ? `provider_${providerClass}` : rawReason.includes("timeout") ? "provider_timeout" : `provider_error:${rawReason}`;
      const isLaneBlocked = providerClass === "billing_exhausted" || providerClass === "quota_exceeded";
      await patchMeta(db, ebookId, {
        coloring_current_step_label: `Cover generate failed: ${reason}`,
        coloring_blocker: { class: isLaneBlocked ? "temporary_provider_error" : "content_quality_failure", reason, detected_at: new Date().toISOString() },
        awaiting: "cover_pdf_publish",
        coloring_cover_generate_attempt: { version: SPLIT_VERSION, invocation: priorInvocations + 1, status: "provider_failed", reason, ended_at: new Date().toISOString() },
      });
      await db.from("ebooks_kids").update({ pipeline_status: "queued", blocker_reason: `coloring_cover_generate:${reason}`.slice(0, 300) }).eq("id", ebookId);
      if (!isLaneBlocked) await scheduleSelfAdvance(db, ebookId, { delayMs: SELF_ADVANCE_DELAY_BACKOFF_MS, reason: `cover_gen:${reason}` });
      try { await db.from("coloring_book_events").insert({ ebook_kids_id: ebookId, event_type: "cover_provider_attempt", metadata: { provider: null, pass: false, status: "provider_failed", reason, phase: "generate", invocation: priorInvocations + 1 } }); } catch (_) {}
      return json({ ok: false, phase: "generate", requeued: true, reason }, 202);
    }

    // ── UPLOAD RAW (no decode; bytes go straight to storage) ──
    const rawBytes = ideo.bytes as Uint8Array;
    const version = `${Date.now()}`;
    const pendingPath = `kids/${ebookId}/coloring/cover-pending-verify-${version}.png`;
    const up = await uploadAndSignImage(db, "ebook-covers", pendingPath, rawBytes, { contentType: "image/png" });

    // Stamp pending record with everything verify needs. No bytes stored in memory beyond this point.
    await patchMeta(db, ebookId, {
      coloring_cover_generate_attempt: {
        version: SPLIT_VERSION, invocation: priorInvocations + 1,
        status: "uploaded", ended_at: new Date().toISOString(),
        provider: ideo.provider, seed: ideo.seed, request_id: ideo.request_id, byte_size: rawBytes.length,
      },
      cover_pending_verify: {
        version: SPLIT_VERSION,
        signed_url: up.signedUrl, storage_path: up.path,
        provider: ideo.provider, prompt_used: ideo.prompt, seed: ideo.seed, request_id: ideo.request_id,
        title: row.title, subtitle, age_badge: ageBadge,
        category_name: categoryNameFinal,
        hero_subjects: heroSubjects, allowed_subjects: allowedSubjects, forbidden_subjects: forbiddenSubjects,
        reference_image_urls: referenceImageURLs,
        learned_rules: [...learnedRules.values()].map((r: any) => ({ pattern_key: r.pattern_key, species_key: r.species_key })),
        invocation: priorInvocations + 1,
        uploaded_at: new Date().toISOString(),
        byte_size: rawBytes.length,
      },
      coloring_current_step_label: `Cover generated (${ideo.provider}) — enqueued verify (invocation ${priorInvocations + 1})`,
      awaiting: "cover_verify",
    });
    await db.from("ebooks_kids").update({ pipeline_status: "queued", blocker_reason: null }).eq("id", ebookId);

    // Fire verify immediately; worker-tick is the safety net if this drops.
    await fireAndForgetPost(`${SUPABASE_URL}/functions/v1/coloring-cover-verify`,
      { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY }, { ebook_id: ebookId }, 3_000);

    return json({ ok: true, phase: "generate", provider: ideo.provider, invocation: priorInvocations + 1, pending_path: up.path, chained: "verify" });
  } catch (e: any) {
    const msg = String(e?.message ?? e).slice(0, 300);
    console.error("[coloring-cover-generate] fatal", msg);
    try {
      if (ebookId) {
        await patchMeta(db, ebookId, {
          coloring_blocker: { class: "cover_function_threw", reason: `cover_generate_fatal:${msg}`, detected_at: new Date().toISOString() },
          coloring_current_step_label: `Cover generate threw: ${msg}`,
        });
        await db.from("ebooks_kids").update({ pipeline_status: "queued", blocker_reason: `coloring_cover_generate_fatal:${msg}`.slice(0, 300) }).eq("id", ebookId);
        await db.from("coloring_book_events").insert({ ebook_kids_id: ebookId, event_type: "cover_function_threw", metadata: { phase: "generate", error: msg, at: new Date().toISOString() } }).catch(() => {});
      }
    } catch (_) {}
    return json({ error: msg, blocker_stamped: true }, 500);
  }
});
