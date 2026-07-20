// Admin dashboard for Marketing Autopilot Phase 2.
// Shows: feature flag, active campaigns, upcoming campaigns, current bundles,
// and a "Run Now" button that invokes marketing-autopilot-tick with force=true.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, Play, Sparkles, Package, CalendarDays } from "lucide-react";

interface Campaign {
  id: string;
  slug: string;
  name: string;
  status: string;
  starts_at: string;
  ends_at: string;
  discount_pct: number;
  season_key: string | null;
  priority: number;
}

interface Bundle {
  id: string;
  slug: string;
  title: string;
  age_band: string;
  bundle_price_cents: number;
  members_total_cents: number;
  savings_cents: number;
  savings_pct: number;
  member_ids: string[];
  status: string;
  activated_at: string | null;
}

function usd(cents: number) { return `$${(cents / 100).toFixed(2)}`; }
function fmt(dt: string) { return new Date(dt).toLocaleString(); }

export default function MarketingAutopilot() {
  const [flagEnabled, setFlagEnabled] = useState<boolean | null>(null);
  const [active, setActive] = useState<Campaign[]>([]);
  const [upcoming, setUpcoming] = useState<Campaign[]>([]);
  const [ended, setEnded] = useState<Campaign[]>([]);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [busy, setBusy] = useState(false);
  const [tickResult, setTickResult] = useState<string | null>(null);

  const load = async () => {
    const [flag, camps, bnd] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("platform_settings") as any).select("value_json").eq("key", "marketing_autopilot_v2_enabled").maybeSingle(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("campaigns") as any).select("*").order("starts_at", { ascending: true }).limit(200),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("bundles") as any).select("*").eq("status", "live").order("activated_at", { ascending: false }).limit(50),
    ]);
    setFlagEnabled(flag.data?.value_json === true || flag.data?.value_json === "true");
    const rows = (camps.data ?? []) as Campaign[];
    setActive(rows.filter((r) => r.status === "live"));
    setUpcoming(rows.filter((r) => r.status === "scheduled" || r.status === "draft"));
    setEnded(rows.filter((r) => r.status === "ended").slice(-10));
    setBundles((bnd.data ?? []) as Bundle[]);
  };

  useEffect(() => { void load(); }, []);

  const runNow = async () => {
    setBusy(true);
    setTickResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("marketing-autopilot-tick", { body: { force: true } });
      if (error) throw error;
      setTickResult(JSON.stringify(data, null, 2));
      await load();
    } catch (e) {
      setTickResult(`ERROR: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleFlag = async () => {
    const next = !flagEnabled;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("platform_settings") as any).upsert(
      { key: "marketing_autopilot_v2_enabled", value_json: next },
      { onConflict: "key" },
    );
    setFlagEnabled(next);
  };

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Marketing Autopilot v2</h1>
          <p className="text-sm text-muted-foreground">Seasonal calendar, campaigns, and bundle composer.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant={flagEnabled ? "default" : "outline"} onClick={toggleFlag} size="sm">
            {flagEnabled ? "Autopilot: ON" : "Autopilot: OFF"}
          </Button>
          <Button onClick={runNow} disabled={busy} size="sm">
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            Run tick now
          </Button>
        </div>
      </header>

      <section className="rounded-2xl border p-4">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <Sparkles className="h-5 w-5" /> Live campaigns ({active.length})
        </h2>
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">No campaigns currently live.</p>
        ) : (
          <div className="space-y-2">
            {active.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {c.slug} · save {c.discount_pct}% · ends {fmt(c.ends_at)}
                  </div>
                </div>
                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">LIVE</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border p-4">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <CalendarDays className="h-5 w-5" /> Upcoming ({upcoming.length})
        </h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">No upcoming campaigns queued. Run the tick to sync the calendar.</p>
        ) : (
          <div className="space-y-1 text-sm">
            {upcoming.slice(0, 20).map((c) => (
              <div key={c.id} className="flex justify-between border-b py-1">
                <span>{c.name} <span className="text-muted-foreground">· {c.discount_pct}%</span></span>
                <span className="text-muted-foreground">{fmt(c.starts_at)} → {fmt(c.ends_at)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border p-4">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <Package className="h-5 w-5" /> Live bundles ({bundles.length})
        </h2>
        {bundles.length === 0 ? (
          <p className="text-sm text-muted-foreground">No bundles composed yet.</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {bundles.map((b) => (
              <div key={b.id} className="rounded-lg border p-3">
                <div className="font-medium">{b.title}</div>
                <div className="text-xs text-muted-foreground">
                  Ages {b.age_band} · {b.member_ids.length} books · activated {b.activated_at ? fmt(b.activated_at) : "—"}
                </div>
                <div className="mt-1 text-sm">
                  <strong>{usd(b.bundle_price_cents)}</strong>{" "}
                  <span className="text-muted-foreground line-through">{usd(b.members_total_cents)}</span>{" "}
                  <span className="text-primary">save {b.savings_pct}%</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {ended.length > 0 && (
        <section className="rounded-2xl border p-4">
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Recently ended ({ended.length})</h2>
          <div className="space-y-1 text-xs text-muted-foreground">
            {ended.map((c) => (
              <div key={c.id}>{c.name} · ended {fmt(c.ends_at)}</div>
            ))}
          </div>
        </section>
      )}

      {tickResult && (
        <section className="rounded-2xl border p-4">
          <h2 className="mb-2 text-sm font-semibold">Last tick result</h2>
          <pre className="max-h-96 overflow-auto rounded bg-muted p-3 text-xs">{tickResult}</pre>
        </section>
      )}
    </div>
  );
}
