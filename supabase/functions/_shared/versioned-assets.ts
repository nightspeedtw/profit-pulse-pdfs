export const IMAGE_SIGNED_TTL_SECONDS = 60 * 60 * 24 * 365;

function assetVersion(): string {
  return `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

function cleanStem(stem: string): string {
  return stem.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'asset';
}

export function versionedEbookAssetPath(ebookId: string, stem: string, ext = 'png'): string {
  return `${ebookId}/${cleanStem(stem)}-${assetVersion()}.${ext.replace(/^\./, '')}`;
}

export function versionedKidsAssetPath(ebookId: string, stem: string, ext = 'png'): string {
  return `kids/${ebookId}/${cleanStem(stem)}-${assetVersion()}.${ext.replace(/^\./, '')}`;
}

export function versionedKidsInteriorPath(ebookId: string, pageIndex: number, ext = 'png'): string {
  const page = String(pageIndex + 1).padStart(2, '0');
  return `kids/${ebookId}/interior/page-${page}-${assetVersion()}.${ext.replace(/^\./, '')}`;
}

export function storagePathFromUrl(raw: string | null | undefined, bucket: string): string | null {
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) return raw.replace(/^\/+/, '');
  try {
    const u = new URL(raw);
    const marker = `/storage/v1/object/sign/${bucket}/`;
    const idx = u.pathname.indexOf(marker);
    if (idx >= 0) return decodeURIComponent(u.pathname.slice(idx + marker.length));
    const publicMarker = `/storage/v1/object/public/${bucket}/`;
    const pubIdx = u.pathname.indexOf(publicMarker);
    if (pubIdx >= 0) return decodeURIComponent(u.pathname.slice(pubIdx + publicMarker.length));
  } catch (_) {
    return null;
  }
  return null;
}

export async function uploadAndSignImage(
  db: any,
  bucket: string,
  path: string,
  bytes: Uint8Array,
  ttlSeconds = IMAGE_SIGNED_TTL_SECONDS,
): Promise<{ path: string; signedUrl: string }> {
  const up = await db.storage.from(bucket).upload(path, bytes, {
    contentType: 'image/png',
    upsert: false,
  });
  if (up.error) throw up.error;
  const { data, error } = await db.storage.from(bucket).createSignedUrl(path, ttlSeconds);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error(`no signed url for ${path}`);
  return { path, signedUrl: data.signedUrl };
}