import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { toast } from "@/components/ui/sonner";

type Row = Record<string, unknown>;

export default function RoyaltySettings() {
  const [markets, setMarkets] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const client = supabase as unknown as { from: (t: string) => { select: (s: string) => Promise<{ data: Row[] | null; error: Error | null }> } };
    const { data } = await client.from("book_royalty_markets").select("*");
    // Enrich with book titles
    const ids = (data ?? []).map((m) => String(m.book_id));
    const { data: books } = ids.length
      ? await supabase.from("ebooks").select("id, title").in("id", ids)
      : { data: [] as { id: string; title: string }[] };
    const titleById = new Map((books ?? []).map((b) => [String(b.id), String(b.title)]));
    setMarkets((data ?? []).map((m) => ({ ...m, title: titleById.get(String(m.book_id)) ?? "(unknown)" })));
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function save(id: string, patch: Row) {
    const client = supabase as unknown as {
      from: (t: string) => { update: (p: Row) => { eq: (c: string, v: string) => Promise<{ error: Error | null }> } };
    };
    const { error } = await client.from("book_royalty_markets").update(patch).eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Saved"); load(); }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Royalty Ownership — Settings</h1>
        <p className="text-muted-foreground">Per-book economics for the Royalty Ownership module.</p>
      </div>

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          This module resembles a revenue-sharing financial product. Legal, tax, payment, KYC, AML, and regulatory review is required before accepting real funds.
        </AlertDescription>
      </Alert>

      {loading && <div className="text-muted-foreground">Loading…</div>}

      <div className="space-y-4">
        {markets.map((m) => (
          <MarketRow key={String(m.id)} row={m} onSave={save} />
        ))}
      </div>
    </div>
  );
}

function MarketRow({ row, onSave }: { row: Row; onSave: (id: string, patch: Row) => void }) {
  const [salePrice, setSalePrice] = useState(String(row.book_sale_price_usd));
  const [pool, setPool] = useState(String(row.royalty_pool_percent));
  const [minPurchase, setMinPurchase] = useState(String(row.minimum_purchase_usd));
  const [vat, setVat] = useState(String(row.thai_vat_rate));
  const [gateway, setGateway] = useState(String(row.gateway_fee_rate));
  const [status, setStatus] = useState(String(row.status));

  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <div className="font-semibold">{String(row.title)}</div>
          <div className="text-xs text-muted-foreground">Units available: {Number(row.units_available).toLocaleString()} / {Number(row.total_units).toLocaleString()}</div>
        </div>
        <div className="text-sm text-muted-foreground">Status: {String(row.status)}</div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mt-3">
        <Field label="Book sale price" v={salePrice} set={setSalePrice} />
        <Field label="Royalty pool %" v={pool} set={setPool} />
        <Field label="Min purchase USD" v={minPurchase} set={setMinPurchase} />
        <Field label="Thai VAT rate" v={vat} set={setVat} />
        <Field label="Gateway fee rate" v={gateway} set={setGateway} />
        <Field label="Status (active/paused/closed)" v={status} set={setStatus} text />
      </div>
      <div className="flex gap-2 justify-end mt-4">
        <Button onClick={() => onSave(String(row.id), {
          book_sale_price_usd: Number(salePrice),
          royalty_pool_percent: Number(pool),
          minimum_purchase_usd: Number(minPurchase),
          thai_vat_rate: Number(vat),
          gateway_fee_rate: Number(gateway),
          status,
        })}>Save</Button>
      </div>
    </Card>
  );
}

function Field({ label, v, set, text }: { label: string; v: string; set: (s: string) => void; text?: boolean }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input type={text ? "text" : "number"} step="0.01" value={v} onChange={(e) => set(e.target.value)} />
    </div>
  );
}
