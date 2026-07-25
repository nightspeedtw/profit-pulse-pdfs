import { useState } from "react";
import { ChevronDown } from "lucide-react";

interface Props {
  pageCount: number;
}

const FAQ_ITEMS = (pageCount: number) => [
  {
    q: "How do I receive my files?",
    a: "Instantly. Right after checkout you'll get a download button on the confirmation page and a copy in your email — no waiting, no shipping.",
  },
  {
    q: "Can I print more than once?",
    a: `Yes. Your license lets you reprint every one of the ${pageCount} pages as many times as you want for your own family — perfect for siblings, replacements, and rainy-day mistakes.`,
  },
  {
    q: "Can I use this in a classroom?",
    a: "Yes, for a single classroom of your own students. For multi-classroom, school, or commercial use, please contact us for a school license.",
  },
  {
    q: "Is this a physical book?",
    a: "No — this is a printable PDF you download and print at home. That's why the price is so low and it arrives instantly.",
  },
  {
    q: "What paper should I use?",
    a: "Any standard A4 or US Letter printer paper works great. For crayons and colored pencils, 80–100gsm is perfect. For markers, a heavier 120gsm paper prevents bleed-through.",
  },
];

export function ColoringFAQ({ pageCount }: Props) {
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  const items = FAQ_ITEMS(pageCount);
  return (
    <section className="container max-w-3xl py-8 border-t-2 border-border">
      <h2 className="font-display text-2xl uppercase mb-4">Frequently asked questions</h2>
      <div className="divide-y-2 divide-border border-2 border-border rounded-lg overflow-hidden">
        {items.map((item, i) => {
          const open = i === openIdx;
          return (
            <div key={item.q}>
              <button
                type="button"
                onClick={() => setOpenIdx(open ? null : i)}
                aria-expanded={open}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
              >
                <span className="font-display text-sm md:text-base uppercase tracking-wide">
                  {item.q}
                </span>
                <ChevronDown
                  className={`h-4 w-4 flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
                />
              </button>
              {open && (
                <div className="px-4 pb-4 text-sm text-muted-foreground leading-relaxed">
                  {item.a}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default ColoringFAQ;
