## Goal
ให้ระบบสร้าง PDF ebook คุณภาพสูง (ผ่าน strict QC) แบบอัตโนมัติ 24 ชั่วโมง โดยไม่ต้องกดเอง และไม่ลด QC threshold

## Current State (จากที่ทำมา)
- Strict QC ถูก restore แล้ว (final ≥90, cover ≥85, compliance ≥90, ห้าม soft-pass)
- `daily-cron` มีอยู่แล้วแต่รันแค่วันละครั้ง
- `autopilot-pipeline` ทำงานเป็นรอบ แต่ยังต้องมีคน trigger
- `premium-title-expert` แก้แล้วให้ inject premium token อัตโนมัติ
- Phase 1: PDF only, Shopify off, ขายผ่าน native storefront

## ปัญหาที่ทำให้ยังไม่ auto 24 ชม.
1. `daily-cron` = วันละครั้ง → ไม่ใช่ 24/7 loop
2. ไม่มี scheduler ที่ (a) หา idea ใหม่ (b) promote → pipeline (c) resume runs ที่ค้าง (d) publish เมื่อผ่าน QC
3. ไม่มี concurrency guard ระดับ global → เสี่ยงชนกัน / รันซ้ำ
4. ไม่มี auto-retry สำหรับ run ที่ค้าง > N นาที
5. ไม่มี daily budget cap → เสี่ยงเบิร์นเครดิต AI ไม่จำกัด

## Plan — Autopilot 24/7 PDF Factory

### 1. `autopilot-tick` edge function (ใหม่ — หัวใจของ loop)
รันทุก 5 นาทีผ่าน pg_cron. หน้าที่:
- **Guard**: อ่าน `autopilot_settings` (enabled, max_concurrent_runs=2, daily_book_cap=6, daily_cost_cap_usd)
- **Reap stuck runs**: run ที่ `updated_at < now() - interval '15 min'` และ status='running' → mark `stalled`, ปล่อย lock, เรียก `autopilot-recovery-worker`
- **Resume in-flight**: หา runs ที่ยัง `running` และ next step พร้อม → เรียก `autopilot-pipeline` ต่อ (pipeline เป็น step-based อยู่แล้ว)
- **Start new runs**: ถ้า active runs < max_concurrent AND วันนี้ยังไม่ถึง cap → หยิบ idea `status='approved'` ล่าสุด → ถ้าไม่มี → เรียก `generate-idea` ให้สร้างใหม่ (rotate category) → promote → start pipeline
- **Publish ready books**: query `ebooks` ที่ `status='ready_for_review'` AND ผ่าน strict gate (final≥90, cover≥85, compliance≥90, qc_downgraded=false, มี PDF/thumbnail/price/copy) → set `status='live'`, insert `storefront_products` (ย้าย logic จาก daily-cron)

### 2. `autopilot_settings` table (ใหม่)
```
enabled boolean default true
max_concurrent_runs int default 2
daily_book_cap int default 6
daily_cost_cap_usd numeric default 15
paused_reason text
updated_at timestamptz
```
+ GRANT + RLS (admin read/write, service_role all)

### 3. Schedule ผ่าน pg_cron (5 นาที)
```sql
select cron.schedule('autopilot-tick-5min','*/5 * * * *',
  $$ select net.http_post(url:='.../autopilot-tick', headers:=..., body:='{}'::jsonb); $$);
```
- ปิด `daily-cron` เดิม หรือปรับให้เหลือแค่ daily housekeeping (cleanup logs, aggregate stats)

### 4. Kill-switch + safety
- ถ้า `autopilot_settings.enabled=false` → tick ออกทันที
- ถ้ามี run ค้างเกิน 3 รอบ tick → auto-pause + `paused_reason='stuck_run:<id>'`
- ถ้า cost วันนี้ > cap → auto-pause + reason
- ทุก tick เขียน `autopilot_heartbeat` (last_tick, action_taken, active_runs, books_today)

### 5. หน้า Admin `/admin/autopilot`
- Toggle enabled on/off, สไลเดอร์ max_concurrent, daily cap
- แสดง heartbeat, active runs, books today, cost today, paused_reason
- ปุ่ม "Resume now" (clear paused_reason)
- ใช้ Realtime subscribe `autopilot_pipeline_runs` + `ebooks` เพื่อ live update

### 6. QC ยังคง strict (ไม่แตะ)
- ไม่มี soft-pass ทุก path
- Publish gate เดิมทั้งหมด
- Auto-retry เฉพาะ transient errors (network/timeout) ไม่ retry QC failures — QC fail 3 ครั้ง → `needs_review` เหมือนเดิม

## Files to Change
**New**
- `supabase/functions/autopilot-tick/index.ts`
- `supabase/migrations/<ts>_autopilot_settings.sql` (table + GRANT + RLS + pg_cron schedule)
- `src/pages/admin/AutopilotControl.tsx`

**Edit**
- `supabase/functions/daily-cron/index.ts` — ลบ publish logic (ย้ายไป tick), เหลือแค่ housekeeping
- `src/App.tsx` + `AdminLayout.tsx` — เพิ่ม route `/admin/autopilot`

**No change**
- `autopilot-pipeline`, `premium-title-expert`, QC gates, publish thresholds

## Live Deploy
- Migration + edge functions auto-deploy
- pg_cron ใช้ `supabase--insert` (มี anon key / URL specific)
- หลัง deploy: เปิด toggle → ระบบเดินเอง 24 ชม.

## ยืนยัน
- ✅ ไม่ลด QC / ไม่ soft-pass
- ✅ Shopify ยัง disabled (native storefront เท่านั้น)
- ✅ ไม่ต้องกดเอง — pg_cron ทุก 5 นาที
- ✅ มี kill-switch + budget cap ป้องกันเบิร์นเครดิต

ถามก่อนลุย: **daily_book_cap = 6 เล่ม/วัน + max_concurrent = 2 + cost cap $15/วัน** โอเคไหม หรืออยากตั้งเลขอื่น?
