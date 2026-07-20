import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAccountAuth } from "@/hooks/useAccountAuth";
import { toast } from "sonner";
import { z } from "zod";

const schema = z.object({
  display_name: z.string().trim().max(100).optional().or(z.literal("")),
  language: z.enum(["en", "th"]),
  timezone: z.string().trim().max(64),
  marketing_opt_in: z.boolean(),
});

export default function Profile() {
  const { user } = useAccountAuth();
  const qc = useQueryClient();
  const { data } = useQuery({
    enabled: !!user,
    queryKey: ["acct-profile", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("acct_profiles").select("*").eq("user_id", user!.id).maybeSingle();
      return data;
    },
  });

  const [form, setForm] = useState({ display_name: "", language: "en", timezone: "UTC", marketing_opt_in: false });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) setForm({
      display_name: data.display_name ?? "",
      language: (data.language as any) ?? "en",
      timezone: data.timezone ?? "UTC",
      marketing_opt_in: data.marketing_opt_in ?? false,
    });
  }, [data]);

  const save = async () => {
    const parsed = schema.safeParse(form);
    if (!parsed.success) { toast.error("Please check your inputs."); return; }
    setBusy(true);
    const { error } = await supabase.from("acct_profiles").upsert({
      user_id: user!.id, ...parsed.data,
      display_name: parsed.data.display_name || null,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Profile saved");
    qc.invalidateQueries({ queryKey: ["acct-profile", user?.id] });
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="text-sm text-muted-foreground">How we address you and communicate.</p>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Basics</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Email</Label>
            <Input value={user?.email ?? ""} disabled />
            <p className="text-xs text-muted-foreground mt-1">Change email from Security.</p>
          </div>
          <div>
            <Label htmlFor="dn">Display name</Label>
            <Input id="dn" maxLength={100} value={form.display_name} onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="lang">Language</Label>
              <select id="lang" className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.language} onChange={(e) => setForm((f) => ({ ...f, language: e.target.value as any }))}>
                <option value="en">English</option>
                <option value="th">ไทย</option>
              </select>
            </div>
            <div>
              <Label htmlFor="tz">Timezone</Label>
              <Input id="tz" maxLength={64} value={form.timezone} onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))} />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Marketing emails</Label>
              <p className="text-xs text-muted-foreground">Occasional product news. No spam.</p>
            </div>
            <Switch checked={form.marketing_opt_in} onCheckedChange={(v) => setForm((f) => ({ ...f, marketing_opt_in: v }))} />
          </div>
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
        </CardContent>
      </Card>
    </div>
  );
}
