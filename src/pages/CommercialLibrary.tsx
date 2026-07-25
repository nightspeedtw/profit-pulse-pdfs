// /account/commercial-library — credit balance, plan controls, and per-book
// unlock/download actions.
import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { Loader2, Download, ShieldCheck, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCommercialSubscription } from "@/hooks/useCommercialSubscription";

interface OwnedRow {
  id: string;
  book_id: string;
  license_type: "personal" | "commercial";
  commercial_rights_active: boolean;
  granted_at: string;
  book: { id: string; title: string; thumbnail_url: string | null; cover_url: string | null } | null;
}

export default function CommercialLibrary() {
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [books, setBooks] = useState<OwnedRow[]>([]);
  const [expiringCredits, setExpiringCredits] = useState<number>(0);
  const [expiringAt, setExpiringAt] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { subscription, creditBalance, refresh, loading: subLoading } = useCommercialSubscription();

  const load = useCallback(async () => {
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes.user?.id ?? null;
    setUserId(uid);
    if (!uid) {
      setLoading(false);
      return;
    }
    const [{ data: owned }, { data: grants }] = await Promise.all([
      supabase
        .from("book_licenses_owned")
        .select(
          "id,book_id,license_type,commercial_rights_active,granted_at,book:ebooks_kids(id,title,thumbnail_url,cover_url)"
        )
        .eq("user_id", uid)
        .order("granted_at", { ascending: false }),
      supabase
        .from("commercial_credit_ledger")
        .select("delta,expires_at,reason")
        .eq("user_id", uid)
        .eq("reason", "period_grant")
        .not("expires_at", "is", null)
        .gt("expires_at", new Date().toISOString())
        .order("expires_at", { ascending: true })
        .limit(1),
    ]);
    setBooks((owned as any) ?? []);
    if (grants && grants.length > 0) {
      setExpiringCredits((grants[0] as any).delta ?? 0);
      setExpiringAt((grants[0] as any).expires_at ?? null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const unlockCommercial = async (bookId: string) => {
    setBusy(bookId);
    setErr(null);
    try {
      const { data, error } = await supabase.functions.invoke("commercial-unlock-book", {
        body: { bookId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      await Promise.all([load(), refresh()]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Unlock failed");
    } finally {
      setBusy(null);
    }
  };

  const download = async (bookId: string) => {
    setBusy(bookId);
    setErr(null);
    try {
      const { data, error } = await supabase.functions.invoke("download-book", {
        body: { bookId },
      });
      if (error) throw error;
      const url = (data as any)?.url;
      if (!url) throw new Error("Download link unavailable");
      window.open(url, "_blank", "noopener");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusy(null);
    }
  };

  const managePlan = async () => {
    setErr(null);
    try {
      const { data, error } = await supabase.functions.invoke("commercial-subscription-manage", {
        body: {},
      });
      if (error) throw error;
      const url = (data as any)?.url;
      if (url) window.open(url, "_blank", "noopener");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Unable to open portal");
    }
  };

  if (loading || subLoading) {
    return (
      <div className="py-24 flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="container max-w-2xl py-16 text-center">
        <h1 className="font-display text-3xl mb-4">Sign in required</h1>
        <Link to="/account/sign-in" className="underline">Sign in to view your library</Link>
      </div>
    );
  }

  const planLabel =
    subscription?.plan_code === "commercial_50"
      ? "Commercial 50"
      : subscription?.plan_code === "commercial_25"
      ? "Commercial 25"
      : null;

  return (
    <div className="container max-w-5xl py-8 md:py-12 space-y-8">
      <Helmet>
        <title>My Commercial Library · SecretPDF</title>
      </Helmet>

      <div>
        <h1 className="font-display text-3xl md:text-4xl uppercase">My Commercial Library</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your licensed books, credits, and plan.
        </p>
      </div>

      {/* Plan / credits card */}
      <div className="p-5 border-2 border-foreground rounded-lg bg-highlight/40 grid md:grid-cols-3 gap-4">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Plan</div>
          <div className="font-display text-xl mt-1">{planLabel ?? "No active plan"}</div>
          {subscription?.cancel_at_period_end && (
            <div className="text-xs text-red-600 mt-1">Cancels at period end</div>
          )}
        </div>
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
            Credits available
          </div>
          <div className="font-display text-3xl mt-1">{creditBalance}</div>
          {expiringAt && expiringCredits > 0 && (
            <div className="text-xs text-muted-foreground mt-1">
              {expiringCredits} expire {new Date(expiringAt).toLocaleDateString()}
            </div>
          )}
        </div>
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Renewal</div>
          <div className="font-display text-xl mt-1">
            {subscription?.current_period_end
              ? new Date(subscription.current_period_end).toLocaleDateString()
              : "—"}
          </div>
          {subscription ? (
            <button
              type="button"
              onClick={managePlan}
              className="mt-2 inline-flex items-center gap-1 text-xs font-mono uppercase tracking-widest underline"
            >
              Manage plan <ExternalLink className="h-3 w-3" />
            </button>
          ) : (
            <Link to="/kids" className="mt-2 inline-block text-xs font-mono uppercase tracking-widest underline">
              Browse books →
            </Link>
          )}
        </div>
      </div>

      {!subscription && (
        <div className="grid md:grid-cols-2 gap-3">
          <PlanCard
            title="Commercial 25"
            price="$149/mo"
            bullets={["25 commercial book credits", "Roll over 1 billing period", "Cancel anytime"]}
            priceId="commercial_25_monthly"
            userId={userId}
          />
          <PlanCard
            title="Commercial 50"
            price="$249/mo"
            bullets={["50 commercial book credits", "Roll over 1 billing period", "Cancel anytime"]}
            priceId="commercial_50_monthly"
            userId={userId}
          />
        </div>
      )}

      {err && <div className="p-3 bg-red-50 border border-red-300 text-sm text-red-800 rounded">{err}</div>}

      {/* Books */}
      <div>
        <h2 className="font-display text-2xl uppercase mb-4">Your books</h2>
        {books.length === 0 ? (
          <div className="p-6 border-2 border-dashed border-border rounded-lg text-center text-muted-foreground">
            You don't own any books yet.{" "}
            <Link to="/kids" className="underline">Browse the store</Link>.
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {books.map((row) => {
              const b = row.book;
              const canUnlock =
                row.license_type === "personal" &&
                !!subscription &&
                creditBalance > 0;
              const isCommercialActive =
                row.license_type === "commercial" && row.commercial_rights_active;
              return (
                <div key={row.id} className="flex gap-3 p-3 border-2 border-border rounded-lg">
                  <div className="w-20 h-20 flex-shrink-0 bg-white border-2 border-foreground rounded overflow-hidden">
                    {(b?.thumbnail_url || b?.cover_url) && (
                      <img
                        src={b.thumbnail_url || b.cover_url!}
                        alt={b?.title ?? ""}
                        className="w-full h-full object-contain"
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-display uppercase text-sm line-clamp-2">
                      {b?.title ?? "Untitled"}
                    </div>
                    <div className="mt-1 flex items-center gap-1 text-xs">
                      <ShieldCheck className="h-3 w-3" />
                      {row.license_type === "commercial"
                        ? isCommercialActive
                          ? "Commercial · Active"
                          : "Commercial · Inactive"
                        : "Personal"}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => download(row.book_id)}
                        disabled={busy === row.book_id}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded border-2 border-foreground text-xs font-mono uppercase tracking-widest disabled:opacity-70"
                      >
                        {busy === row.book_id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Download className="h-3 w-3" />
                        )}
                        Download
                      </button>
                      {canUnlock && (
                        <button
                          type="button"
                          onClick={() => unlockCommercial(row.book_id)}
                          disabled={busy === row.book_id}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border-2 border-foreground bg-foreground text-background text-xs font-mono uppercase tracking-widest disabled:opacity-70"
                        >
                          Unlock Commercial (1 credit)
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function PlanCard({
  title,
  price,
  bullets,
  priceId,
  userId,
}: {
  title: string;
  price: string;
  bullets: string[];
  priceId: string;
  userId: string;
}) {
  const [busy, setBusy] = useState(false);
  const subscribe = async () => {
    setBusy(true);
    try {
      const { initializePaddle, getPaddlePriceId } = await import("@/lib/paddle");
      await initializePaddle();
      const paddleId = await getPaddlePriceId(priceId);
      // @ts-ignore Paddle global
      window.Paddle.Checkout.open({
        items: [{ priceId: paddleId, quantity: 1 }],
        customData: { kind: "commercial_subscription", userId, planPriceId: priceId },
        settings: {
          displayMode: "overlay",
          successUrl: `${window.location.origin}/account/commercial-library?subscription=success`,
          allowLogout: false,
          variant: "one-page",
        },
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="p-5 border-2 border-foreground rounded-lg space-y-2">
      <div className="flex items-baseline justify-between">
        <div className="font-display text-xl uppercase">{title}</div>
        <div className="font-display text-2xl">{price}</div>
      </div>
      <ul className="text-sm space-y-1">
        {bullets.map((b) => (
          <li key={b}>• {b}</li>
        ))}
      </ul>
      <button
        type="button"
        onClick={subscribe}
        disabled={busy}
        className="w-full mt-2 h-11 rounded-md bg-foreground text-background font-display uppercase text-sm disabled:opacity-70"
      >
        {busy ? "Opening…" : "Subscribe"}
      </button>
    </div>
  );
}
