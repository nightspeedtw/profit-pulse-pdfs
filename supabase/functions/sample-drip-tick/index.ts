// sample-drip-tick — cron worker (pg_cron every 15 min) that advances the
// 3-email free-sample drip via Resend. Fully automatic per lead. Degrades
// gracefully if a verified sender domain isn't configured yet.
// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";

declare const Deno: any;

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
// Sender domain must be verified in Resend. Falls back to onboarding@resend.dev
// which only delivers to the Resend account owner — safe default so tests work
// without breaking user inboxes.
const SAMPLE_FROM = Deno.env.get("SAMPLE_EMAIL_FROM") ?? "SecretPDF Kids <onboarding@resend.dev>";
const SAMPLE_REPLY_TO = Deno.env.get("SAMPLE_EMAIL_REPLY_TO") ?? "";
const SITE_URL = Deno.env.get("SITE_URL") ?? "https://secretpdf.co";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const j = (x: any, s = 200) =>
  new Response(JSON.stringify(x), {
    status: s,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// Delays between stages (ms)
const STAGE_DELAYS = [0, 24 * 60 * 60_000, 72 * 60 * 60_000]; // welcome→bundle→last-chance

interface Lead {
  id: string;
  email: string;
  first_name: string | null;
  book_id: string | null;
  product_slug: string | null;
  product_category: string | null;
  sample_pdf_url: string | null;
  drip_stage: number;
}

function esc(s: string): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function shell(inner: string, preview: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>SecretPDF Kids</title></head>
<body style="background:#ffffff;margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
<span style="display:none!important;opacity:0;color:transparent;">${esc(preview)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:2px solid #0f172a;border-radius:12px;">
      <tr><td style="padding:28px 28px 8px;">
        <div style="font-family:Georgia,serif;font-size:22px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#0f172a;">SecretPDF Kids</div>
      </td></tr>
      <tr><td style="padding:8px 28px 28px;color:#0f172a;line-height:1.55;font-size:15px;">${inner}</td></tr>
      <tr><td style="padding:16px 28px;border-top:1px solid #e2e8f0;font-size:11px;color:#64748b;">
        SecretPDF Kids &middot; Personal use only &middot; <a href="${SITE_URL}" style="color:#64748b;">${SITE_URL.replace(/^https?:\/\//, "")}</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function tmplWelcome(lead: Lead, bookTitle: string, fullUrl: string): { subject: string; html: string } {
  const hi = lead.first_name ? `Hi ${esc(lead.first_name)},` : "Hi there,";
  const dl = lead.sample_pdf_url ?? `${SITE_URL}${fullUrl}`;
  const inner = `
    <p>${hi}</p>
    <p>Your 5 free coloring pages from <strong>${esc(bookTitle)}</strong> are ready.</p>
    <p style="margin:24px 0;">
      <a href="${dl}" style="background:#0f172a;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:8px;display:inline-block;font-weight:700;">
        Download your free sample
      </a>
    </p>
    <p>Loved them? The full <strong>82-page</strong> book is instant download — printable on A4 and US Letter.</p>
    <p style="margin:20px 0;">
      <a href="${SITE_URL}${fullUrl}" style="color:#0f172a;font-weight:700;">See the full book →</a>
    </p>
    <p style="color:#64748b;font-size:13px;">Happy coloring! — the SecretPDF Kids team</p>`;
  return {
    subject: `Your 5 free coloring pages from ${bookTitle}`,
    html: shell(inner, `Your 5 free pages from ${bookTitle} are ready.`),
  };
}

function tmplBundle(lead: Lead, bookTitle: string, fullUrl: string, bundleUrl: string): { subject: string; html: string } {
  const hi = lead.first_name ? `Hi ${esc(lead.first_name)},` : "Hi there,";
  const inner = `
    <p>${hi}</p>
    <p>Hope your family enjoyed the free pages from <strong>${esc(bookTitle)}</strong>.</p>
    <p>If your kids kept asking for more, the full 82-page book is one click away — and there's a bundle that pairs it with matching titles at a lower price per book.</p>
    <p style="margin:22px 0;">
      <a href="${SITE_URL}${bundleUrl}" style="background:#0f172a;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:8px;display:inline-block;font-weight:700;">
        See the bundle
      </a>
    </p>
    <p style="margin:10px 0 22px;">
      <a href="${SITE_URL}${fullUrl}" style="color:#0f172a;font-weight:700;">Or grab just the full book →</a>
    </p>
    <p style="color:#64748b;font-size:13px;">All instant PDF, print at home, personal-use license.</p>`;
  return {
    subject: `More pages like ${bookTitle} — bundle inside`,
    html: shell(inner, `A bundle that pairs with ${bookTitle}.`),
  };
}

function tmplLastChance(lead: Lead, bookTitle: string, fullUrl: string): { subject: string; html: string } {
  const hi = lead.first_name ? `Hi ${esc(lead.first_name)},` : "Hi there,";
  const inner = `
    <p>${hi}</p>
    <p>Last note from us on <strong>${esc(bookTitle)}</strong>.</p>
    <p>Use code <strong style="background:#fef3c7;padding:2px 8px;border-radius:4px;">SAMPLE10</strong> at checkout for 10% off the full book — good for the next 48 hours.</p>
    <p style="margin:22px 0;">
      <a href="${SITE_URL}${fullUrl}" style="background:#0f172a;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:8px;display:inline-block;font-weight:700;">
        Get the full book
      </a>
    </p>
    <p style="color:#64748b;font-size:13px;">If it's not the right fit — no worries. We won't email you about this book again.</p>`;
  return {
    subject: `${lead.first_name ? lead.first_name + ", " : ""}10% off ${bookTitle} — expires soon`,
    html: shell(inner, `10% off ${bookTitle} for the next 48 hours.`),
  };
}

async function sendResend(to: string, subject: string, html: string): Promise<{ ok: boolean; err?: string }> {
  if (!LOVABLE_API_KEY || !RESEND_API_KEY) return { ok: false, err: "missing_resend_keys" };
  try {
    const r = await fetch("https://connector-gateway.lovable.dev/resend/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": RESEND_API_KEY,
      },
      body: JSON.stringify({
        from: SAMPLE_FROM,
        to: [to],
        subject,
        html,
        ...(SAMPLE_REPLY_TO ? { reply_to: SAMPLE_REPLY_TO } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      return { ok: false, err: `resend_${r.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, err: e?.message ?? String(e) };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const db = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  const t0 = Date.now();

  try {
    const body = await req.json().catch(() => ({}));
    const batch = Math.min(50, Math.max(1, Number(body?.batch ?? 25)));

    const { data: due, error } = await db
      .from("sample_leads")
      .select("id, email, first_name, book_id, product_slug, product_category, sample_pdf_url, drip_stage")
      .lte("drip_next_at", new Date().toISOString())
      .is("unsubscribed_at", null)
      .lt("drip_stage", 3)
      .order("drip_next_at", { ascending: true })
      .limit(batch);
    if (error) return j({ error: error.message }, 500);

    const results: any[] = [];
    for (const lead of (due as Lead[] | null) ?? []) {
      // Load book context per lead (title, slug).
      let bookTitle = "your coloring book";
      let fullUrl = lead.product_slug ? `/kids/coloring/${lead.product_slug}` : "/kids";
      let bundleUrl = lead.product_category
        ? `/kids/coloring/category/${encodeURIComponent(lead.product_category)}`
        : "/kids";
      if (lead.book_id) {
        const { data: b } = await db
          .from("ebooks_kids")
          .select("title, slug, category")
          .eq("id", lead.book_id)
          .maybeSingle();
        if (b?.title) bookTitle = b.title;
        if (b?.slug) fullUrl = `/kids/coloring/${b.slug}`;
        if (b?.category) bundleUrl = `/kids/coloring/category/${encodeURIComponent(String(b.category))}`;
      }

      let email;
      if (lead.drip_stage === 0) email = tmplWelcome(lead, bookTitle, fullUrl);
      else if (lead.drip_stage === 1) email = tmplBundle(lead, bookTitle, fullUrl, bundleUrl);
      else email = tmplLastChance(lead, bookTitle, fullUrl);

      const send = await sendResend(lead.email, email.subject, email.html);
      const nextStage = lead.drip_stage + 1;
      const nextDelay = STAGE_DELAYS[nextStage] ?? 0;
      const nextAt = nextStage >= 3
        ? new Date(Date.now() + 365 * 24 * 60 * 60_000).toISOString() // effectively done
        : new Date(Date.now() + nextDelay).toISOString();

      const patch: Record<string, unknown> = send.ok
        ? {
            drip_stage: nextStage,
            drip_next_at: nextAt,
            drip_last_sent_at: new Date().toISOString(),
            drip_last_error: null,
          }
        : {
            drip_last_error: (send.err ?? "unknown").slice(0, 500),
            // retry same stage in 30 minutes
            drip_next_at: new Date(Date.now() + 30 * 60_000).toISOString(),
          };

      await db.from("sample_leads").update(patch).eq("id", lead.id);
      results.push({ id: lead.id, stage: lead.drip_stage, ok: send.ok, err: send.err });
    }

    return j({ ok: true, processed: results.length, elapsed_ms: Date.now() - t0, results });
  } catch (e: any) {
    return j({ error: e?.message ?? String(e) }, 500);
  }
});
