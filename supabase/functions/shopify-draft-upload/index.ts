// Milestone 7 — Shopify Draft Upload.
//
// POST { ebook_id, retry?: boolean }
//
// Creates the ebook as a DRAFT product in Shopify with:
//   - title, body_html (product description), vendor, product_type, tags
//   - variant: price, sku, requires_shipping=false, taxable, inventory not tracked
//   - SEO title + description via metafields_global_title_tag / description_tag
//   - URL handle
//   - cover image uploaded to product
//   - PDF file uploaded to Shopify Files and saved on metafield custom.pdf_file
//
// Records every step in shopify_sync_logs (request status, product ID,
// file_upload_status, error, retry_count) and updates the ebook row with
// shopify_product_id / handle / status. Auto-publishing is NOT performed.
import { admin, corsHeaders } from "../_shared/ai.ts";
import { logRun } from "../_shared/qc.ts";
import { computeQcGates } from "../_shared/qc-gates.ts";

const SHOP_DOMAIN = Deno.env.get("SHOPIFY_SHOP_DOMAIN")
  ?? "digital-wealth-hub-49qgj.myshopify.com";
const API_VERSION = "2025-07";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const t0 = Date.now();
  const db = admin();

  try {
    const body = await req.json().catch(() => ({}));
    const ebookId: string | undefined = body.ebook_id;
    if (!ebookId) return json({ error: "ebook_id required" }, 400);

    const token = Deno.env.get("SHOPIFY_ADMIN_TOKEN") ?? Deno.env.get("SHOPIFY_ACCESS_TOKEN");
    if (!token) return json({ error: "SHOPIFY_ADMIN_TOKEN not configured" }, 500);

    const { data: ebook, error: eErr } = await db.from("ebooks").select("*").eq("id", ebookId).maybeSingle();
    if (eErr || !ebook) return json({ error: "ebook not found" }, 404);

    // Hard guards: must have PDF + cover before any Shopify call.
    if (!ebook.pdf_url) return json({ error: "ebook has no pdf_url — render PDF first" }, 400);
    if (!ebook.cover_url) return json({ error: "ebook has no cover_url — generate cover first" }, 400);
    if (!ebook.thumbnail_url) {
      return json({ error: "ebook has no thumbnail_url — generate premium book mockup thumbnail first", blocker: "thumbnail_missing", retryable: true }, 400);
    }

    // Permanent Thumbnail QC hard gate — never upload a book without a
    // premium, readable, book-mockup thumbnail. All four thumbnail scores
    // must be >= 90 (see qc-gates.ts / premium-ebook-master skill).
    const gates = computeQcGates(ebook);
    if (!gates.cover_thumb.pass) {
      const bd = gates.cover_thumb.breakdown ?? {};
      const reason = `thumbnail_qc_failed: book_mockup=${bd.book_mockup ?? "?"} readability=${bd.readability ?? "?"} click_appeal=${bd.click_appeal ?? "?"} premium_feel=${bd.premium_feel ?? "?"} (all must be >= 90)`;
      await db.from("ebooks").update({
        shopify_status: "blocked",
        shopify_last_error: reason,
        blocker_class: "recoverable_qc_failure",
        blocker_reason: "thumbnail_qc_below_90",
      }).eq("id", ebookId);
      // Trigger auto-regeneration of the mockup thumbnail.
      db.functions.invoke("generate-cover", { body: { ebook_id: ebookId, mode: "overlay" } }).catch(() => {});
      return json({ error: reason, blocker: "thumbnail_qc", auto_fix: "regenerating_thumbnail", retryable: true }, 409);
    }
    if (!gates.cover_pdf.pass) {
      return json({ error: "cover_pdf_full_a4_below_100 — regenerate cover before upload", blocker: "cover_pdf", retryable: true }, 409);
    }

    // Prior log → retry counter
    const { data: prior } = await db.from("shopify_sync_logs")
      .select("retry_count").eq("ebook_id", ebookId).eq("action", "draft_upload")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    const retryCount = (prior?.retry_count ?? -1) + 1;

    const handle = (ebook.shopify_handle ?? ebook.slug ?? slugify(ebook.title)).toString();
    const price = String(ebook.price ?? "29.00");
    const tags = Array.isArray(ebook.tags) ? ebook.tags.join(", ") : (ebook.tags ?? "");
    const seoTitle = (ebook.seo_title ?? ebook.title ?? "").toString().slice(0, 70);
    const seoMeta = (ebook.seo_meta ?? ebook.subtitle ?? "").toString().slice(0, 160);
    const description = (ebook.product_description ?? ebook.subtitle ?? "").toString();

    const logRow: Record<string, unknown> = {
      ebook_id: ebookId, action: "draft_upload", status: "running",
      retry_count: retryCount, file_upload_status: "pending",
      request_payload: { handle, price, tags, seo_title: seoTitle },
    };
    const { data: logIns } = await db.from("shopify_sync_logs").insert(logRow).select("id").single();
    const logId = logIns?.id as string | undefined;

    await db.from("ebooks").update({ shopify_status: "uploading" }).eq("id", ebookId);

    // ---- 1) Create product as DRAFT ----
    const productPayload = {
      product: {
        title: ebook.title,
        body_html: description || `<p>${escapeHtml(ebook.subtitle ?? "")}</p>`,
        vendor: ebook.vendor ?? "Secret PDF",
        product_type: ebook.product_type ?? "Ebook",
        handle,
        tags,
        status: "draft", // <-- explicitly DRAFT, never published here
        published: false,
        metafields_global_title_tag: seoTitle,
        metafields_global_description_tag: seoMeta,
        variants: [{
          price,
          sku: `EBK-${(ebook.slug ?? ebookId).toString().slice(0, 28).toUpperCase()}`,
          requires_shipping: false,
          taxable: true,
          inventory_policy: "continue",
          inventory_management: null,
        }],
      },
    };

    const productResp = await shopifyRest(token, "POST", "/products.json", productPayload);
    if (!productResp.ok) {
      const tokenPrefix = token ? `${token.slice(0, 6)}****${token.slice(-4)}` : "(none)";
      let friendly = `Shopify ${productResp.status}: ${productResp.detail.slice(0, 300)}`;
      if (productResp.status === 401) {
        friendly = `Shopify Admin API token is invalid or does not match this store. `
          + `Please check SHOPIFY_STORE_DOMAIN (${SHOP_DOMAIN}) and SHOPIFY_ADMIN_TOKEN (${tokenPrefix}). `
          + `Retries will not fix a 401 — update the token, click Test Shopify Connection, then Re-push.`;
      } else if (productResp.status === 403) {
        friendly = `Shopify token is missing required scopes (need write_products, read_products). Update the app scopes and re-install the token.`;
      }
      await failLog(db, logId, ebookId, retryCount, "product_create_failed", friendly);
      return json({
        error: friendly,
        status: productResp.status,
        store_domain: SHOP_DOMAIN,
        api_version: API_VERSION,
        token_prefix: tokenPrefix,
        retryable: ![401, 403, 404].includes(productResp.status),
      }, 502);
    }
    const productId = String(productResp.body?.product?.id ?? "");
    const productGid = `gid://shopify/Product/${productId}`;
    const savedHandle = productResp.body?.product?.handle ?? handle;

    // ---- 2) Attach cover image (REST) ----
    let coverAttached = false;
    try {
      const imgResp = await shopifyRest(token, "POST", `/products/${productId}/images.json`, {
        image: { src: ebook.cover_url, alt: ebook.title },
      });
      coverAttached = imgResp.ok;
      if (!imgResp.ok) console.warn("cover image attach failed:", imgResp.detail);
    } catch (e) { console.warn("cover image error:", (e as Error).message); }

    // ---- 3) Upload PDF to Shopify Files (GraphQL stagedUploadsCreate + fileCreate) ----
    let pdfFileStatus: "uploaded" | "failed" | "skipped" = "skipped";
    let pdfFileId: string | null = null;
    let pdfCdnUrl: string | null = null;
    try {
      const pdfBytes = await fetchPdfBytes(ebook.pdf_url);
      const filename = `${savedHandle}.pdf`;
      const staged = await graphql(token, STAGED_UPLOADS_MUTATION, {
        input: [{
          resource: "FILE",
          filename,
          mimeType: "application/pdf",
          fileSize: String(pdfBytes.byteLength),
          httpMethod: "POST",
        }],
      });
      const target = staged?.data?.stagedUploadsCreate?.stagedTargets?.[0];
      if (!target) throw new Error("no staged upload target returned");

      const fd = new FormData();
      for (const p of target.parameters ?? []) fd.append(p.name, p.value);
      fd.append("file", new Blob([pdfBytes], { type: "application/pdf" }), filename);
      const stagedResp = await fetch(target.url, { method: "POST", body: fd });
      if (!stagedResp.ok) throw new Error(`staged upload ${stagedResp.status}: ${(await stagedResp.text()).slice(0, 300)}`);

      const fileCreate = await graphql(token, FILE_CREATE_MUTATION, {
        files: [{
          alt: ebook.title,
          contentType: "FILE",
          originalSource: target.resourceUrl,
        }],
      });
      const fileNode = fileCreate?.data?.fileCreate?.files?.[0];
      if (!fileNode) throw new Error("fileCreate returned no file");
      pdfFileId = fileNode.id ?? null;
      pdfCdnUrl = fileNode.url ?? target.resourceUrl ?? null;
      pdfFileStatus = "uploaded";

      // Persist file reference as product metafield so the storefront / digital
      // delivery app can find the PDF for fulfillment.
      await graphql(token, METAFIELDS_SET_MUTATION, {
        metafields: [{
          ownerId: productGid,
          namespace: "custom",
          key: "pdf_file",
          type: "file_reference",
          value: pdfFileId,
        }, {
          ownerId: productGid,
          namespace: "custom",
          key: "pdf_url",
          type: "url",
          value: pdfCdnUrl ?? ebook.pdf_url,
        }],
      });
    } catch (e) {
      pdfFileStatus = "failed";
      console.warn("PDF upload failed:", (e as Error).message);
    }

    // ---- 4) Update ebook row ----
    await db.from("ebooks").update({
      shopify_product_id: productId,
      shopify_handle: savedHandle,
      shopify_status: "draft",
      shopify_last_event_at: new Date().toISOString(),
      shopify_last_error: pdfFileStatus === "failed" ? "pdf upload failed" : null,
      pipeline_status: "draft_ready",
    }).eq("id", ebookId);

    // ---- 5) Log success ----
    if (logId) {
      await db.from("shopify_sync_logs").update({
        status: pdfFileStatus === "failed" ? "partial" : "ok",
        shopify_product_id: productId,
        file_upload_status: pdfFileStatus,
        response_payload: {
          product_id: productId, handle: savedHandle, cover_attached: coverAttached,
          pdf_file_id: pdfFileId, pdf_cdn_url: pdfCdnUrl,
        },
        error: pdfFileStatus === "failed" ? "PDF Files upload failed (product still created as draft)" : null,
      }).eq("id", logId);
    }
    await logRun(db, {
      ebook_id: ebookId, step: "shopify-draft-upload",
      status: pdfFileStatus === "failed" ? "rewrite" : "ok",
      duration_ms: Date.now() - t0,
      payload: { product_id: productId, retry_count: retryCount, pdf_file_status: pdfFileStatus },
    });

    return json({
      ok: true, product_id: productId, handle: savedHandle,
      cover_attached: coverAttached, pdf_file_status: pdfFileStatus,
      pdf_file_id: pdfFileId, retry_count: retryCount,
      admin_url: `https://${SHOP_DOMAIN}/admin/products/${productId}`,
    });
  } catch (e) {
    console.error("shopify-draft-upload failed:", e);
    return json({ error: (e as Error).message ?? String(e) }, 500);
  }
});

