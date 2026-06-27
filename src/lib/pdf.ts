import { supabase } from "@/integrations/supabase/client";

export async function openAdminPdf(ebookId: string) {
  const popup = window.open("about:blank", "_blank");
  if (!popup) throw new Error("Popup blocked. Allow popups for this site, then try again.");

  const { data, error } = await supabase.functions.invoke("download-pdf", {
    body: { ebook_id: ebookId },
  });

  if (error) {
    popup.close();
    throw error;
  }

  const blob = data instanceof Blob
    ? data
    : new Blob([data as BlobPart], { type: "application/pdf" });
  const pdfBlob = blob.type === "application/pdf" ? blob : blob.slice(0, blob.size, "application/pdf");
  const url = URL.createObjectURL(pdfBlob);
  popup.location.href = url;
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}