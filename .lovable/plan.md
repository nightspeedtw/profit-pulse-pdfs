## เป้าหมาย
1. **Freeze Autopilot ทันที** — หยุด auto-retry / auto-requeue / cron dispatch ทั้งหมด (coloring + kids lanes)
2. **แจ้งปัญหาทีละอย่าง** — Admin UI แสดง incident เดียวต่อรอบ, แก้แล้วหายจากจอ
3. **Watchdog 1 นาที** — ถ้าระบบเงียบ >60s แจ้งเตือนทันที

## แผนดำเนินการ

### Step 1 — Freeze switch (DB + code guard)
- เพิ่ม flag `generation_settings.autopilot_frozen = true`
- ทุก worker tick (`coloring-worker-tick`, `autopilot-kids-pipeline`, `stall-watchdog`, `nightly-self-audit`, health cron auto-requeue) เช็ค flag นี้เป็นอันดับแรก → ถ้า true = return ทันที ไม่ dispatch, ไม่ retry, ไม่ requeue
- ปิด pg_cron jobs ที่ auto-tick (เก็บไว้ manual trigger เท่านั้น)
- ยกเลิก in-flight `next_retry_at` เพื่อไม่ให้เด้งเอง

### Step 2 — Issue Queue (แจ้งทีละอย่าง, ลบเมื่อแก้)
- ใช้ตาราง `alert_log` ที่มีอยู่ + เพิ่มคอลัมน์ `resolved_at`, `dedupe_key`
- Health-monitor เขียน incident 1 row ต่อ `dedupe_key` (เช่น `provider:cloudflare_exhausted`, `book:xxx:cover_stuck`) — ถ้ามี unresolved row เดิม ไม่สร้างซ้ำ
- Admin UI (`HealthIncidentBanner.tsx`) แสดง **incident เดียว** ที่ severity สูงสุด/เก่าสุด พร้อมปุ่ม "Mark resolved" → set `resolved_at`
- เมื่อ resolved → หายจากจอ, ตัวถัดไปขึ้นมาแทน

### Step 3 — Dead-system watchdog (60s)
- เพิ่ม `system_heartbeat` table (`last_beat_at`)
- Worker/cron ใดๆ ที่ทำงานเขียน heartbeat
- Health-monitor cron ลด interval → ทุก 1 นาที (หรือ client-side polling ใน Admin UI ทุก 30s)
- ถ้า `now() - last_beat_at > 60s` → สร้าง incident `system_dead` severity=critical + ส่ง Resend email
- Banner แสดงป้าย 🔴 "SYSTEM DEAD Xm ago" ทันที

## ไฟล์ที่จะแตะ

**Backend:**
- `supabase/migrations/*` — เพิ่ม `autopilot_frozen`, `system_heartbeat`, `alert_log.resolved_at/dedupe_key`
- `supabase/functions/coloring-worker-tick/index.ts` — freeze guard ที่บรรทัดแรก
- `supabase/functions/autopilot-kids-pipeline/index.ts` — freeze guard
- `supabase/functions/stall-watchdog/index.ts` — freeze guard
- `supabase/functions/health-monitor/index.ts` — heartbeat check + dedupe + 60s dead alert
- `supabase/functions/_shared/heartbeat.ts` (ใหม่) — helper เขียน heartbeat

**Frontend:**
- `src/components/admin/HealthIncidentBanner.tsx` — แสดง 1 incident + resolve button + dead-timer polling ทุก 30s
- `src/pages/admin/*` — ปุ่ม "🧊 Freeze / ▶ Unfreeze Autopilot"

**Cron:**
- ปิด/หยุด pg_cron auto-tick jobs (เก็บ manual endpoint ไว้)

## Definition of done
- กด Freeze → ไม่มี edge function invocation ใหม่ใน 5 นาที (ตรวจ `cost_log`)
- ปัญหาเดียวขึ้นจอต่อครั้ง, กด resolve แล้วหาย
- ตัดไฟ DB → banner ขึ้น "SYSTEM DEAD" ภายใน 60s + email เข้า

---

**คำถามก่อนลงมือ:**
1. Freeze แบบ **หยุดทุกอย่าง** (รวม in-flight books ที่กำลัง render อยู่ก็ไม่ต่อ) หรือแค่ **หยุด dispatch ใหม่** (ปล่อยที่วิ่งอยู่จบ)?
2. ปุ่ม "Mark resolved" ให้ manual เท่านั้น หรือให้ระบบ auto-resolve เมื่อเงื่อนไขหาย (เช่น Cloudflare quota reset)?