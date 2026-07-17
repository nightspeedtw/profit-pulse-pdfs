// canva-connect-oauth — admin OAuth flow (start + callback).
// GET  /canva-connect-oauth/start?passcode=...    -> 302 to Canva authorize
// GET  /canva-connect-oauth/callback?code=&state= -> exchanges code, stores token
// GET  /canva-connect-oauth/status?passcode=...   -> { connected, expires_at, scope }
// POST /canva-connect-oauth/disconnect            -> clears token row
// @ts-nocheck
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  CANVA_AUTHORIZE,
  CANVA_TOKEN,
  assertAdmin,
  b64url,
  pkcePair,
  randomState,
  redirectUri,
  requireEnv,
  sbAdmin,
} from "../_shared/canva.ts";

declare const Deno: any;

const SCOPES = [
  "design:content:read",
  "design:content:write",
  "design:meta:read",
  "asset:read",
  "asset:write",
  "profile:read",
].join(" ");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);
  const sub = url.pathname.split("/").filter(Boolean).pop();

  try {
    if (sub === "start") {
      assertAdmin(req);
      const client_id = requireEnv("CANVA_CLIENT_ID");
      const state = randomState();
      const { verifier, challenge } = await pkcePair();
      const sb = sbAdmin();
      const { error } = await sb.from("canva_oauth_states").insert({ state, code_verifier: verifier });
      if (error) throw error;
      const p = new URLSearchParams({
        response_type: "code",
        client_id,
        redirect_uri: redirectUri(),
        scope: SCOPES,
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      });
      return Response.redirect(`${CANVA_AUTHORIZE}?${p.toString()}`, 302);
    }

    if (sub === "callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const err = url.searchParams.get("error");
      if (err) return html(`<h1>Canva connect failed</h1><pre>${err}</pre>`, 400);
      if (!code || !state) return html("<h1>Missing code/state</h1>", 400);
      const sb = sbAdmin();
      const { data: st, error: stErr } = await sb
        .from("canva_oauth_states")
        .select("code_verifier")
        .eq("state", state)
        .maybeSingle();
      if (stErr) throw stErr;
      if (!st) return html("<h1>Invalid state (expired?)</h1>", 400);
      const client_id = requireEnv("CANVA_CLIENT_ID");
      const client_secret = requireEnv("CANVA_CLIENT_SECRET");
      const basic = btoa(`${client_id}:${client_secret}`);
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri(),
        code_verifier: st.code_verifier,
      });
      const tr = await fetch(CANVA_TOKEN, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
      const ttxt = await tr.text();
      if (!tr.ok) return html(`<h1>Token exchange failed (${tr.status})</h1><pre>${escapeHtml(ttxt)}</pre>`, 400);
      const tok = JSON.parse(ttxt);
      const expires_at = new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString();
      await sb.from("canva_oauth_tokens").delete().eq("singleton", true);
      const { error: insErr } = await sb.from("canva_oauth_tokens").insert({
        singleton: true,
        access_token: tok.access_token,
        refresh_token: tok.refresh_token,
        token_type: tok.token_type ?? "Bearer",
        scope: tok.scope ?? SCOPES,
        expires_at,
      });
      if (insErr) throw insErr;
      await sb.from("canva_oauth_states").delete().eq("state", state);
      return html(`
        <h1>Canva connected ✓</h1>
        <p>You can close this tab and return to the admin.</p>
        <script>setTimeout(()=>window.close(),1500)</script>
      `);
    }

    if (sub === "status") {
      assertAdmin(req);
      const sb = sbAdmin();
      const { data } = await sb
        .from("canva_oauth_tokens")
        .select("expires_at, scope, connected_at, updated_at")
        .eq("singleton", true)
        .maybeSingle();
      return json({ connected: !!data, ...(data ?? {}) });
    }

    if (sub === "disconnect") {
      assertAdmin(req);
      const sb = sbAdmin();
      await sb.from("canva_oauth_tokens").delete().eq("singleton", true);
      return json({ ok: true });
    }

    return json({ error: "unknown_path" }, 404);
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "unauthorized" ? 401 : 500;
    return json({ error: msg }, status);
  }
});

function json(x: unknown, status = 200) {
  return new Response(JSON.stringify(x), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function html(body: string, status = 200) {
  return new Response(
    `<!doctype html><html><body style="font-family:system-ui;padding:24px;max-width:640px">${body}</body></html>`,
    { status, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } },
  );
}
function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
