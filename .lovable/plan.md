
## สภาพปัจจุบัน (ยืนยันจาก DB)

- ✅ มี 1 run กำลังทำงานจริง: `The Credit Float Exit Protocol` — step `thumbnail_qc`, heartbeat สด
- ⏳ 14 runs สถานะ `queued` รอ heavy_production lock ว่าง (Sequential Safe Mode)
- ⚙️ Recovery worker cron = ทุก 5 นาที → ระยะห่างระหว่างเล่มสูงสุด ~5 นาที
- ⚙️ Hourly autopilot cron = ทุก 1 ชั่วโมง (สำหรับสร้าง idea ใหม่)

## ปัญหาที่ต้องแก้

1. **Queued runs ไม่ auto-start** เมื่อเล่มก่อนหน้าจบ — ต้องรอ cron tick ถัดไป
2. **Recovery worker ห่างเกินไป** (5 นาที) — ผู้ใช้เห็นเหมือนระบบนิ่ง
3. ไม่มี **"kick next" hook** หลังจาก run เสร็จ/แพ้/superseded
4. UI ไม่บอกชัดว่า "อีก 13 เล่มรอ lock" vs "ระบบหยุด"

## แผนแก้ (Auto-Continuous Mode)

### 1. เพิ่มความถี่ recovery worker: 5 นาที → 1 นาที
แก้ pg_cron schedule `autopilot-recovery-worker` เป็น `* * * * *` เพื่อให้ pickup queued runs เร็วขึ้น

### 2. Post-completion hook (สำคัญที่สุด)
ใน `autopilot-pipeline` เมื่อ run จบ (completed / failed / handoff / superseded):
- ปล่อย `heavy_production` lock ทันที
- **เรียก `autopilot-recovery-worker` fire-and-forget** เพื่อปลุก queued run ตัวถัดไปทันที (ไม่ต้องรอ cron)

### 3. Post-step hook สำหรับ waiting states
เมื่อ run เข้า `waiting_for_browserless_slot` / `waiting_for_shopify_quota`:
- ปล่อย lock ชั่วคราว
- Kick recovery ทันทีเพื่อให้เล่มอื่นแทรกได้

### 4. Lock TTL heartbeat
ปัจจุบัน TTL 90 นาที — ถ้า worker ตายกลางทาง lock ค้างนาน  
เพิ่ม heartbeat: ทุก step สำเร็จ ให้ต่ออายุ lock อีก 30 นาที + auto-release ถ้า heartbeat หายเกิน 10 นาที

### 5. UI: Live "Waiting for lock" indicator
ที่ `LiveProductionQueue` แสดง:
- 🟢 "Working on: <title> — step X (Yh Zm)" 
- ⏳ "13 queued — next pickup in ~Ns" (นับจาก recovery cron ครั้งถัดไป)
- ปุ่ม "Kick queue now" เผื่อ manual ปลุก

## ไฟล์ที่แก้

- `supabase/migrations/` — เปลี่ยน pg_cron `autopilot-recovery-worker` เป็น `* * * * *`
- `supabase/functions/autopilot-pipeline/index.ts` — เพิ่ม post-run hook เรียก recovery-worker
- `supabase/functions/_shared/run-tracker.ts` — เพิ่ม `releaseLockAndKickNext()` helper
- `supabase/functions/autopilot-recovery-worker/index.ts` — เพิ่ม auto-release lock ที่ heartbeat หายเกิน 10 นาที
- `src/components/admin/LiveProductionQueue.tsx` — เพิ่ม "next pickup in Ns" + "Kick queue now" button

## ผลลัพธ์ที่คาดหวัง

- เล่มถัดไปเริ่มทำภายใน **<10 วินาที** หลังเล่มก่อนจบ (แทน 5 นาที)
- ไม่มี run ค้างเพราะ lock stuck
- ผู้ใช้เห็น countdown ชัดเจน ไม่คิดว่าระบบตาย
- ไม่ต้องกดปุ่มใด ๆ เพื่อกระตุ้น
