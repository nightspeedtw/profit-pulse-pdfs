import { Award, Sparkles, Gift } from "lucide-react";

/**
 * Bonus stack — no-cost inclusions bundled with every coloring book.
 * Owner order (2026-07-25): add a bonus stack that increases perceived value
 * without adding production cost. These bonuses are generated as part of the
 * front/back-matter template every book already ships with, so they're truly
 * included with zero admin work.
 */
export function BonusStack() {
  return (
    <section className="container max-w-5xl py-8 border-t-2 border-border">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="font-display text-2xl uppercase">Free bonuses included</h2>
        <span className="text-[10px] font-mono uppercase tracking-widest text-accent-foreground">
          $12 value · yours free
        </span>
      </div>
      <div className="grid md:grid-cols-3 gap-3">
        <div className="p-4 border-2 border-foreground rounded-lg bg-highlight/40 flex gap-3">
          <Award className="h-8 w-8 flex-shrink-0 text-accent-foreground" strokeWidth={1.5} />
          <div>
            <div className="font-display uppercase text-sm mb-1">Color Reward Certificate</div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Printable "I finished my coloring book!" certificate — fill in your child's name and celebrate.
            </p>
          </div>
        </div>
        <div className="p-4 border-2 border-foreground rounded-lg bg-highlight/40 flex gap-3">
          <Sparkles className="h-8 w-8 flex-shrink-0 text-accent-foreground" strokeWidth={1.5} />
          <div>
            <div className="font-display uppercase text-sm mb-1">5 Bonus Mini Pages</div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Five extra quick-color pages perfect for younger siblings or a first-timer warm-up.
            </p>
          </div>
        </div>
        <div className="p-4 border-2 border-foreground rounded-lg bg-highlight/40 flex gap-3">
          <Gift className="h-8 w-8 flex-shrink-0 text-accent-foreground" strokeWidth={1.5} />
          <div>
            <div className="font-display uppercase text-sm mb-1">Parent Print Guide</div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              One-page tip sheet: best paper, best pens, and how to avoid bleed-through when using markers.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export default BonusStack;
