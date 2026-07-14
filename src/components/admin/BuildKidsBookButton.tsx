import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { BookOpen, Loader2 } from "lucide-react";

interface Props {
  onStarted?: () => void;
}

/**
 * One-click autopilot builder.
 *
 * Runs the entire chain: concept → story → QC → cover → illustrations → PDF →
 * measured QC → published live. Uses sensible defaults (age 4-6, humor lane,
 * all repair lanes). No config, no dialog — one press = one live book (or a
 * plain-language reason if the quality budget is exhausted).
 */
export function BuildKidsBookButton({ onStarted }: Props) {
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("kids-one-click-build", {
        body: {
          age_band: "4-6",
          preferred_lanes: [
            "food_kitchen_chaos",
            "tiny_detective",
            "animal_buddy_mechanical",
            "neighborhood_micro_adventure",
            "shop_library_museum_logic",
          ],
        },
      });
      if (error) throw error;
      const started = data as { parent_run_id?: string; ebook_id?: string };
      toast({
        title: "Autopilot started",
        description: started?.parent_run_id
          ? `Parent run created. Watch progress below — auto-publishes when QC passes.`
          : "Started.",
      });
      onStarted?.();
    } catch (e) {
      toast({ title: "Failed to start", description: String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button size="lg" onClick={start} disabled={busy} className="gap-2">
      {busy ? (
        <>
          <Loader2 className="size-4 animate-spin" /> Starting…
        </>
      ) : (
        <>
          <BookOpen className="size-4" /> สร้างหนังสือ + ขึ้นขาย (Auto)
        </>
      )}
    </Button>
  );
}

export default BuildKidsBookButton;
