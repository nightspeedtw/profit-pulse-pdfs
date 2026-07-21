// Owner directive: bypass the Lovable AI Gateway entirely and force all LLM
// traffic through direct providers (GEMINI_API_KEY / OPENAI_API_KEY).
//
// Set BYPASS_LOVABLE_GATEWAY=1 in edge function secrets to activate. When
// active, any code path that would otherwise POST to ai.gateway.lovable.dev
// MUST throw instead so silent fallbacks cannot burn Lovable credits.
export function bypassLovableGateway(): boolean {
  const v = Deno.env.get("BYPASS_LOVABLE_GATEWAY");
  return v === "1" || v === "true" || v === "yes";
}

export function assertGatewayAllowed(context: string): void {
  if (bypassLovableGateway()) {
    throw new Error(
      `[gateway-bypass] Refusing Lovable AI Gateway call in "${context}". ` +
      `BYPASS_LOVABLE_GATEWAY=1 — configure GEMINI_API_KEY / OPENAI_API_KEY so the direct path succeeds.`
    );
  }
}

const GATEWAY_FETCH_GUARD = Symbol.for("secretpdf.gateway_fetch_guard.installed");

export function installGatewayBypassFetchGuard(): void {
  const g = globalThis as typeof globalThis & { [GATEWAY_FETCH_GUARD]?: boolean };
  if (g[GATEWAY_FETCH_GUARD]) return;
  g[GATEWAY_FETCH_GUARD] = true;
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    if (bypassLovableGateway() && /https:\/\/ai\.gateway\.lovable\.dev\//.test(url)) {
      return Promise.reject(new Error(
        `[gateway-bypass] Blocked fetch to Lovable AI Gateway: ${url}. ` +
        `BYPASS_LOVABLE_GATEWAY=1 — use direct providers only.`
      ));
    }
    return originalFetch(input, init);
  }) as typeof fetch;
}

installGatewayBypassFetchGuard();
