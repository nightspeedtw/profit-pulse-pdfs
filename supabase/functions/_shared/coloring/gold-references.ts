// Owner doctrine "quality_at_the_source" — generation-time prevention.
//
// GOLD_REFERENCE_CONDITIONING: 3-5 curated top-scoring pages per style
// contract. Where the provider supports image conditioning
// (Runware img2img / style-ref), we pass a gold URL at low strength so
// every render starts anchored to our proven look. Where not supported
// (Cloudflare flux-schnell), we embed the DISTILLED prompt of the gold
// set into the base prompt.
//
// Curation happens by writing rows to public.gold_reference_pages after a
// page ships and scores >= threshold. Selection at generation time picks
// the top-N ACTIVE rows for (style_contract_version, subject|scene_bucket).

export interface GoldReference {
  id: string;
  style_contract_version: string;
  subject: string | null;
  scene_bucket: string | null;
  storage_bucket: string;
  storage_path: string;
  signed_url: string | null;
  signed_url_expires_at: string | null;
  score: number | null;
  source_prompt: string | null;
}

const CACHE = new Map<string, { at: number; rows: GoldReference[] }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

// deno-lint-ignore no-explicit-any
export async function loadGoldReferences(db: any, opts: {
  style_contract_version: string;
  subject?: string | null;
  scene_bucket?: string | null;
  limit?: number;
}): Promise<GoldReference[]> {
  const key = `${opts.style_contract_version}|${opts.subject ?? ""}|${opts.scene_bucket ?? ""}|${opts.limit ?? 3}`;
  const now = Date.now();
  const cached = CACHE.get(key);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.rows;

  try {
    let q = db.from("gold_reference_pages")
      .select("id,style_contract_version,subject,scene_bucket,storage_bucket,storage_path,signed_url,signed_url_expires_at,score,source_prompt")
      .eq("style_contract_version", opts.style_contract_version)
      .eq("active", true)
      .order("score", { ascending: false })
      .limit(opts.limit ?? 3);
    if (opts.subject) q = q.eq("subject", opts.subject.toLowerCase());
    if (opts.scene_bucket) q = q.eq("scene_bucket", opts.scene_bucket);
    const { data } = await q;
    const rows = (Array.isArray(data) ? data : []) as GoldReference[];
    CACHE.set(key, { at: now, rows });
    return rows;
  } catch (_e) {
    return [];
  }
}

/**
 * Resolve gold reference signed URLs, refreshing any that are near/past
 * expiry. Returns just the URLs (max = limit) for use as reference inputs.
 */
// deno-lint-ignore no-explicit-any
export async function goldReferenceUrls(db: any, opts: {
  style_contract_version: string;
  subject?: string | null;
  scene_bucket?: string | null;
  limit?: number;
}): Promise<string[]> {
  const rows = await loadGoldReferences(db, opts);
  const urls: string[] = [];
  const now = Date.now();
  for (const r of rows) {
    const exp = r.signed_url_expires_at ? new Date(r.signed_url_expires_at).getTime() : 0;
    if (r.signed_url && exp - now > 5 * 60 * 1000) { urls.push(r.signed_url); continue; }
    try {
      const { data: signed } = await db.storage.from(r.storage_bucket).createSignedUrl(r.storage_path, 60 * 60 * 24);
      if (signed?.signedUrl) {
        urls.push(signed.signedUrl);
        // Best-effort refresh
        db.from("gold_reference_pages").update({
          signed_url: signed.signedUrl,
          signed_url_expires_at: new Date(now + 60 * 60 * 24 * 1000).toISOString(),
        }).eq("id", r.id).then(() => {}, () => {});
      }
    } catch (_e) { /* skip */ }
  }
  return urls;
}

/**
 * Distilled clause for providers without image conditioning. Injects the
 * proven look from source prompts (short compressed form).
 */
export function distilledGoldClause(rows: GoldReference[]): string {
  const prompts = rows.map((r) => r.source_prompt).filter(Boolean).slice(0, 3);
  if (prompts.length === 0) return "";
  // Take the shared visual descriptors (short heuristic: first 60 chars per gold).
  const snippets = prompts.map((p) => (p ?? "").split(",")[0].trim().slice(0, 60));
  return `Gold-reference look (proven high-scoring pages): ${snippets.join(" | ")}`;
}

/** Curator helper: record a shipped page as a gold reference when it scored high. */
// deno-lint-ignore no-explicit-any
export async function recordGoldReference(db: any, row: {
  style_contract_version: string;
  subject?: string | null;
  scene_bucket?: string | null;
  storage_bucket: string;
  storage_path: string;
  score: number;
  source_book_id?: string | null;
  source_prompt?: string | null;
}): Promise<void> {
  try {
    await db.from("gold_reference_pages").insert({
      style_contract_version: row.style_contract_version,
      subject: row.subject ? row.subject.toLowerCase() : null,
      scene_bucket: row.scene_bucket ?? null,
      storage_bucket: row.storage_bucket,
      storage_path: row.storage_path,
      score: row.score,
      source_book_id: row.source_book_id ?? null,
      source_prompt: row.source_prompt ?? null,
      active: true,
    });
  } catch (_e) { /* best-effort */ }
}
