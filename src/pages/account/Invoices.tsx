import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FileText } from "lucide-react";

export default function Invoices() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Invoices & Tax Profile</h1>
        <p className="text-sm text-muted-foreground">Official invoices and receipts for your purchases.</p>
      </div>
      <Alert>
        <FileText className="h-4 w-4" />
        <AlertTitle>Coming soon</AlertTitle>
        <AlertDescription>
          Official Thai e-Tax invoice / e-Receipt issuance is being integrated through an approved provider.
          We will not issue documents labelled as official tax invoices until that integration is live and compliant.
        </AlertDescription>
      </Alert>
      <Card>
        <CardHeader><CardTitle className="text-base">Tax profile</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          You will be able to enter your legal name, tax ID, and billing address here once tax invoicing is enabled for your account.
        </CardContent>
      </Card>
    </div>
  );
}
