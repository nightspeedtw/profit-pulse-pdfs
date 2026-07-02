import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const ADMIN_PASSCODE = "453451";
const STORAGE_KEY = "admin_passcode_ok";

export default function AdminLogin() {
  const navigate = useNavigate();
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = "Admin passcode — Ebook Factory";
    if (localStorage.getItem(STORAGE_KEY) === "1") {
      navigate("/admin", { replace: true });
    }
  }, [navigate]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    if (passcode.trim() === ADMIN_PASSCODE) {
      localStorage.setItem(STORAGE_KEY, "1");
      toast.success("Access granted");
      navigate("/admin", { replace: true });
    } else {
      toast.error("Incorrect passcode");
    }
    setBusy(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <form onSubmit={submit} className="w-full max-w-md border-2 border-foreground bg-card p-8 space-y-5">
        <div>
          <p className="font-mono uppercase tracking-widest text-xs mb-2">[ Ebook Factory ]</p>
          <h1 className="font-display text-3xl uppercase">Enter passcode</h1>
          <p className="text-sm text-muted-foreground mt-1">Admin access only.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="pc">Passcode</Label>
          <Input
            id="pc"
            type="password"
            inputMode="numeric"
            autoFocus
            required
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Checking..." : "Unlock admin"}
        </Button>
      </form>
    </div>
  );
}
