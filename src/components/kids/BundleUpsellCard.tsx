// Bundle upsell card — shows on ColoringProduct when a live bundle contains
// this product.
import { Link } from "react-router-dom";
import type { SuggestedBundle } from "@/hooks/useSuggestedBundle";
import { Button } from "@/components/ui/button";

function usd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function BundleUpsellCard({ bundle }: { bundle: SuggestedBundle }) {
  return (
    <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
      <div className="flex items-start gap-4">
        <div className="flex -space-x-4">
          {bundle.coverUrls.slice(0, 3).map((u, i) => (
            <img
              key={i}
              src={u}
              alt=""
              className="h-16 w-16 rounded-lg border-2 border-background object-cover shadow-sm"
              loading="lazy"
            />
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-primary">Complete the set — save {bundle.savingsPct}%</div>
          <h3 className="mt-0.5 text-base font-bold leading-tight">{bundle.title}</h3>
          {bundle.subtitle && <p className="text-sm text-muted-foreground">{bundle.subtitle}</p>}
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-lg font-bold">{usd(bundle.bundlePriceCents)}</span>
            <span className="text-sm text-muted-foreground line-through">{usd(bundle.membersTotalCents)}</span>
            <span className="text-sm font-medium text-primary">save {usd(bundle.savingsCents)}</span>
          </div>
        </div>
      </div>
      <Button asChild className="mt-4 w-full">
        <Link to={`/kids/bundle/${bundle.slug}`}>See the bundle</Link>
      </Button>
    </div>
  );
}
