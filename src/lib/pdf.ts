import { supabase } from "@/integrations/supabase/client";

export async function openAdminPdf(ebookId: string) {
  const { data, error } = await supabase.functions.invoke("download-pdf", {
    body: { ebook_id: ebookId },
  });

  if (error) throw error;

  const blob = data instanceof Blob
    ? data
    : new Blob([data as BlobPart], { type: "application/pdf" });
  const pdfBlob = blob.type === "application/pdf" ? blob : blob.slice(0, blob.size, "application/pdf");
  const url = URL.createObjectURL(pdfBlob);
  window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}