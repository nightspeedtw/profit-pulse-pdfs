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
