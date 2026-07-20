import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Mail } from "lucide-react";

export default function Support() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Support</h1>
        <p className="text-sm text-muted-foreground">We're here to help with orders, downloads, and account questions.</p>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Contact us</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Email our team and include your order number where relevant.</p>
          <Button asChild><a href="mailto:support@secretpdf.co"><Mail className="h-4 w-4 mr-2" />support@secretpdf.co</a></Button>
        </CardContent>
      </Card>
    </div>
  );
}
