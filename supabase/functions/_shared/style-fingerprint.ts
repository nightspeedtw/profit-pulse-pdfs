// Style fingerprint (Gate 3): one-style-per-book enforcement.
//
// A page's fingerprint = sha1(style_bible_id || model_id || style_preset_id).
// A book stores a `style_anchor_fingerprint` set the first time interior
// generation succeeds. Any page whose fingerprint differs must be
// regenerated, not reused, before assembly.

async function sha1Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface FingerprintInputs {
  styleBibleId?: string | null;
  styleBibleHash?: string | null;
  model?: string | null;
  stylePresetId?: string | null;
}

export async function computeStyleFingerprint(inp: FingerprintInputs): Promise<string> {
  const parts = [
    inp.styleBibleId ?? '',
    inp.styleBibleHash ?? '',
    inp.model ?? '',
    inp.stylePresetId ?? '',
  ].join('|');
  return (await sha1Hex(parts)).slice(0, 16);
}

export async function hashJson(obj: unknown): Promise<string> {
  const s = JSON.stringify(obj ?? {});
  return (await sha1Hex(s)).slice(0, 16);
}
