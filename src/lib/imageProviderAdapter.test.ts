import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// We test the provider registry contract + failover semantics WITHOUT
// hitting the real HTTP surfaces. The module under test uses Deno.env +
// fetch; we stub both in the vitest (node) environment.

// deno-lint-ignore-file no-explicit-any
(globalThis as any).Deno = (globalThis as any).Deno ?? {
  env: {
    _map: new Map<string, string>(),
    get(k: string) { return (this as any)._map.get(k); },
    set(k: string, v: string) { (this as any)._map.set(k, v); },
    delete(k: string) { (this as any)._map.delete(k); },
  },
};

async function loadModule() {
  // Re-import fresh so the module reads the current env stubs.
  vi.resetModules();
  return await import("../../supabase/functions/_shared/image-providers.ts");
}

describe("image-providers adapter", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    (globalThis as any).Deno.env._map.clear();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("cloudflare provider without CF_ACCOUNT_ID/CF_API_TOKEN throws ProviderUnconfiguredError", async () => {
    const mod = await loadModule();
    await expect(mod.cloudflareFluxSchnell({ prompt: "x" })).rejects.toMatchObject({
      kind: "provider_unconfigured",
      provider: "cloudflare_flux_schnell",
    });
  });

  it("failover: primary=cloudflare unconfigured → falls through to fal", async () => {
    const mod = await loadModule();
    // Force fal to succeed via a stubbed provider (replace registry entry).
    const fakeBytes = new Uint8Array([1, 2, 3]);
    (mod.PROVIDERS as any).fal_flux_schnell = async () => fakeBytes;
    const out = await mod.generateImageWithFailover(
      { prompt: "hello" },
      { primary: "cloudflare_flux_schnell", fallback: "fal_flux_schnell" },
    );
    expect(out.provider).toBe("fal_flux_schnell");
    expect(out.bytes).toBe(fakeBytes);
    expect(out.attempts[0].ok).toBe(false);
    expect(out.attempts[1].ok).toBe(true);
  });

  it("failover: primary 500 → falls through to fal", async () => {
    const mod = await loadModule();
    (globalThis as any).Deno.env.set("CF_ACCOUNT_ID", "acct");
    (globalThis as any).Deno.env.set("CF_API_TOKEN", "tok");
    globalThis.fetch = vi.fn(async () => new Response("boom", { status: 500 })) as any;
    const fakeBytes = new Uint8Array([9]);
    (mod.PROVIDERS as any).fal_flux_schnell = async () => fakeBytes;
    const out = await mod.generateImageWithFailover(
      { prompt: "hi" },
      { primary: "cloudflare_flux_schnell", fallback: "fal_flux_schnell" },
    );
    expect(out.provider).toBe("fal_flux_schnell");
    expect(out.attempts[0].error).toMatch(/500/);
  });

  it("failover: primary 429 quota → falls through to fal (never burns page attempt)", async () => {
    const mod = await loadModule();
    (globalThis as any).Deno.env.set("CF_ACCOUNT_ID", "acct");
    (globalThis as any).Deno.env.set("CF_API_TOKEN", "tok");
    globalThis.fetch = vi.fn(async () => new Response("Too Many Requests", { status: 429 })) as any;
    const fakeBytes = new Uint8Array([7]);
    (mod.PROVIDERS as any).fal_flux_schnell = async () => fakeBytes;
    const out = await mod.generateImageWithFailover(
      { prompt: "hi" },
      { primary: "cloudflare_flux_schnell", fallback: "fal_flux_schnell" },
    );
    expect(out.provider).toBe("fal_flux_schnell");
  });

  it("cloudflare success returns bytes and reports provider tag", async () => {
    const mod = await loadModule();
    (globalThis as any).Deno.env.set("CF_ACCOUNT_ID", "acct");
    (globalThis as any).Deno.env.set("CF_API_TOKEN", "tok");
    const pngB64 = btoa("PNGDATA");
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      result: { image: pngB64 }, success: true,
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as any;
    const out = await mod.generateImageWithFailover(
      { prompt: "hi", num_inference_steps: 4 },
      { primary: "cloudflare_flux_schnell", fallback: "fal_flux_schnell" },
    );
    expect(out.provider).toBe("cloudflare_flux_schnell");
    expect(new TextDecoder().decode(out.bytes)).toBe("PNGDATA");
  });

  it("default policy is cloudflare primary, fal fallback", async () => {
    const mod = await loadModule();
    expect(mod.DEFAULT_IMAGE_PROVIDER_POLICY.interiors.primary).toBe("cloudflare_flux_schnell");
    expect(mod.DEFAULT_IMAGE_PROVIDER_POLICY.interiors.fallback).toBe("fal_flux_schnell");
  });
});
