import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAccountAuth } from "@/hooks/useAccountAuth";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";

export default function Security() {
  const { user, providers, hasPassword, isGoogle } = useAccountAuth();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);

  const change = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) { toast.error("Password must be at least 8 characters."); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setPw("");
    toast.success("Password updated");
  };

  const signOutAll = async () => {
    const { error } = await supabase.auth.signOut({ scope: "global" });
    if (error) { toast.error(error.message); return; }
    window.location.href = "/";
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Security</h1>
        <p className="text-sm text-muted-foreground">Sign-in methods, sessions, and password.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Sign-in methods</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {providers.length === 0 && <p className="text-sm text-muted-foreground">No providers detected.</p>}
            {providers.map((p) => <Badge key={p} variant="outline">{p}</Badge>)}
          </div>
          <p className="text-xs text-muted-foreground">Signed-in email: {user?.email}</p>
        </CardContent>
      </Card>

      {hasPassword ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Change password</CardTitle>
            <CardDescription>Use a strong, unique password at least 8 characters long.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={change} className="space-y-3 max-w-sm">
              <div>
                <Label htmlFor="np">New password</Label>
                <Input id="np" type="password" minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} />
              </div>
              <Button type="submit" disabled={busy}>{busy ? "Updating…" : "Update password"}</Button>
            </form>
          </CardContent>
        </Card>
      ) : isGoogle ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Password</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">You sign in with Google. Your password is managed in your Google Account.</p>
            <Button asChild variant="outline">
              <a href="https://myaccount.google.com/security" target="_blank" rel="noopener noreferrer">
                Manage password in Google Account <ExternalLink className="h-3.5 w-3.5 ml-2" />
              </a>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sessions</CardTitle>
          <CardDescription>Sign out of every device where you're currently signed in.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={signOutAll}>Sign out of all devices</Button>
        </CardContent>
      </Card>
    </div>
  );
}
