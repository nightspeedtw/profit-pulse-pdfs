export function ComplianceBanner() {
  return (
    <div className="rounded-xl border border-amber-300/60 bg-amber-50 text-amber-900 p-4 text-sm leading-relaxed">
      <p className="font-semibold mb-1">
        นี่คือส่วนแบ่งรายได้ค่าลิขสิทธิ์ ไม่ใช่หุ้นบริษัท · รายได้ไม่การันตี · ระบบช่วงทดลองใช้ยอดเงินจำลอง (DEMO) ยังไม่มีการชำระเงินจริง
      </p>
      <p className="text-amber-800/90">
        These are royalty revenue shares of individual books — not company equity or securities. Royalty income is not guaranteed. Demo balance only — no real payments processed yet.
      </p>
    </div>
  );
}
