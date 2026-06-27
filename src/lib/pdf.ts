import { supabase } from "@/integrations/supabase/client";

export async function downloadAdminPdf(ebookId: string, title?: string | null) {
  const { data, error } = await supabase.functions.invoke("download-pdf", {
    body: { ebook_id: ebookId },
  });
  if (error) throw error;

  const blob = data instanceof Blob
    ? data
    : new Blob([data as BlobPart], { type: "application/pdf" });
  const pdfBlob = blob.type === "application/pdf" ? blob : blob.slice(0, blob.size, "application/pdf");
  const url = URL.createObjectURL(pdfBlob);

  const base = (title ?? "ebook")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "ebook";

  const a = document.createElement("a");
  a.href = url;
  a.download = `${base}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// Back-compat
export const openAdminPdf = downloadAdminPdf;
