// Admin: Royalty V1 configuration + ledger inspector.
// Enable royalty per book, set pool size/price/reserve, run accrual for a specific order.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Loader2, Play, Shield, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

interface Cfg {
  id: string;
  book_id: string;
  book_kind: string;
  enabled: boolean;
  total_shares: number;
  reserve_shares: number;
  price_per_share_cents: number;
  royalty_pct_of_net: number;
}
interface Ledger {
  entry_id: string;
  txn_id: string;
  account_type: string;
  user_id: string | null;
  book_id: string | null;
  direction: string;
  amount_cents: number;
  source: string;
  source_ref: string;
  memo: string | null;
  created_at: string;
}
interface KycRow { id: string; user_id: string; status: string; provider: string; submitted_at: string | null; rejection_reason: string | null; }
interface PayoutRow { id: string; user_id: string; amount_cents: number; status: string; requested_at: string; paid_at: string | null; admin_notes: string | null; }


function usd(cents: number) { return `$${(Number(cents || 0) / 100).toFixed(2)}`; }

export default function RoyaltyConfig() {
  const [live, setLive] = useState(false);
  const [payoutsLive, setPayoutsLive] = useState(false);
  const [kycRequired, setKycRequired] = useState(true);
  const [minPayoutUsd, setMinPayoutUsd] = useState(50);
  const [loading, setLoading] = useState(true);
  const [cfgs, setCfgs] = useState<Cfg[]>([]);
  const [ledger, setLedger] = useState<Ledger[]>([]);
  const [kycRows, setKycRows] = useState<KycRow[]>([]);
  const [payoutRows, setPayoutRows] = useState<PayoutRow[]>([]);
  const [addBookId, setAddBookId] = useState("");
  const [addKind, setAddKind] = useState<"kids" | "adult" | "coloring_v2">("kids");
  const [accrueOrderId, setAccrueOrderId] = useState("");
  const [running, setRunning] = useState(false);


  async function load() {
    setLoading(true);
    const [{ data: ps }, { data: c }, { data: l }, { data: settings }, { data: kyc }, { data: pouts }] = await Promise.all([
      supabase.from("platform_settings").select("royalty_live").limit(1).maybeSingle(),
      supabase.from("roy_book_config").select("*").order("updated_at", { ascending: false }),
      supabase.from("roy_ledger").select("*").order("created_at", { ascending: false }).limit(100),
      supabase.from("platform_settings").select("key,value_json").in("key", ["royalty_payouts_live", "royalty_kyc_required", "royalty_min_payout_usd"]),
      supabase.from("roy_kyc_submissions").select("id,user_id,status,provider,submitted_at,rejection_reason").order("created_at", { ascending: false }).limit(50),
      supabase.from("roy_payout_requests").select("id,user_id,amount_cents,status,requested_at,paid_at,admin_notes").order("created_at", { ascending: false }).limit(50),
    ]);
    setLive(!!(ps as any)?.royalty_live);
    setCfgs((c ?? []) as Cfg[]);
    setLedger((l ?? []) as Ledger[]);
    setKycRows((kyc ?? []) as KycRow[]);
    setPayoutRows((pouts ?? []) as PayoutRow[]);
    for (const row of (settings ?? []) as any[]) {
      if (row.key === "royalty_payouts_live") setPayoutsLive(row.value_json === true);
      if (row.key === "royalty_kyc_required") setKycRequired(row.value_json !== false);
      if (row.key === "royalty_min_payout_usd") setMinPayoutUsd(Number(row.value_json ?? 50));
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function toggleLive(next: boolean) {
    const { error } = await supabase.from("platform_settings").update({ royalty_live: next } as any).eq("key", "royalty_fee_pct");
    if (error) return toast.error(error.message);
    setLive(next);
    toast.success(next ? "Royalty engine LIVE" : "Royalty engine paused");
  }

  async function setJsonSetting(key: string, value: unknown, label: string) {
    const { error } = await supabase.from("platform_settings").update({ value_json: value } as any).eq("key", key);
    if (error) return toast.error(error.message);
    toast.success(`${label} updated`);
    load();
  }

  async function reviewKyc(id: string, status: "approved" | "rejected", reason?: string) {
    const patch: any = { status, reviewed_at: new Date().toISOString() };
    if (status === "rejected" && reason) patch.rejection_reason = reason;
    const { error } = await supabase.from("roy_kyc_submissions").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(`KYC ${status}`);
    load();
  }

  async function reviewPayout(id: string, action: "approve" | "reject" | "mark_paid" | "cancel") {
    const { data, error } = await supabase.functions.invoke("royalty-payout-review", {
      body: { request_id: id, action },
    });
    if (error) return toast.error(error.message);
    if ((data as any)?.error) return toast.error((data as any).error);
    toast.success(`Payout ${action}`);
    load();
  }


  async function addBook() {
    if (!addBookId) return;
    const { error } = await supabase.from("roy_book_config").insert({
      book_id: addBookId, book_kind: addKind, enabled: false,
      total_shares: 1000, reserve_shares: 0, price_per_share_cents: 100, royalty_pct_of_net: 0.20,
    } as any);
    if (error) return toast.error(error.message);
    setAddBookId("");
    load();
  }

  async function updateCfg(id: string, patch: Partial<Cfg>) {
    const { error } = await supabase.from("roy_book_config").update(patch as any).eq("id", id);
    if (error) return toast.error(error.message);
    load();
  }

  async function runAccrual() {
    if (!accrueOrderId) return;
    setRunning(true);
    const { data, error } = await supabase.functions.invoke("royalty-accrue-order", {
      body: { order_id: accrueOrderId },
    });
    setRunning(false);
    if (error) return toast.error(error.message);
    toast.success(JSON.stringify(data).slice(0, 200));
    load();
  }

  const totalAccrued = useMemo(
    () => ledger.filter((e) => e.account_type === "shareholder_accrued" && e.direction === "debit")
      .reduce((a, e) => a + Number(e.amount_cents), 0),
    [ledger]
  );

  if (loading) return <div className="p-8"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            {live ? <Shield className="text-emerald-600" /> : <ShieldAlert className="text-amber-600" />}
            Royalty Configuration
          </h1>
          <p className="text-sm text-muted-foreground">Phase 2 backend. Buying and payouts are Phase 3.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm">Engine Live</span>
          <Switch checked={live} onCheckedChange={toggleLive} />
        </div>
      </div>

      {!live && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="py-3 text-sm text-amber-900">
            Kill switch OFF — accruals are skipped. Flip the switch above to enable the ledger.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Add book to royalty pool</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2 items-end">
          <div>
            <label className="text-xs text-muted-foreground">Book ID</label>
            <Input value={addBookId} onChange={(e) => setAddBookId(e.target.value)} placeholder="uuid" className="w-[340px]" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Kind</label>
            <select value={addKind} onChange={(e) => setAddKind(e.target.value as any)} className="border rounded px-2 h-10">
              <option value="kids">kids</option>
              <option value="adult">adult</option>
              <option value="coloring_v2">coloring_v2</option>
            </select>
          </div>
          <Button onClick={addBook}>Add</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Configured books ({cfgs.length})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-3">Book ID</th>
                <th className="py-2 pr-3">Kind</th>
                <th className="py-2 pr-3">Enabled</th>
                <th className="py-2 pr-3">Total Shares</th>
                <th className="py-2 pr-3">Reserve</th>
                <th className="py-2 pr-3">Price/Share</th>
                <th className="py-2 pr-3">Royalty %</th>
              </tr>
            </thead>
            <tbody>
              {cfgs.map((c) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="py-2 pr-3 font-mono text-xs">{c.book_id.slice(0, 8)}…</td>
                  <td className="py-2 pr-3"><Badge variant="outline">{c.book_kind}</Badge></td>
                  <td className="py-2 pr-3">
                    <Switch checked={c.enabled} onCheckedChange={(v) => updateCfg(c.id, { enabled: v })} />
                  </td>
                  <td className="py-2 pr-3">
                    <Input type="number" defaultValue={c.total_shares} className="w-24"
                      onBlur={(e) => updateCfg(c.id, { total_shares: Number(e.target.value) })} />
                  </td>
                  <td className="py-2 pr-3">
                    <Input type="number" defaultValue={c.reserve_shares} className="w-24"
                      onBlur={(e) => updateCfg(c.id, { reserve_shares: Number(e.target.value) })} />
                  </td>
                  <td className="py-2 pr-3">
                    <Input type="number" defaultValue={c.price_per_share_cents} className="w-24"
                      onBlur={(e) => updateCfg(c.id, { price_per_share_cents: Number(e.target.value) })} />
                    <div className="text-[10px] text-muted-foreground">{usd(c.price_per_share_cents)}</div>
                  </td>
                  <td className="py-2 pr-3">
                    <Input type="number" step="0.01" defaultValue={c.royalty_pct_of_net} className="w-20"
                      onBlur={(e) => updateCfg(c.id, { royalty_pct_of_net: Number(e.target.value) })} />
                  </td>
                </tr>
              ))}
              {cfgs.length === 0 && (
                <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">No books configured</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Run accrual for an order</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2 items-end">
          <div>
            <label className="text-xs text-muted-foreground">Order ID</label>
            <Input value={accrueOrderId} onChange={(e) => setAccrueOrderId(e.target.value)} placeholder="uuid" className="w-[340px]" />
          </div>
          <Button onClick={runAccrual} disabled={running || !accrueOrderId}>
            {running ? <Loader2 className="animate-spin h-4 w-4" /> : <Play className="h-4 w-4" />}
            Accrue
          </Button>
          <p className="text-xs text-muted-foreground">Idempotent — safe to re-run.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Payout & KYC settings</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-3 gap-4 items-end">
          <div className="flex items-center justify-between border rounded p-3">
            <div>
              <div className="text-sm font-medium">Payouts live</div>
              <div className="text-xs text-muted-foreground">Required to mark payouts as paid</div>
            </div>
            <Switch checked={payoutsLive} onCheckedChange={(v) => { setPayoutsLive(v); setJsonSetting("royalty_payouts_live", v, "Payouts live"); }} />
          </div>
          <div className="flex items-center justify-between border rounded p-3">
            <div>
              <div className="text-sm font-medium">KYC required</div>
              <div className="text-xs text-muted-foreground">Block payout requests without approved KYC</div>
            </div>
            <Switch checked={kycRequired} onCheckedChange={(v) => { setKycRequired(v); setJsonSetting("royalty_kyc_required", v, "KYC required"); }} />
          </div>
          <div className="border rounded p-3">
            <label className="text-xs text-muted-foreground">Minimum payout (USD)</label>
            <Input type="number" min="1" defaultValue={minPayoutUsd}
              onBlur={(e) => { const n = Number(e.target.value); setMinPayoutUsd(n); setJsonSetting("royalty_min_payout_usd", n, "Min payout"); }} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>KYC queue ({kycRows.length})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-3">User</th>
                <th className="py-2 pr-3">Provider</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Submitted</th>
                <th className="py-2 pr-3">Reason</th>
                <th className="py-2 pr-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {kycRows.map((k) => (
                <tr key={k.id} className="border-b last:border-0">
                  <td className="py-2 pr-3 font-mono text-xs">{k.user_id.slice(0, 8)}…</td>
                  <td className="py-2 pr-3">{k.provider}</td>
                  <td className="py-2 pr-3"><Badge variant="outline">{k.status}</Badge></td>
                  <td className="py-2 pr-3 text-xs">{k.submitted_at ? new Date(k.submitted_at).toLocaleString() : "—"}</td>
                  <td className="py-2 pr-3 text-xs text-muted-foreground">{k.rejection_reason ?? "—"}</td>
                  <td className="py-2 pr-3 flex gap-2">
                    {k.status === "pending" && (
                      <>
                        <Button size="sm" variant="default" onClick={() => reviewKyc(k.id, "approved")}>Approve</Button>
                        <Button size="sm" variant="outline" onClick={() => { const r = prompt("Rejection reason?") ?? ""; if (r) reviewKyc(k.id, "rejected", r); }}>Reject</Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {kycRows.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No submissions</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Payout queue ({payoutRows.length})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-3">User</th>
                <th className="py-2 pr-3 text-right">Amount</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Requested</th>
                <th className="py-2 pr-3">Paid</th>
                <th className="py-2 pr-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {payoutRows.map((p) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="py-2 pr-3 font-mono text-xs">{p.user_id.slice(0, 8)}…</td>
                  <td className="py-2 pr-3 text-right font-medium">{usd(p.amount_cents)}</td>
                  <td className="py-2 pr-3"><Badge variant="outline">{p.status}</Badge></td>
                  <td className="py-2 pr-3 text-xs">{new Date(p.requested_at).toLocaleString()}</td>
                  <td className="py-2 pr-3 text-xs">{p.paid_at ? new Date(p.paid_at).toLocaleString() : "—"}</td>
                  <td className="py-2 pr-3 flex flex-wrap gap-2">
                    {p.status === "requested" && (
                      <>
                        <Button size="sm" onClick={() => reviewPayout(p.id, "approve")}>Approve</Button>
                        <Button size="sm" variant="outline" onClick={() => reviewPayout(p.id, "reject")}>Reject</Button>
                      </>
                    )}
                    {p.status === "approved" && (
                      <>
                        <Button size="sm" disabled={!payoutsLive} title={payoutsLive ? "" : "Enable payouts_live first"} onClick={() => reviewPayout(p.id, "mark_paid")}>Mark paid</Button>
                        <Button size="sm" variant="outline" onClick={() => reviewPayout(p.id, "cancel")}>Cancel</Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {payoutRows.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No requests</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>



      <Card>
        <CardHeader>
          <CardTitle>Ledger (last 100)</CardTitle>
          <p className="text-xs text-muted-foreground">Total shareholder accrued in view: {usd(totalAccrued)}</p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b">
                <th className="py-1 pr-2">When</th>
                <th className="py-1 pr-2">Txn</th>
                <th className="py-1 pr-2">Account</th>
                <th className="py-1 pr-2">Dir</th>
                <th className="py-1 pr-2 text-right">Amount</th>
                <th className="py-1 pr-2">User</th>
                <th className="py-1 pr-2">Book</th>
                <th className="py-1 pr-2">Source</th>
                <th className="py-1 pr-2">Memo</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((e) => (
                <tr key={e.entry_id} className="border-b last:border-0">
                  <td className="py-1 pr-2 whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</td>
                  <td className="py-1 pr-2 font-mono">{e.txn_id.slice(0, 8)}</td>
                  <td className="py-1 pr-2"><Badge variant="outline">{e.account_type}</Badge></td>
                  <td className="py-1 pr-2">{e.direction}</td>
                  <td className="py-1 pr-2 text-right">{usd(e.amount_cents)}</td>
                  <td className="py-1 pr-2 font-mono">{e.user_id?.slice(0, 8) ?? "—"}</td>
                  <td className="py-1 pr-2 font-mono">{e.book_id?.slice(0, 8) ?? "—"}</td>
                  <td className="py-1 pr-2">{e.source}:{e.source_ref.slice(0, 8)}</td>
                  <td className="py-1 pr-2">{e.memo}</td>
                </tr>
              ))}
              {ledger.length === 0 && (
                <tr><td colSpan={9} className="py-6 text-center text-muted-foreground">No ledger entries</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
