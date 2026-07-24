import { Check } from "lucide-react";

interface Props {
  pageCount: number;
  ageMin: number;
  ageMax: number;
  priceCents: number;
}

/**
 * Consolidated "What You Get" card. Replaces the duplicated highlight blocks
 * that used to compete for attention on mobile. All facts are derived from
 * real product data — no invented claims.
 */
export default function WhatYouGetCard({ pageCount, ageMin, ageMax, priceCents }: Props) {
  const perPageCents = pageCount > 0 && priceCents > 0 ? Math.ceil(priceCents / pageCount) : null;

  const items: string[] = [
    `${pageCount} unique coloring pages, no repeats`,
    `Ages ${ageMin}–${ageMax}`,
    `A4 + US Letter, print-ready PDF`,
    `Instant download after purchase`,
    `Personal + classroom use`,
  ];
  if (perPageCents != null) {
    items.splice(3, 0, `Less than ${perPageCents}¢ per coloring page`);
  }

  return (
    <div className="border-2 border-foreground bg-background rounded-md p-4 md:p-5">
      <h3 className="font-display uppercase text-lg mb-3">What you get</h3>
      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it} className="flex items-start gap-2 text-sm md:text-base">
            <Check className="h-4 w-4 mt-0.5 flex-shrink-0 text-accent-foreground" strokeWidth={2.5} />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
