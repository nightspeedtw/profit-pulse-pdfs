import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export async function freeDownload(ebookId: string, title?: string) {
  const t = toast.loading(`Preparing ${title ?? "download"}…`);
  try {
    const { data, error } = await supabase.functions.invoke("free-download", {
      body: { ebook_id: ebookId },
    });
    if (error || !data?.url) throw new Error(error?.message || data?.error || "Download failed");
    window.open(data.url, "_blank");
    toast.success("Download started", { id: t });
  } catch (e) {
    toast.error((e as Error).message, { id: t });
  }
}
