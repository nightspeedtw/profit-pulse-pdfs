import { useMemo } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { formatSharePrice } from "@/lib/exchange/model";

export function PriceChart({ data }: { data: Array<{ snapshot_at: string; ref_price: number; last_trade_price: number | null }> }) {
  const chartData = useMemo(() => data.map(d => ({
    t: new Date(d.snapshot_at).toLocaleDateString(),
    price: Number(d.last_trade_price ?? d.ref_price),
    ref: Number(d.ref_price),
  })), [data]);

  if (!chartData.length) return <div className="text-sm text-muted-foreground p-8 text-center">No price history yet.</div>;

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis dataKey="t" tick={{ fontSize: 10 }} />
          <YAxis
            tick={{ fontSize: 10 }}
            domain={["dataMin", "dataMax"]}
            tickFormatter={(v) => formatSharePrice(v)}
            width={80}
          />
          <Tooltip formatter={(v: number) => formatSharePrice(v)} />
          <Area type="monotone" dataKey="price" stroke="hsl(var(--primary))" fill="url(#priceFill)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
