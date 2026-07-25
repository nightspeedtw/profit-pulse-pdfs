import { Check } from "lucide-react";

interface Props {
  pageCount: number;
  ageMin: number;
  ageMax: number;
}

/**
 * Owner-specified 5-item "What you get" list. Renders exactly the 5 lines
 * required by the storefront conversion spec — deterministic, no server call,
 * no admin work.
 */
export function WhatYouGetList({ pageCount, ageMin, ageMax }: Props) {
  const items = [
    `${pageCount} unique coloring pages`,
    `Ages ${ageMin}–${ageMax}`,
    `PDF files: A4 + US Letter`,
    `Download instantly after payment`,
    `Personal-use license included`,
  ];
  return (
    <div className="border-2 border-foreground rounded-lg p-4 bg-background">
      <div className="font-display uppercase text-sm mb-3 tracking-widest">
        What you'll get
      </div>
      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it} className="flex items-start gap-2 text-sm">
            <Check className="h-4 w-4 mt-0.5 flex-shrink-0 text-accent-foreground" strokeWidth={2.5} />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default WhatYouGetList;
