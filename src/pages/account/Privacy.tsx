import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAccountAuth } from "@/hooks/useAccountAuth";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

export default function Privacy() {
  const { user } = useAccountAuth();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data: exports } = useQuery({
    enabled: !!user,
    queryKey: ["acct-exports", user?.id],
    queryFn: async () => (await supabase.from("acct_data_requests").select("*").eq("user_id", user!.id).order("requested_at", { ascending: false })).data ?? [],
  });
  const { data: pendingDelete } = useQuery({
    enabled: !!user,
    queryKey: ["acct-delete", user?.id],
    queryFn: async () => (await supabase.from("acct_deletion_requests").select("*").eq("user_id", user!.id).eq("status", "pending").maybeSingle()).data,
  });

  const requestExport = async () => {
    setBusy(true);
    const { error } = await supabase.from("acct_data_requests").insert({ user_id: user!.id });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Export requested. We'll email you when it's ready.");
    qc.invalidateQueries({ queryKey: ["acct-exports", user?.id] });
  };

  const requestDelete = async () => {
    setBusy(true);
    const { error } = await supabase.from("acct_deletion_requests").insert({ user_id: user!.id });
    setBusy(false);
    if (error) { toast.error(error.message.includes("duplicate") ? "You already have a pending deletion request." : error.message); return; }
    toast.success("Deletion scheduled. You have 14 days to cancel.");
    qc.invalidateQueries({ queryKey: ["acct-delete", user?.id] });
  };

  const cancelDelete = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    await supabase.from("acct_deletion_requests").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", pendingDelete.id);
    setBusy(false);
    toast.success("Deletion cancelled.");
    qc.invalidateQueries({ queryKey: ["acct-delete", user?.id] });
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Privacy</h1>
        <p className="text-sm text-muted-foreground">Export your data or close your account.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Export your data</CardTitle>
          <CardDescription>We'll email you a link to a machine-readable export.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={requestExport} disabled={busy}>Request export</Button>
          {!!exports?.length && (
            <ul className="text-xs text-muted-foreground space-y-1">
              {exports.slice(0, 5).map((r) => (
                <li key={r.id}>{new Date(r.requested_at).toLocaleString()} — {r.status}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-destructive">Delete account</CardTitle>
          <CardDescription>Removes personal data after a 14-day cooling-off period.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>What we must retain</AlertTitle>
            <AlertDescription>
              Orders, tax documents, financial ledger entries, and anti-fraud records are retained for the period required by law even after deletion. All other personal data is anonymized or removed.
            </AlertDescription>
          </Alert>
          {pendingDelete ? (
            <div className="rounded-lg border p-3 text-sm">
              <p>Deletion scheduled for <strong>{new Date(pendingDelete.effective_at).toLocaleDateString()}</strong>.</p>
              <Button size="sm" variant="outline" className="mt-2" onClick={cancelDelete} disabled={busy}>Cancel deletion</Button>
            </div>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">Request account deletion</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete your SecretPDF account?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Your access will be revoked after a 14-day cooling-off period. You can cancel any time before then. Purchased-file re-download access follows the Terms and applicable law once the account is closed.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep account</AlertDialogCancel>
                  <AlertDialogAction onClick={requestDelete}>Schedule deletion</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
