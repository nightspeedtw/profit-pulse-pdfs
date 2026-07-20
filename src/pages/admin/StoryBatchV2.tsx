import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, PlayCircle, ShieldCheck, ListChecks } from "lucide-react";
import { FEATURES } from "@/config/features";

type Batch = {
  id: string;
  label: string;
  status: string;
  budget_usd_cents: number;
  projected_cost_cents: number | null;
  actual_cost_cents: number;
  repair_reserve_pct: number;
  targets_by_age: Record<string, number>;
  blocker_reason: string | null;
  preflight_report: Record<string, unknown> | null;
  created_at: string;
};

type Book = {
  id: string;
  batch_id: string;
  age_band: string;
  slot_index: number;
  is_pilot: boolean;
  title: string | null;
  theme: string | null;
  stage: string;
  overall_qc_score: number | null;
  cost_cents: number;
  pdf_url: string | null;
  cover_url: string | null;
  last_error: string | null;
};

const AGE_LABELS: Record<string, string> = {
  age_2_4: "2–4",
  age_4_6: "4–6",
  age_6_8: "6–8",
  age_8_12: "8–12",
  age_13_17: "13–17",
};

export default function StoryBatchV2() {
  const enabled = FEATURES.ENABLE_STORY_BATCH_50_V2;
  const [batches, setBatches] = useState<Batch[]>([]);
  const [current, setCurrent] = useState<Batch | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data: bs } = await supabase
      .from("story_batch_v2_batches" as never)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    const list = (bs as Batch[] | null) ?? [];
    setBatches(list);
    const focus = current ? list.find((b) => b.id === current.id) ?? list[0] ?? null : list[0] ?? null;
    setCurrent(focus);
    if (focus) {
      const { data: bk } = await supabase
        .from("story_batch_v2_books" as never)
        .select("*")
        .eq("batch_id", focus.id)
        .order("age_band")
        .order("slot_index");
      setBooks((bk as Book[] | null) ?? []);
    } else {
      setBooks([]);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (enabled) load();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  async function invoke(fn: string, body: Record<string, unknown>, label: string) {
    setBusy(label);
    try {
      const { data, error } = await supabase.functions.invoke(fn, { body });
      if (error) throw error;
      toast.success(`${label} ok`);
      console.log(fn, data);
      await load();
    } catch (e) {
      toast.error(`${label} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  if (!enabled) {
    return (
      <div className="p-8 space-y-2">
        <h1 className="font-display text-2xl uppercase">Story Batch V2</h1>
        <p className="text-sm text-muted-foreground">
          Feature flag <code>ENABLE_STORY_BATCH_50_V2</code> is off. Enable it in{" "}
          <code>src/config/features.ts</code> to expose this pipeline.
        </p>
      </div>
    );
  }

  const budgetPct = current
    ? Math.min(100, (current.actual_cost_cents / current.budget_usd_cents) * 100)
    : 0;
  const byAge = books.reduce<Record<string, { total: number; done: number; failed: number }>>((acc, b) => {
    const a = (acc[b.age_band] ||= { total: 0, done: 0, failed: 0 });
    a.total++;
    if (b.stage === "final_pdf_ready") a.done++;
    if (b.stage === "failed_nonrecoverable" || b.stage === "retired") a.failed++;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl uppercase">Story Batch V2 — 50 English Illustrated Books</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Isolated additive pipeline. Hard $75 provider ceiling. Namespace: <code>story_batch_v2_</code>.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => invoke("story-batch-v2-preflight", {}, "Preflight new batch")}
            disabled={!!busy}
            variant="outline"
          >
            {busy === "Preflight new batch" ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            New Batch + Preflight
          </Button>
          {current && current.status === "queued" && (
            <Button
              onClick={() => invoke("story-batch-v2-plan-portfolio", { batch_id: current.id }, "Plan 50 concepts")}
              disabled={!!busy}
            >
              {busy === "Plan 50 concepts" ? <Loader2 className="size-4 animate-spin" /> : <ListChecks className="size-4" />}
              Plan 50 Concepts
            </Button>
          )}
        </div>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {batches.length === 0 && !loading && (
        <div className="border-2 border-dashed p-6 text-center text-sm text-muted-foreground">
          No batches yet. Click <b>New Batch + Preflight</b> to create one and run verification checks.
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        {batches.map((b) => (
          <button
            key={b.id}
            onClick={() => setCurrent(b)}
            className={`px-3 py-1.5 rounded-full border-2 text-xs font-mono ${
              current?.id === b.id ? "bg-foreground text-background" : "border-foreground"
            }`}
          >
            {b.label} · {b.status}
          </button>
        ))}
      </div>

      {current && (
        <>
          <div className="grid md:grid-cols-4 gap-3">
            <StatCard label="Status" value={current.status} />
            <StatCard
              label="Budget"
              value={`$${(current.actual_cost_cents / 100).toFixed(2)} / $${(current.budget_usd_cents / 100).toFixed(2)}`}
              sub={`${budgetPct.toFixed(1)}% used · ${current.repair_reserve_pct}% reserved`}
            />
            <StatCard
              label="Projected"
              value={
                current.projected_cost_cents != null
                  ? `$${(current.projected_cost_cents / 100).toFixed(2)}`
                  : "—"
              }
              sub={current.projected_cost_cents != null && current.projected_cost_cents <= current.budget_usd_cents ? "within ceiling" : "over ceiling"}
            />
            <StatCard
              label="Books"
              value={`${books.filter((b) => b.stage === "final_pdf_ready").length} / ${books.length || 50}`}
              sub={`${books.filter((b) => b.stage.startsWith("failed") || b.stage === "retired").length} failed`}
            />
          </div>

          {current.blocker_reason && (
            <div className="border-2 border-red-500 bg-red-50 dark:bg-red-950/20 p-3 text-sm">
              <div className="font-bold uppercase text-xs mb-1">Blocked</div>
              <div className="font-mono">{current.blocker_reason}</div>
            </div>
          )}

          {current.preflight_report && (
            <details className="border-2 border-foreground p-3">
              <summary className="cursor-pointer font-mono text-xs uppercase">Preflight report</summary>
              <pre className="text-xs mt-2 overflow-auto max-h-80">
                {JSON.stringify(current.preflight_report, null, 2)}
              </pre>
            </details>
          )}

          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {Object.entries(AGE_LABELS).map(([k, label]) => {
              const s = byAge[k] ?? { total: 0, done: 0, failed: 0 };
              return (
                <div key={k} className="border-2 border-foreground p-3">
                  <div className="text-xs font-mono uppercase text-muted-foreground">Ages {label}</div>
                  <div className="text-2xl font-display">{s.done}/{s.total || 10}</div>
                  <div className="text-xs">{s.failed} failed</div>
                </div>
              );
            })}
          </div>

          <div className="border-2 border-foreground">
            <div className="p-3 border-b-2 border-foreground bg-card font-mono uppercase text-xs">
              Books ({books.length})
            </div>
            {books.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No books planned yet. Run "Plan 50 Concepts" once the batch is queued.
              </div>
            ) : (
              <div className="overflow-auto max-h-[600px]">
                <table className="w-full text-sm">
                  <thead className="border-b-2 border-foreground bg-muted/30 sticky top-0">
                    <tr className="text-left">
                      <th className="p-2">Age</th>
                      <th className="p-2">#</th>
                      <th className="p-2">Title</th>
                      <th className="p-2">Theme</th>
                      <th className="p-2">Stage</th>
                      <th className="p-2">QC</th>
                      <th className="p-2">Cost</th>
                      <th className="p-2">PDF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {books.map((b) => (
                      <tr key={b.id} className="border-b hover:bg-muted/20">
                        <td className="p-2 font-mono text-xs">{AGE_LABELS[b.age_band] ?? b.age_band}{b.is_pilot && " ⭐"}</td>
                        <td className="p-2 font-mono">{b.slot_index}</td>
                        <td className="p-2 font-medium truncate max-w-[280px]">{b.title ?? "—"}</td>
                        <td className="p-2 text-xs text-muted-foreground">{b.theme}</td>
                        <td className="p-2 font-mono text-xs">{b.stage}</td>
                        <td className="p-2">{b.overall_qc_score ?? "—"}</td>
                        <td className="p-2">${(b.cost_cents / 100).toFixed(2)}</td>
                        <td className="p-2">
                          {b.pdf_url && (
                            <a href={b.pdf_url} target="_blank" rel="noreferrer" className="underline text-xs">
                              open
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border-2 border-foreground p-3">
      <div className="text-xs font-mono uppercase text-muted-foreground">{label}</div>
      <div className="text-lg font-display uppercase">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}
