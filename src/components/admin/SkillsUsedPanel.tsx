import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface SkillUsageRow {
  id: string;
  stage: string;
  skill_key: string;
  skill_version: string;
  loaded_at: string;
  input_reference_ids: unknown;
  output_asset_ids: unknown;
  pass_fail_result: string;
}

export function SkillsUsedPanel({ runId, bookId }: { runId?: string | null; bookId?: string | null }) {
  const [rows, setRows] = useState<SkillUsageRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    async function load() {
      setLoading(true);
      let q = supabase.from("run_skill_usage").select("*").order("loaded_at", { ascending: true });
      if (runId) q = q.eq("run_id", runId);
      else if (bookId) q = q.eq("book_id", bookId);
      else { setRows([]); setLoading(false); return; }
      const { data } = await q;
      if (!cancel) { setRows((data as SkillUsageRow[]) ?? []); setLoading(false); }
    }
    load();
    return () => { cancel = true; };
  }, [runId, bookId]);

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Skills Used</h3>
          <span className="text-xs text-muted-foreground">{rows.length} record{rows.length === 1 ? "" : "s"}</span>
        </div>
        {loading && <p className="text-xs text-muted-foreground">Loading skill usage…</p>}
        {!loading && rows.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No skill usage recorded yet. Stages that ran without a registered contract will block release.
          </p>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-2">Stage</th>
                  <th className="py-1 pr-2">Skill</th>
                  <th className="py-1 pr-2">Version</th>
                  <th className="py-1 pr-2">Inputs</th>
                  <th className="py-1 pr-2">Outputs</th>
                  <th className="py-1 pr-2">Result</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const inputs = Array.isArray(r.input_reference_ids) ? (r.input_reference_ids as string[]) : [];
                  const outputs = Array.isArray(r.output_asset_ids) ? (r.output_asset_ids as string[]) : [];
                  const tone =
                    r.pass_fail_result === "pass" ? "default" :
                    r.pass_fail_result === "fail" ? "destructive" : "secondary";
                  return (
                    <tr key={r.id} className="border-t border-border/40">
                      <td className="py-1 pr-2 font-mono">{r.stage}</td>
                      <td className="py-1 pr-2 font-medium">{r.skill_key}</td>
                      <td className="py-1 pr-2 font-mono">{r.skill_version}</td>
                      <td className="py-1 pr-2 font-mono">{inputs.length ? inputs.join(", ") : "—"}</td>
                      <td className="py-1 pr-2 font-mono">{outputs.length ? outputs.join(", ") : "—"}</td>
                      <td className="py-1 pr-2"><Badge variant={tone as never}>{r.pass_fail_result}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
