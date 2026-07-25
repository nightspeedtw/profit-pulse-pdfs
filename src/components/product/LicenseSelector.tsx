// Two-license selector shown on every coloring book page.
// Personal $14.99 · Commercial Activity License $39. Owner-spec copy.
import { useState } from "react";
import { Loader2, ShieldCheck, Store, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { useLicenseCheckout, type LicenseType } from "@/hooks/useLicenseCheckout";
import { useCommercialSubscription } from "@/hooks/useCommercialSubscription";
import { useBookLicense } from "@/hooks/useBookLicense";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  bookId: string;
  personalPriceCents?: number;
  commercialPriceCents?: number;
  userId: string | null;
  userEmail?: string | null;
}

function centsToUsd(n: number): string {
  return `$${(n / 100).toFixed(2)}`;
}

export default function LicenseSelector({
  bookId,
  personalPriceCents = 1499,
  commercialPriceCents = 3900,
  userId,
  userEmail,
}: Props) {
  const [choice, setChoice] = useState<LicenseType>("personal");
  const [unlocking, setUnlocking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { openLicenseCheckout, loading } = useLicenseCheckout();
  const { subscription, creditBalance, refresh: refreshSub } = useCommercialSubscription();
  const { license, refresh: refreshLicense } = useBookLicense(bookId);

  const priceCents = choice === "personal" ? personalPriceCents : commercialPriceCents;
  const canUnlockWithCredit =
    choice === "commercial" &&
    !!subscription &&
    creditBalance > 0 &&
    (!license || license.license_type !== "commercial");

  const handleBuy = async () => {
    setErr(null);
    if (!userId) {
      window.location.href = `/account/sign-in?next=${encodeURIComponent(window.location.pathname)}`;
      return;
    }
    await openLicenseCheckout({
      bookId,
      userId,
      licenseType: choice,
      customerEmail: userEmail || undefined,
    });
  };

  const handleUnlockWithCredit = async () => {
    setErr(null);
    if (!userId) {
      window.location.href = `/account/sign-in?next=${encodeURIComponent(window.location.pathname)}`;
      return;
    }
    setUnlocking(true);
    try {
      const { data, error } = await supabase.functions.invoke("commercial-unlock-book", {
        body: { bookId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      await Promise.all([refreshSub(), refreshLicense()]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Unlock failed");
    } finally {
      setUnlocking(false);
    }
  };

  // Already owned? Show badge instead of buy.
  if (license) {
    const isCommercialActive =
      license.license_type === "commercial" && license.commercial_rights_active;
    return (
      <div className="space-y-3">
        <div className="p-4 border-2 border-foreground rounded-lg bg-highlight">
          <div className="flex items-center gap-2 font-display uppercase text-sm">
            <ShieldCheck className="h-4 w-4" />
            {license.license_type === "commercial"
              ? isCommercialActive
                ? "Commercial Activity License · Rights active"
                : "Commercial Activity License · Rights inactive"
              : "Personal Use License"}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {license.license_type === "commercial" && !isCommercialActive
              ? "Files stay yours forever. Reactivate commercial rights by starting a Commercial plan."
              : "Files are yours. Reprint any time from your library."}
          </p>
          <Link
            to="/account/commercial-library"
            className="mt-3 inline-block text-xs font-mono uppercase tracking-widest underline"
          >
            Open my library →
          </Link>
        </div>
        {license.license_type === "personal" && (
          <button
            type="button"
            onClick={() => setChoice("commercial")}
            className="w-full h-11 rounded-md border-2 border-foreground bg-background font-display uppercase text-sm"
          >
            Upgrade to Commercial — {centsToUsd(commercialPriceCents)}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
        Choose your license
      </div>
      <div className="grid gap-2">
        <label
          className={`flex items-start gap-3 p-3 border-2 rounded-lg cursor-pointer transition-colors ${
            choice === "personal" ? "border-foreground bg-accent/10" : "border-border hover:border-foreground"
          }`}
        >
          <input
            type="radio"
            name="license"
            className="mt-1"
            checked={choice === "personal"}
            onChange={() => setChoice("personal")}
          />
          <div className="flex-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-display uppercase text-sm">
                <Users className="h-4 w-4" /> Personal Use
              </div>
              <div className="font-display text-lg">{centsToUsd(personalPriceCents)}</div>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              One buyer or household. Personal, non-commercial printing only.
            </p>
          </div>
        </label>

        <label
          className={`flex items-start gap-3 p-3 border-2 rounded-lg cursor-pointer transition-colors ${
            choice === "commercial" ? "border-foreground bg-accent/10" : "border-border hover:border-foreground"
          }`}
        >
          <input
            type="radio"
            name="license"
            className="mt-1"
            checked={choice === "commercial"}
            onChange={() => setChoice("commercial")}
          />
          <div className="flex-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-display uppercase text-sm">
                <Store className="h-4 w-4" /> Commercial Activity License
              </div>
              <div className="font-display text-lg">{centsToUsd(commercialPriceCents)}</div>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              For educators, organizations, and businesses. Print & use in paid or unpaid
              activities with students, clients, classrooms, camps, workshops, cafes, or events.
              May not resell, redistribute, share, sublicense, use for print-on-demand, or create
              competing products from the files.
            </p>
          </div>
        </label>
      </div>

      {canUnlockWithCredit ? (
        <button
          type="button"
          onClick={handleUnlockWithCredit}
          disabled={unlocking}
          className="w-full h-14 rounded-md bg-foreground text-background font-display uppercase tracking-wide text-base inline-flex items-center justify-center gap-2 disabled:opacity-70"
        >
          {unlocking ? <Loader2 className="h-5 w-5 animate-spin" /> : <ShieldCheck className="h-5 w-5" />}
          {unlocking ? "Unlocking…" : `Unlock with 1 credit (${creditBalance} left)`}
        </button>
      ) : (
        <button
          type="button"
          onClick={handleBuy}
          disabled={loading}
          className="w-full h-14 rounded-md bg-foreground text-background font-display uppercase tracking-wide text-base inline-flex items-center justify-center gap-2 disabled:opacity-70"
        >
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
          {loading ? "Opening checkout…" : `Buy License — ${centsToUsd(priceCents)}`}
        </button>
      )}

      {err && <p className="text-xs text-red-600">{err}</p>}

      <p className="text-xs text-muted-foreground text-center">
        Instant PDF · A4 + US Letter · Print Again Anytime ·{" "}
        <Link to="/legal/license" className="underline">
          License details
        </Link>
      </p>

      {choice === "commercial" && !subscription && (
        <div className="mt-4 p-4 border-2 border-dashed border-foreground rounded-lg bg-highlight/30 space-y-2">
          <div className="font-display uppercase text-sm">
            Running a business? Subscribe and save.
          </div>
          <p className="text-xs text-muted-foreground">
            Unlock commercial rights on any coloring book. Credits roll over one billing period.
            Cancel anytime — your files stay yours.
          </p>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <SubscribeButton priceId="commercial_25_monthly" label="Commercial 25" sub="$149/mo · 25 books" userId={userId} email={userEmail} />
            <SubscribeButton priceId="commercial_50_monthly" label="Commercial 50" sub="$249/mo · 50 books" userId={userId} email={userEmail} />
          </div>
        </div>
      )}
    </div>
  );
}

function SubscribeButton({
  priceId,
  label,
  sub,
  userId,
  email,
}: {
  priceId: string;
  label: string;
  sub: string;
  userId: string | null;
  email?: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const handle = async () => {
    if (!userId) {
      window.location.href = `/account/sign-in?next=${encodeURIComponent(window.location.pathname)}`;
      return;
    }
    setBusy(true);
    try {
      const { initializePaddle, getPaddlePriceId } = await import("@/lib/paddle");
      await initializePaddle();
      const paddleId = await getPaddlePriceId(priceId);
      // @ts-ignore Paddle global
      window.Paddle.Checkout.open({
        items: [{ priceId: paddleId, quantity: 1 }],
        customer: email ? { email } : undefined,
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
    <button
      type="button"
      onClick={handle}
      disabled={busy}
      className="p-3 rounded-lg border-2 border-foreground bg-background hover:bg-accent hover:text-accent-foreground transition-colors text-left disabled:opacity-70"
    >
      <div className="font-display uppercase text-sm">{label}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </button>
  );
}
