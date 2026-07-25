// Admin overview of commercial subscriptions, credits, and claimed books.
import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface SubRow {
  id: string;
  user_id: string;
  plan_code: string;
  status: string;
  credits_per_period: number;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  environment: string;
  created_at: string;
}

interface OwnedRow {
  id: string;
  user_id: string;
  book_id: string;
  license_type: string;
  commercial_rights_active: boolean;
  purchase_source: string;
  granted_at: string;
}

export default function AdminCommercial() {
  const [loading, setLoading] = useState(true);
  const [subs, setSubs] = useState<SubRow[]>([]);
  const [owned, setOwned] = useState<OwnedRow[]>([]);

  useEffect(() => {
    (async () => {
      const [{ data: s }, { data: o }] = await Promise.all([
        supabase
          .from("commercial_subscriptions")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(200),
        supabase
          .from("book_licenses_owned")
          .select("*")
          .order("granted_at", { ascending: false })
          .limit(500),
      ]);
      setSubs((s as any) ?? []);
      setOwned((o as any) ?? []);
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <div className="py-24 flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const mrrCents = subs
    .filter((s) => ["active", "trialing", "past_due"].includes(s.status))
    .reduce((acc, s) => acc + (s.plan_code === "commercial_50" ? 24900 : 14900), 0);

  const claimedCommercial = owned.filter(
    (o) => o.license_type === "commercial" && o.commercial_rights_active
  ).length;

  return (
    <div className="container max-w-6xl py-8 space-y-8">
      <Helmet>
        <title>Admin · Commercial · SecretPDF</title>
      </Helmet>
      <h1 className="font-display text-3xl uppercase">Commercial subscriptions</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Active subs" value={String(subs.filter((s) => s.status === "active").length)} />
        <Stat label="MRR (est)" value={`$${(mrrCents / 100).toFixed(0)}`} />
        <Stat label="Commercial claims" value={String(claimedCommercial)} />
        <Stat label="Total licenses" value={String(owned.length)} />
      </div>

      <section>
        <h2 className="font-display text-xl uppercase mb-3">Subscriptions</h2>
        <div className="overflow-x-auto border-2 border-border rounded">
          <table className="min-w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left p-2">User</th>
                <th className="text-left p-2">Plan</th>
                <th className="text-left p-2">Status</th>
                <th className="text-left p-2">Credits/period</th>
                <th className="text-left p-2">Renewal</th>
                <th className="text-left p-2">Cancel@end</th>
                <th className="text-left p-2">Env</th>
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <td className="p-2 font-mono text-xs">{s.user_id.slice(0, 8)}…</td>
                  <td className="p-2">{s.plan_code}</td>
                  <td className="p-2">{s.status}</td>
                  <td className="p-2">{s.credits_per_period}</td>
                  <td className="p-2 text-xs">
                    {s.current_period_end
                      ? new Date(s.current_period_end).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="p-2">{s.cancel_at_period_end ? "yes" : ""}</td>
                  <td className="p-2 text-xs">{s.environment}</td>
                </tr>
              ))}
              {subs.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-muted-foreground">
                    No subscriptions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="font-display text-xl uppercase mb-3">Claimed books</h2>
        <div className="overflow-x-auto border-2 border-border rounded">
          <table className="min-w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left p-2">User</th>
                <th className="text-left p-2">Book</th>
                <th className="text-left p-2">License</th>
                <th className="text-left p-2">Rights active</th>
                <th className="text-left p-2">Source</th>
                <th className="text-left p-2">Granted</th>
              </tr>
            </thead>
            <tbody>
              {owned.slice(0, 100).map((o) => (
                <tr key={o.id} className="border-t border-border">
                  <td className="p-2 font-mono text-xs">{o.user_id.slice(0, 8)}…</td>
                  <td className="p-2 font-mono text-xs">{o.book_id.slice(0, 8)}…</td>
                  <td className="p-2">{o.license_type}</td>
                  <td className="p-2">{o.commercial_rights_active ? "yes" : ""}</td>
                  <td className="p-2 text-xs">{o.purchase_source}</td>
                  <td className="p-2 text-xs">{new Date(o.granted_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-4 border-2 border-foreground rounded-lg">
      <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="font-display text-2xl mt-1">{value}</div>
    </div>
  );
}
