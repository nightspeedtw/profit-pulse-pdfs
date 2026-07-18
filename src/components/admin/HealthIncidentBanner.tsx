// HealthIncidentBanner — red banner shown on admin dashboard when the
// health-monitor cron has recorded one or more active critical conditions
// in the last 6 hours (matches the email-cooldown window).
import { useEffect, useState } from "react";
import { AlertOctagon, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

type ActiveCritical = {
  alert_class: string;
  title: string;
  body: string;
  severity: string;
  created_at: string;
};

type StatusPayload = {
  ok: boolean;
  active_critical: ActiveCritical[];
  last_checked_at: string | null;
  resend_configured: boolean;
};

function ago(iso?: string | null): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} hr ago`;
}

export function HealthIncidentBanner() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("health-monitor", {
          body: {}, // GET-equivalent — we pass mode via URL below
        });
        // Fallback: functions.invoke uses POST. Use fetch directly for querystring mode.
        const projectRef = "atccyjuwimibyoocpiwi";
        const res = await fetch(
          `https://${projectRef}.supabase.co/functions/v1/health-monitor?mode=status`,
          { headers: { "apikey": (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string) ?? "" } },
        );
        if (!cancelled && res.ok) setStatus(await res.json());
        else if (!cancelled && data) setStatus(data as StatusPayload);
        if (error) console.warn("health-monitor invoke error", error);
      } catch (e) {
        console.warn("health-monitor status fetch failed", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
      timer = setTimeout(tick, 60_000);
    };
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);

  if (loading || !status) return null;
  const active = status.active_critical ?? [];
  if (active.length === 0) {
    // Show a subtle "no active incidents" line only when Resend isn't wired,
    // so the owner can see the pending activation state.
    if (!status.resend_configured) {
      return (
        <Card className="border border-amber-500/60 bg-amber-500/5">
          <CardContent className="p-3 text-xs text-amber-700 dark:text-amber-400">
            Health monitor active · email alerts pending Resend key (last checked {ago(status.last_checked_at)})
          </CardContent>
        </Card>
      );
    }
    return null;
  }

  return (
    <Card className="border-2 border-red-600 bg-red-500/5">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded bg-red-500/20">
            <AlertOctagon className="h-5 w-5 text-red-600 animate-pulse" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-mono uppercase tracking-wide text-red-700 dark:text-red-400">
              Active incident{active.length > 1 ? "s" : ""} · last checked {ago(status.last_checked_at)}
            </div>
            <div className="text-base font-semibold text-red-700 dark:text-red-400">
              🔴 {active.length} critical condition{active.length > 1 ? "s" : ""} active
            </div>
          </div>
          <Badge variant="outline" className="border-red-600 text-red-700">
            {status.resend_configured ? "email: live" : "email: pending"}
          </Badge>
        </div>
        <ul className="space-y-2 pl-1">
          {active.map((a) => (
            <li key={a.alert_class} className="text-sm">
              <div className="font-medium">
                <span className="font-mono text-[11px] text-muted-foreground mr-2">{a.alert_class}</span>
                {a.title}
              </div>
              <div className="text-xs text-muted-foreground whitespace-pre-wrap mt-0.5">
                {a.body.split("\n").slice(0, 3).join("\n")}
              </div>
              <div className="text-[11px] font-mono text-muted-foreground mt-0.5">
                detected {ago(a.created_at)}
              </div>
            </li>
          ))}
        </ul>
        {loading && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin"/>refreshing…</div>}
      </CardContent>
    </Card>
  );
}
