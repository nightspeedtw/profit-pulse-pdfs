// Pure builders for the Drive importer. No Deno / network imports so the
// persistence contract can be unit-tested from vitest.
//
// Contract: the thumbnail the importer fetches MUST be written to
// drive_products.cover_url, because that is the field /shop renders.

export type DriveFileLite = {
  id: string;
  name: string;
  modifiedTime?: string;
  size?: string;
  parents?: string[];
  thumbnailLink?: string;
};

export type DriveProductRowInput = {
  file: DriveFileLite;
  parentName: string;
  category: 'coloring' | 'storybook';
  title: string;
  baseSlug: string;
  priceCents: number;
  pdfUrl: string | null;
  storagePath: string;
  byteLength: number;
  hash: string;
  thumbUrl: string | null;
  isExisting: boolean;
};

export function buildDriveProductRow(i: DriveProductRowInput) {
  return {
    drive_file_id: i.file.id,
    drive_modified_time: i.file.modifiedTime,
    drive_parent_folder_id: i.file.parents?.[0] ?? null,
    drive_parent_folder_name: i.parentName,
    category: i.category,
    title: i.title,
    slug: i.isExisting ? undefined : `${i.baseSlug}-${i.file.id.slice(0, 6)}`,
    price_cents: i.priceCents,
    pdf_url: i.pdfUrl,
    pdf_storage_path: i.storagePath,
    cover_url: i.thumbUrl,
    file_size_bytes: i.file.size ? Number(i.file.size) : i.byteLength,
    sha256: i.hash,
    status: 'live',
    import_error: i.thumbUrl
      ? null
      : `thumb-debug: hadLink=${!!i.file.thumbnailLink} link=${(i.file.thumbnailLink || '').slice(0, 80)}`,
  };
}

/** An already-imported, unchanged product still needs a cover fetched. */
export function needsCoverBackfill(existing: { cover_url?: string | null }): boolean {
  const c = existing.cover_url;
  return !c || c === '/placeholder.svg';
}
