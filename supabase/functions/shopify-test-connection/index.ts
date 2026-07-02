// Validates Shopify Admin credentials and returns structured status.
// Never returns the full token — only a masked prefix.
import { corsHeaders } from "../_shared/ai.ts";

const API_VERSION = "2025-07";

function mask(token: string): string {
  if (!token) return "";
  const head = token.slice(0, 6);
  const tail = token.slice(-4);
  return `${head}****${tail}`;
}

function normalizeDomain(raw: string): string {
  return raw.trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

function validate(domain: string, token: string) {
  const problems: string[] = [];
  if (!domain) problems.push("SHOPIFY_STORE_DOMAIN is not set.");
  else {
    if (/^https?:\/\//i.test(domain)) problems.push("Store domain must not include https://.");
    if (/\/$/.test(domain)) problems.push("Store domain must not include a trailing slash.");
    if (!/\.myshopify\.com$/i.test(normalizeDomain(domain))) {
      problems.push("Store domain should look like store-name.myshopify.com.");
    }
  }
  if (!token) problems.push("SHOPIFY_ADMIN_TOKEN is not set.");
  else {
    if (/\s/.test(token)) problems.push("Token must not contain spaces or line breaks.");
    if (!token.startsWith("shpat_")) problems.push("Token should start with shpat_.");
  }
  return problems;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const rawDomain =
    Deno.env.get("SHOPIFY_STORE_DOMAIN") ??
    Deno.env.get("SHOPIFY_SHOP_DOMAIN") ??
    "digital-wealth-hub-49qgj.myshopify.com";
  const token =
    Deno.env.get("SHOPIFY_ADMIN_TOKEN") ??
    Deno.env.get("SHOPIFY_ACCESS_TOKEN") ??
    "";
  const domain = normalizeDomain(rawDomain);
  const problems = validate(rawDomain, token);

  const base = {
    domain,
    api_version: API_VERSION,
    token_prefix: token ? mask(token) : null,
  };

  if (problems.length) {
    return json({
      ok: false,
      status: "invalid_config",
      message: problems.join(" "),
      problems,
      ...base,
    });
  }

  try {
    const resp = await fetch(
      `https://${domain}/admin/api/${API_VERSION}/shop.json`,
      {
        method: "GET",
        headers: {
          "X-Shopify-Access-Token": token,
          "accept": "application/json",
        },
      },
    );
    const grantedScopes = (resp.headers.get("x-shopify-api-access-scopes") ?? "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    const bodyText = await resp.text();
    let body: any = null;
    try { body = JSON.parse(bodyText); } catch { /* ignore */ }

    if (resp.status === 200) {
      return json({
        ok: true,
        status: "connected",
        message: `Connected to ${body?.shop?.name ?? domain}.`,
        shop_name: body?.shop?.name ?? null,
        plan: body?.shop?.plan_display_name ?? null,
        granted_scopes: grantedScopes,
        ...base,
      });
    }
    if (resp.status === 401) {
      return json({
        ok: false,
        status: "invalid_token",
        message: `Shopify Admin API token is invalid or does not match this store. Please check SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_TOKEN.`,
        detail: bodyText.slice(0, 300),
        ...base,
      });
    }
    if (resp.status === 403) {
      return json({
        ok: false,
        status: "missing_scopes",
        message: `Shopify token is valid but missing required permissions/scopes.`,
        granted_scopes: grantedScopes,
        detail: bodyText.slice(0, 300),
        ...base,
      });
    }
    if (resp.status === 404) {
      return json({
        ok: false,
        status: "wrong_store_domain",
        message: `Store not found at ${domain}. Check SHOPIFY_STORE_DOMAIN.`,
        detail: bodyText.slice(0, 300),
        ...base,
      });
    }
    return json({
      ok: false,
      status: "http_error",
      message: `Shopify returned ${resp.status}.`,
      http_status: resp.status,
      detail: bodyText.slice(0, 300),
      ...base,
    });
  } catch (e) {
    return json({
      ok: false,
      status: "network_error",
      message: `Network error contacting Shopify: ${(e as Error).message}`,
      ...base,
    });
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
