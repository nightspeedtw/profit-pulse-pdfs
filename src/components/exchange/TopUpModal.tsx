import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function TopUpModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>เติมเงินจริง · Real Top Up</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-amber-900 bg-amber-50 border border-amber-200 rounded-md p-3">
            การเติมเงินจริงจะเปิดเร็วๆ นี้ — ขั้นตอนนี้เป็นระบบทดลอง (DEMO) ยังไม่มีการชำระเงินจริง
          </p>
          <p className="text-muted-foreground">
            Real USD top-ups are coming soon. Right now the exchange runs on a
            DEMO balance so you can experience the trading flow end-to-end. No
            real payments are processed.
          </p>
        </div>
        <Button onClick={() => onOpenChange(false)}>Got it</Button>
      </DialogContent>
    </Dialog>
  );
}
