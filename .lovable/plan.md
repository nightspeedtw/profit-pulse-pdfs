# Smoke Test: 3 หมวด → สร้าง + อัพขึ้นระบบขาย (Internal Store)

ตอนนี้ AI credit พร้อมแล้ว จะรัน pipeline ครบวงจรสำหรับ 3 หมวด และ list ขายในระบบ internal store (ไม่แตะ Shopify)

## เป้าหมาย
สร้าง ebook 1 เล่ม/หมวด สำหรับ 3 หมวด และ auto-list ขายบนระบบเราเอง เพื่อทดสอบ end-to-end pipeline

## หมวดที่จะทดสอบ
1. **Personal Finance** — ใช้ idea ที่มีอยู่ `The Cash Flow Command Protocol`
2. **Health & Wellness** — ใช้ idea ที่มีอยู่ `The Functional Burnout Protocol`
3. **Productivity** — ต้อง regenerate idea ใหม่ (idea pool หมด)

## ขั้นตอนการรัน

### Step 1 — เติม idea สำหรับ Productivity
เรียก `generate-idea` เฉพาะหมวด `productivity` (ตอนนี้ credit พร้อมแล้ว ไม่ควรเจอ 403 credit_limit_reached อีก)

### Step 2 — Trigger pipeline ทั้ง 3 หมวดแบบ parallel
เรียก `autopilot-pipeline` mode `full` สำหรับแต่ละ category:
- ข้าม category_mix (บังคับ 1 หมวด/รอบ)
- ข้าม Shopify (`shopify_draft_upload_enabled=false`)
- `auto_publish=true` → เข้า Step 3 อัตโนมัติ

Pipeline จะ:
1. เลือก idea → เขียน outline → เขียนเนื้อหา → gen ปก (ใช้ book-mockup.ts + store-thumbnail.ts ที่แก้ badge/title clipping ล่าสุด) → QC → publish record

### Step 3 — Auto-list ขาย
`daily-cron` จะเรียก `auto_list_ebook` ให้ ebook ที่ `status=published` ปรากฏใน internal store พร้อมขาย

จะ trigger cron manually หลัง pipeline เสร็จ เพื่อไม่ต้องรอรอบถัดไป

## Verification
หลังรันเสร็จ จะตรวจสอบ:
- `ebooks` table: 3 rows ใหม่, status=published, cover_url + thumbnail_url ครบ
- `store_listings` table: 3 rows ใหม่, is_active=true
- เปิดหน้า store preview ดูว่าปก+ราคาแสดงถูกต้อง ข้อความบนปกไม่โดน clip
- ถ้าปกยังมีปัญหา clipping → รายงานเล่มที่ผิด แล้วรอ instruction ถัดไป

## Risk / Notes
- ถ้า `generate-idea` สำหรับ productivity ยัง 403 → หยุดและแจ้งว่า credit ยังไม่พอ
- ถ้า pipeline ล่มกลางทาง → เก็บ log และรายงาน error กลับมา ไม่รัน retry อัตโนมัติเกิน 1 ครั้ง
- ไม่มีการยิงขึ้น Shopify (ตาม instruction ล่าสุด)

กด **Implement plan** เพื่อเริ่ม smoke test
