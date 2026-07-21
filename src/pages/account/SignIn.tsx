import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { toast } from "sonner";

export default function AccountSignIn() {
  const nav = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const onGoogle = async () => {
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: `${window.location.origin}/auth/callback`,
    });
    if (result.error) {
      toast.error("Google sign-in failed");
      setBusy(false);
      return;
    }
    if (result.redirected) return; // browser is redirecting
    // Popup/iframe path: session already set, go to intended destination.
    const next = sessionStorage.getItem("auth:next");
    sessionStorage.removeItem("auth:next");
    nav(next && next.startsWith("/") && !next.startsWith("//") ? next : "/account", { replace: true });
  };

  const onEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) throw error;
        toast.success("Check your email to confirm your account.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        const next = sessionStorage.getItem("auth:next");
        sessionStorage.removeItem("auth:next");
        nav(next && next.startsWith("/") && !next.startsWith("//") ? next : "/account", { replace: true });
      }
    } catch (err) {
      // Generic error to prevent enumeration
      toast.error("Could not sign in. Please check your credentials.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container mx-auto max-w-md py-16 px-4">
      <Card>
        <CardHeader>
          <CardTitle>{mode === "signup" ? "Create your account" : "Sign in to SecretPDF"}</CardTitle>
          <CardDescription>
            Access your library, orders, and downloads.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button className="w-full" variant="outline" onClick={onGoogle} disabled={busy}>
            Continue with Google
          </Button>
          <div className="relative py-2">
            <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">or</span>
            </div>
          </div>
          <form onSubmit={onEmail} className="space-y-3">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {mode === "signup" ? "Create account" : "Sign in"}
            </Button>
          </form>
          <div className="text-center text-sm text-muted-foreground">
            {mode === "signin" ? (
              <>
                <button className="underline" onClick={() => setMode("signup")}>Create an account</button>
                {" · "}
                <Link to="/account/forgot-password" className="underline">Forgot password?</Link>
              </>
            ) : (
              <button className="underline" onClick={() => setMode("signin")}>Have an account? Sign in</button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
