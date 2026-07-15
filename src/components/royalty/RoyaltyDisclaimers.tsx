import { AlertTriangle } from "lucide-react";

/**
 * Legally-required disclaimer surface. Rendered near every calculator,
 * book card footer, and portfolio page. Copy is fixed — do NOT modify
 * without owner + legal review.
 */
export function RoyaltyDisclaimers({ compact = false }: { compact?: boolean }) {
  const items = [
    "Royalty payments depend on actual future book sales and are not guaranteed. Historical performance does not guarantee future results.",
    "Indicative Royalty Unit Value is an internal estimate; it is not a guaranteed resale value.",
    "Resale is not available in the current phase.",
    "Tax and payment fee amounts shown are estimates until the payment provider is configured.",
    "This information is not financial advice.",
  ];
  if (compact) {
    return (
      <p className="text-xs text-muted-foreground leading-relaxed">
        Royalty payments depend on actual future book sales and are not guaranteed. Indicative Royalty Unit Value is an internal estimate, not a resale value. Resale is not available in the current phase. Not financial advice.
      </p>
    );
  }
  return (
    <div className="rounded-lg border border-border/60 bg-muted/40 p-4 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <AlertTriangle className="h-4 w-4 text-muted-foreground" />
        Important
      </div>
      <ul className="text-xs text-muted-foreground space-y-1.5 list-disc pl-5">
        {items.map((t) => <li key={t}>{t}</li>)}
      </ul>
    </div>
  );
}
