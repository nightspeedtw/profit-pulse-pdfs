import { Download, ShieldCheck, Lock } from "lucide-react";

const BADGES = [
  { icon: Download, label: "Instant Download", sub: "Delivered to your inbox in seconds" },
  { icon: ShieldCheck, label: "30-Day Guarantee", sub: "Full refund, no questions asked" },
  { icon: Lock, label: "Secure & Encrypted", sub: "Safe checkout, protected files" },
];

/**
 * Static trust row shown near the buy button.
 * Uses semantic tokens only — inherits the site's design system.
 */
export default function TrustBadges() {
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-3">
      {BADGES.map((b) => {
        const Icon = b.icon;
        return (
          <li
            key={b.label}
            className="flex items-start gap-2 border-2 border-foreground bg-background p-3"
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