// ---------- helpers ----------
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
function escapeHtml(s: string) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function slugify(s: string) {
  return (s ?? "").toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "")
    .trim().replace(/\s+/g, "-").slice(0, 60) || `ebook-${Date.now()}`;
}

async function shopifyRest(token: string, method: string, path: string, body?: unknown) {
  const resp = await fetch(`https://${SHOP_DOMAIN}/admin/api/${API_VERSION}${path}`, {
    method,
    headers: {
      "X-Shopify-Access-Token": token,
      "content-type": "application/json",
      "accept": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let parsed: any = null; try { parsed = JSON.parse(text); } catch { /* ignore */ }
  return { ok: resp.ok, status: resp.status, body: parsed, detail: text.slice(0, 800) };
}

async function graphql(token: string, query: string, variables: Record<string, unknown>) {
  const resp = await fetch(`https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const j = await resp.json().catch(() => ({}));
  // Surface userErrors as throws so the caller logs them clearly.
  const ue =
    j?.data?.stagedUploadsCreate?.userErrors
    ?? j?.data?.fileCreate?.userErrors
    ?? j?.data?.metafieldsSet?.userErrors;
  if (Array.isArray(ue) && ue.length) {
    throw new Error(`Shopify GraphQL userErrors: ${JSON.stringify(ue)}`);
  }
  if (j?.errors) throw new Error(`Shopify GraphQL errors: ${JSON.stringify(j.errors).slice(0, 500)}`);
  return j;
}

async function fetchPdfBytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`pdf fetch failed: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

async function failLog(db: ReturnType<typeof admin>, logId: string | undefined, ebookId: string,
  retryCount: number, _stage: string, detail: string) {
  if (logId) {
    await db.from("shopify_sync_logs").update({
      status: "failed", error: detail.slice(0, 1200), retry_count: retryCount,
      file_upload_status: "skipped",
    }).eq("id", logId);
  }
  await db.from("ebooks").update({
    shopify_status: "error", shopify_last_error: detail.slice(0, 500),
    shopify_last_event_at: new Date().toISOString(),
  }).eq("id", ebookId);
}

// ---------- GraphQL mutations ----------
const STAGED_UPLOADS_MUTATION = `
mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) {
    stagedTargets { url resourceUrl parameters { name value } }
    userErrors { field message }
  }
}`;
const FILE_CREATE_MUTATION = `
mutation fileCreate($files: [FileCreateInput!]!) {
  fileCreate(files: $files) {
    files { id alt ... on GenericFile { url } }
    userErrors { field message }
  }
}`;
const METAFIELDS_SET_MUTATION = `
mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id key namespace }
    userErrors { field message }
  }
}`;
