import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAccountAuth } from "@/hooks/useAccountAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TrendingUp, ShieldCheck, ShieldAlert, Send } from "lucide-react";
import { toast } from "sonner";

interface Holding { book_id: string; book_kind: string; shares: number; avg_cost_cents: number; }
interface Summary { book_id: string; book_kind: string; accrued_cents: number; paid_cents: number; }
interface Kyc { id: string; status: string; provider: string; rejection_reason: string | null; submitted_at: string | null; }
interface Payout { id: string; amount_cents: number; status: string; requested_at: string; paid_at: string | null; admin_notes: string | null; }

const usd = (cents: number) => `$${(Number(cents || 0) / 100).toFixed(2)}`;

export default function AccountRoyalties() {
  const { user } = useAccountAuth();
  const [loading, setLoading] = useState(true);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [summary, setSummary] = useState<Record<string, Summary>>({});
  const [kyc, setKyc] = useState<Kyc | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [availableCents, setAvailableCents] = useState(0);
  const [live, setLive] = useState(false);
  const [payoutsLive, setPayoutsLive] = useState(false);
  const [minPayoutUsd, setMinPayoutUsd] = useState(50);
  const [amountInput, setAmountInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [startingKyc, setStartingKyc] = useState(false);

  async function load() {
    if (!user) return;
    setLoading(true);
    const [{ data: h }, { data: s }, { data: k }, { data: p }, { data: avail }, { data: settings }] = await Promise.all([
      supabase.from("roy_holdings").select("book_id,book_kind,shares,avg_cost_cents").eq("user_id", user.id),
      supabase.from("roy_accrual_summary").select("book_id,book_kind,accrued_cents,paid_cents").eq("user_id", user.id),
      supabase.from("roy_kyc_submissions").select("id,status,provider,rejection_reason,submitted_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("roy_payout_requests").select("id,amount_cents,status,requested_at,paid_at,admin_notes").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.rpc("roy_available_cents", { p_user: user.id }),
      supabase.from("platform_settings").select("key,value_json,royalty_live").in("key", ["royalty_payouts_live", "royalty_min_payout_usd", "royalty_fee_pct"]),
    ]);
    setHoldings((h ?? []) as Holding[]);
    const map: Record<string, Summary> = {};
    for (const row of (s ?? []) as Summary[]) map[`${row.book_id}:${row.book_kind}`] = row;
    setSummary(map);
    setKyc((k ?? null) as Kyc | null);
    setPayouts((p ?? []) as Payout[]);
    setAvailableCents(Number(avail ?? 0));
    for (const row of (settings ?? []) as any[]) {
      if (row.key === "royalty_payouts_live") setPayoutsLive(row.value_json === true);
      if (row.key === "royalty_min_payout_usd") setMinPayoutUsd(Number(row.value_json ?? 50));
      if (row.key === "royalty_fee_pct") setLive(!!row.royalty_live);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [user]);

  async function startKyc() {
    if (!user) return;
    setStartingKyc(true);
    const { error } = await supabase.from("roy_kyc_submissions").insert({
      user_id: user.id, provider: "sumsub", status: "pending", tier: "basic",
      submitted_at: new Date().toISOString(),
    } as any);
    setStartingKyc(false);
    if (error) return toast.error(error.message);
    toast.success("Verification submitted — awaiting admin review");
    load();
  }

  async function requestPayout() {
    const usdAmt = Number(amountInput);
    if (!usdAmt || usdAmt <= 0) return toast.error("Enter an amount");
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("royalty-payout-request", {
      body: { amount_cents: Math.floor(usdAmt * 100), method: "pending", destination: {} },
    });
    setSubmitting(false);
    if (error) return toast.error(error.message);
    if ((data as any)?.error) return toast.error((data as any).error);
    toast.success("Payout requested — sandbox only");
    setAmountInput("");
    load();
  }

  if (loading) return <Skeleton className="h-64" />;

  const kycStatus = kyc?.status ?? "not_started";
  const kycApproved = kycStatus === "approved";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <TrendingUp className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold">My Royalties</h1>
        <Badge variant={live ? "default" : "secondary"}>{live ? "Live" : "Preview"}</Badge>
        <Badge variant="outline">Payouts: sandbox</Badge>
      </div>

      {!live && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="py-4 text-sm text-amber-900">
            Royalty participation is in preview. Accruals are paused; payout requests are recorded but not paid until launch.
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {kycApproved ? <ShieldCheck className="h-5 w-5 text-emerald-600" /> : <ShieldAlert className="h-5 w-5 text-amber-600" />}
              Identity Verification
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Status:</span>
              <Badge variant={kycApproved ? "default" : "outline"}>{kycStatus}</Badge>
              {kyc?.provider && <span className="text-xs text-muted-foreground">via {kyc.provider}</span>}
            </div>
            {kyc?.rejection_reason && (
              <p className="text-xs text-destructive">Reason: {kyc.rejection_reason}</p>
            )}
            {kycStatus === "not_started" || kycStatus === "rejected" || kycStatus === "expired" ? (
              <Button onClick={startKyc} disabled={startingKyc} size="sm">
                {startingKyc ? "Submitting…" : "Start verification"}
              </Button>
            ) : kycStatus === "pending" ? (
              <p className="text-xs text-muted-foreground">Submitted — awaiting admin review.</p>
            ) : (
              <p className="text-xs text-emerald-700">You're verified and can request payouts.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Send className="h-5 w-5" /> Request Payout</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Available balance: <span className="font-semibold text-foreground">{usd(availableCents)}</span>
              <span className="ml-2 text-xs">(min payout {`$${minPayoutUsd}`})</span>
            </div>
            <div className="flex gap-2">
              <Input
                type="number" min="0" step="0.01"
                placeholder="Amount USD"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                disabled={!kycApproved}
              />
              <Button onClick={requestPayout} disabled={submitting || !kycApproved || !amountInput}>
                {submitting ? "Sending…" : "Request"}
              </Button>
            </div>
            {!kycApproved && (
              <p className="text-xs text-amber-700">Complete identity verification first.</p>
            )}
            {!payoutsLive && (
              <p className="text-xs text-muted-foreground">Requests are recorded to the admin queue. No money moves until payouts_live is enabled.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {payouts.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Payout history</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 pr-4">Requested</th>
                    <th className="py-2 pr-4 text-right">Amount</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Paid</th>
                    <th className="py-2 pr-4">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {payouts.map((p) => (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="py-2 pr-4">{new Date(p.requested_at).toLocaleString()}</td>
                      <td className="py-2 pr-4 text-right font-medium">{usd(p.amount_cents)}</td>
                      <td className="py-2 pr-4"><Badge variant="outline">{p.status}</Badge></td>
                      <td className="py-2 pr-4">{p.paid_at ? new Date(p.paid_at).toLocaleString() : "—"}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{p.admin_notes ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {holdings.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <p className="text-lg font-medium mb-2">No royalty holdings yet</p>
            <p className="text-sm">Royalty participation opens soon. When available, purchased shares will appear here.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader><CardTitle>Holdings</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 pr-4">Book</th>
                    <th className="py-2 pr-4">Kind</th>
                    <th className="py-2 pr-4 text-right">Shares</th>
                    <th className="py-2 pr-4 text-right">Avg Cost</th>
                    <th className="py-2 pr-4 text-right">Accrued</th>
                    <th className="py-2 pr-4 text-right">Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((h) => {
                    const s = summary[`${h.book_id}:${h.book_kind}`];
                    return (
                      <tr key={`${h.book_id}:${h.book_kind}`} className="border-b last:border-0">
                        <td className="py-2 pr-4 font-mono text-xs truncate max-w-[220px]">{h.book_id}</td>
                        <td className="py-2 pr-4"><Badge variant="outline">{h.book_kind}</Badge></td>
                        <td className="py-2 pr-4 text-right">{h.shares.toLocaleString()}</td>
                        <td className="py-2 pr-4 text-right">{usd(h.avg_cost_cents)}</td>
                        <td className="py-2 pr-4 text-right font-medium text-emerald-700">{usd(s?.accrued_cents ?? 0)}</td>
                        <td className="py-2 pr-4 text-right text-muted-foreground">{usd(s?.paid_cents ?? 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
