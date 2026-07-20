// Campaign ribbon + live countdown. Purely presentational.
import { useEffect, useState } from "react";
import { Clock, Sparkles } from "lucide-react";

interface Props {
  campaignName: string;
  seasonKey: string | null;
  endsAt: string;
  savingsPct: number;
  className?: string;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "Ending soon";
  const totalMin = Math.floor(ms / 60_000);
  const d = Math.floor(totalMin / (60 * 24));
  const h = Math.floor((totalMin % (60 * 24)) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

export function CampaignRibbon({ campaignName, seasonKey, endsAt, savingsPct, className }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const ms = new Date(endsAt).getTime() - now;
  return (
    <div className={`inline-flex flex-wrap items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary ${className ?? ""}`}>
      <Sparkles className="h-4 w-4" aria-hidden />
      <span>{campaignName}</span>
      {savingsPct > 0 && (
        <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
          Save {savingsPct}%
        </span>
      )}
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Clock className="h-3 w-3" aria-hidden />
        {formatCountdown(ms)}
      </span>
    </div>
  );
}
