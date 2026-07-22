import { supabase } from "@/integrations/supabase/client";

/**
 * PERMANENT FIX for blog image loss.
 *
 * Legacy blog posts stored either:
 *   1. Nothing (NULL) → we render a themed SVG placeholder.
 *   2. A 5-year signed URL → the token invalidates when storage signing keys
 *      rotate, breaking every image at once.
 *   3. A stable storage path like "sb:ebook-covers/blog/xxx.jpg" (new format).
 *
 * We resolve at read time so URLs are always fresh.
 */

const SB_PREFIX = "sb:";
const signedCache = new Map<string, { url: string; expires: number }>();

function parsePath(input: string): { bucket: string; path: string } | null {
  if (input.startsWith(SB_PREFIX)) {
    const rest = input.slice(SB_PREFIX.length);
    const slash = rest.indexOf("/");
    if (slash <= 0) return null;
    return { bucket: rest.slice(0, slash), path: rest.slice(slash + 1) };
  }
  // Legacy signed URL — extract bucket + path from the /object/sign/{bucket}/{path}?token=...
  const m = input.match(/\/storage\/v1\/object\/(?:sign|public)\/([^/]+)\/([^?]+)/);
  if (m) return { bucket: decodeURIComponent(m[1]), path: decodeURIComponent(m[2]) };
  return null;
}

/**
 * Deterministic gradient placeholder (data URI SVG) — no network, no expiry.
 * Uses a hash of the seed so the same post always renders the same fallback.
 */
export function fallbackBlogImage(seed: string, label = "SecretPDF"): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const hue1 = Math.abs(h) % 360;
  const hue2 = (hue1 + 45) % 360;
  const safeLabel = label.replace(/[<>&"']/g, "").slice(0, 40);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="hsl(${hue1},70%,72%)"/>
        <stop offset="100%" stop-color="hsl(${hue2},68%,58%)"/>
      </linearGradient>
    </defs>
    <rect width="800" height="600" fill="url(#g)"/>
    <g fill="rgba(255,255,255,0.18)">
      <circle cx="120" cy="140" r="70"/>
      <circle cx="680" cy="480" r="110"/>
      <circle cx="640" cy="120" r="40"/>
    </g>
    <text x="50%" y="52%" text-anchor="middle" font-family="Georgia,serif"
      font-size="42" fill="rgba(255,255,255,0.92)" font-weight="600">${safeLabel}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * Resolve a stored hero_image_url into a fresh URL the browser can load.
 * - Public/http URLs: returned as-is (unless clearly a stale sign token).
 * - "sb:bucket/path" or legacy signed URL: mints a 1-hour signed URL.
 * - null/empty: returns fallback SVG.
 */
export async function resolveBlogImage(
  stored: string | null | undefined,
  seed: string,
  label?: string,
): Promise<string> {
  if (!stored) return fallbackBlogImage(seed, label);

  const parsed = parsePath(stored);
  if (!parsed) {
    // Non-Supabase URL (Runware/CDN direct) — trust it.
    return stored;
  }

  const cacheKey = `${parsed.bucket}/${parsed.path}`;
  const now = Date.now();
  const cached = signedCache.get(cacheKey);
  if (cached && cached.expires > now + 60_000) return cached.url;

  const { data, error } = await supabase.storage
    .from(parsed.bucket)
    .createSignedUrl(parsed.path, 60 * 60);
  if (error || !data?.signedUrl) return fallbackBlogImage(seed, label);

  signedCache.set(cacheKey, { url: data.signedUrl, expires: now + 55 * 60_000 });
  return data.signedUrl;
}
