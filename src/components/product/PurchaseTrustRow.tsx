import { ShieldCheck, Lock, LifeBuoy } from "lucide-react";

/**
 * Truthful trust row shown near the primary purchase CTA. No fake reviews,
 * no fake scarcity, no invented sales counts — just the promises we can keep.
 */
export default function PurchaseTrustRow() {
  const items = [
    { icon: ShieldCheck, label: "Print-ready PDF", sub: "Checked before release" },
    { icon: Lock, label: "Secure checkout", sub: "Encrypted end-to-end" },
    { icon: LifeBuoy, label: "Download help", sub: "Support for technical issues" },
  ];
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
      {items.map((b) => {
        const Icon = b.icon;
        return (
          <li
            key={b.label}
            className="flex items-start gap-2 border-2 border-foreground bg-background p-3 rounded-md"
          >
            <Icon className="h-5 w-5 flex-shrink-0 mt-0.5" strokeWidth={2} />
            <div className="min-w-0">
              <div className="text-xs font-mono uppercase font-bold tracking-wide">{b.label}</div>
              <div className="text-[11px] text-muted-foreground leading-tight">{b.sub}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
