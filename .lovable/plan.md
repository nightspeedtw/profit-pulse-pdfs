# เชื่อม Paddle Payment Gateway

Lovable รองรับ Paddle แบบ seamless (ไม่ต้องกรอก API key เอง, ไม่ต้องตั้ง webhook เอง — Lovable จัดการให้ทั้งหมด)

## ขั้นตอน

1. **เปิดใช้ Paddle** ผ่านเครื่องมือ `enable_paddle_payments`
   - ตรวจว่า workspace ยังไม่ผูก Stripe/Shopify (Lovable อนุญาต provider เดียวต่อโปรเจกต์)
   - ถ้ามี provider อื่นอยู่ ต้อง disconnect ก่อนใน Payments dashboard

2. **สร้าง product + price ใน Paddle** สำหรับสินค้าที่จะขายผ่าน checkout ใหม่
   - เริ่มด้วยสินค้าเทสต์ 1 ชิ้น (เช่น coloring book 1 เล่ม) เพื่อยืนยันว่า flow ครบ
   - ที่เหลือค่อย batch สร้างทีหลัง

3. **แทน checkout เดิม** — ปัจจุบันโปรเจกต์มี:
   - `/checkout`, `/checkout/return` (adult PDFs)
   - `/kids/checkout/:id` (kids)
   - `KidsBookCard` มีปุ่ม "Buy" placeholder
   
   จะเพิ่มปุ่ม "Buy with Paddle" ที่เปิด Paddle Overlay Checkout (client SDK) โดยยังคงหน้า checkout เดิมไว้ก่อน ไม่ลบ ไม่ยุ่งกับ royalty/exchange

4. **หน้า success** — หลังจ่ายเสร็จ Paddle จะเด้งกลับมาที่ `/checkout/return` พร้อม transaction_id
   - Grant download ผ่าน `download_grants` table (มีอยู่แล้ว) เชื่อมกับ user account ที่ login อยู่
   - Guest checkout: ส่ง signed download link ทางอีเมล (ใช้ Resend connector ที่มีอยู่แล้ว)

5. **Go-live check** — เรียก `payments--get_go_live_status` เพื่อดูว่า Paddle account ต้องทำ KYC/verification อะไรบ้าง แล้วแจ้งขั้นตอนให้เจ้าของกด

## ขอบเขตของงานนี้ (Phase 1)
- เปิด Paddle + wire 1 ปุ่มซื้อในหน้า Kids coloring product เป็นตัวเทสต์
- หน้า return page อ่าน transaction แล้ว grant download
- แสดง go-live checklist

## ยังไม่ทำในรอบนี้ (แจ้งเผื่อยืนยัน)
- Batch สร้าง product ทั้งหมดใน Paddle catalog (ทำหลังยืนยัน flow แรกใช้ได้)
- เปลี่ยน checkout ของ adult PDFs (`/checkout`) — จะทำหลังจาก kids flow ผ่าน
- Subscription / recurring — ตอนนี้เป็น one-time purchase อย่างเดียว
- ย้ายลูกค้าเก่าจาก provider อื่น (ถ้ามี) — ต้อง manual

## Technical Notes
- `enable_paddle_payments` จะ inject Paddle client SDK + server webhook อัตโนมัติ
- ไม่แตะ royalty engine, autopilot, หรือ coloring pipeline
- ไม่แตะ Lovable AI gateway bypass ที่ตั้งไว้แล้ว

---

**ยืนยันเพื่อเริ่ม:**
- ต้องการเริ่มเทสต์ที่หน้า **Kids coloring product** ใช่ไหม หรืออยากเริ่มที่ adult PDF หน้าไหน?
- Provider อื่น (Stripe/Shopify/Paddle) เคยเปิดในโปรเจกต์นี้หรือยัง? ถ้ามี ต้อง disconnect ก่อน
