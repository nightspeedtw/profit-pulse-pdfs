import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

function safeNext(v: string | null): string {
  if (!v || !v.startsWith("/") || v.startsWith("//")) return "/account";
  return v;
}

export default function AuthCallback() {
  const nav = useNavigate();

  useEffect(() => {
    let cancelled = false;
    const go = () => {
      if (cancelled) return;
      const next = safeNext(sessionStorage.getItem("auth:next"));
      sessionStorage.removeItem("auth:next");
      nav(next, { replace: true });
    };

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) return go();
      const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
        if (s) {
          sub.subscription.unsubscribe();
          go();
        }
      });
      // Failsafe: after 6s, send them to sign-in
      setTimeout(() => {
        if (cancelled) return;
        supabase.auth.getSession().then(({ data: d2 }) => {
          if (!d2.session) nav("/account/sign-in", { replace: true });
        });
      }, 6000);
    });

    return () => { cancelled = true; };
  }, [nav]);

  return (
    <div className="container mx-auto max-w-md py-24 px-4 text-center">
      <div className="animate-pulse text-muted-foreground text-sm">Signing you in…</div>
    </div>
  );
}
