## เป้าหมาย
ใช้ Cloudflare ทั้ง 6 บัญชี (cf1..cf6, 10k neurons/บัญชี = 60k/วัน) ให้หมดจริง ก่อนที่จะบอกว่า "quota exhausted" และ latch ทั้งเลนออก แก้ถาวรทั้ง distribution และ latch logic

## หลักฐาน (ยืนยันจากฐานข้อมูล + code จริง)
- Secrets: `CF_ACCOUNT_ID`, `CF_ACCOUNT_ID_2..6`, `CF_API_TOKEN`, `CF_API_TOKEN_2..6` ครบ 6 บัญชี ✓
- `_shared/image-providers.ts:78-90` มี `cfCredsList()` ที่โหลด cf1..cf7 อยู่แล้ว
- `_shared/image-providers.ts:162-175` วนบัญชี cf1 → cf6 ตามลำดับคงที่
- 24h cost_log: `cf6` ถูกเรียก 400+ ครั้ง, `cf1` = ~40, **cf2/cf3/cf4/cf5 = 0** → รับรู้ว่ามีอยู่ แต่ไม่ได้ถูกใช้จริง (คงเพราะ cf1 คืน error ที่ไม่ใช่ billing-locked ในบางเคส แล้วโยนออกทันที ข้ามการ rotate)
- Global latch เก่าที่ `generation_settings.coloring_autopilot.cf_billing_locked_until = 2026-07-20` เป็นอดีต → ไม่บล็อกอยู่ แต่ถ้ามี 429 อีก บรรทัด 397 จะ latch ทั้ง CF ทันทีที่ **บัญชีเดียว**หมด (ผ่าน `cloudflareFluxSchnell` ที่โยน error ก้อนสุดท้ายออกมา ซึ่ง caller ไม่รู้ว่าบัญชีอื่นยังใช้ได้)

## สิ่งที่จะแก้ (permanent)

### 1. Per-account daily latch
เพิ่มโครงข้อมูลใน `generation_settings.coloring_autopilot.cf_account_latches`:
```json
{ "cf1": "2026-07-26T00:00:00Z", "cf3": "2026-07-26T00:00:00Z" }
```
- อ่านผ่าน `readCfAccountLatches(db)` (in-memory cache 30s ต่อ invocation)
- เขียนผ่าน `latchCfAccount(db, label)` — ตั้ง `locked_until = nextUtcMidnight()`
- Auto-expire: entry ที่ `locked_until <= now` ถือว่าปลดล็อค

### 2. `cfCredsList` filter latched accounts
`cfCredsList()` → รับ `latches` เป็น argument, กรองบัญชีที่ยัง latched ออก คืน list เหลือเฉพาะที่ใช้ได้

### 3. Round-robin start index
เพิ่ม `cf_rotation_cursor` ใน `generation_settings.coloring_autopilot` (integer 0..5)
- ก่อน render แต่ละครั้ง อ่าน cursor, เริ่มจาก `accounts[cursor % accounts.length]`, +1 แล้วเขียนกลับ
- Idempotent (best-effort update, race-tolerant)

### 4. เปลี่ยน `cloudflareFluxSchnell` behavior
- Loop เฉพาะ accounts ที่ **ไม่ได้ latched**
- ถ้า account คืน `FalBillingLockedError` → เรียก `latchCfAccount(db, label)` แล้ววนต่อ
- ถ้า **ทุกบัญชีที่ยังเหลือ** ยิง billing-locked → โยน FalBillingLockedError ก้อนเดียวขึ้นไป

### 5. เปลี่ยน caller ที่ line 395-397 ให้ latch global เฉพาะเมื่อ 6/6 บัญชี latched
- เช็ก `readCfAccountLatches` หลังจับ FalBillingLockedError
- Latch global (`cf_billing_locked_until`) ก็ต่อเมื่อจำนวน latched === จำนวน accounts ทั้งหมด
- ไม่งั้นแค่ mark bill-blocked เฉพาะ session นี้ แล้ว fallback ไปหา provider อื่น (runware/openai) ตาม policy

### 6. Reset state + kick pipeline
- Clear `generation_settings.coloring_autopilot.cf_billing_locked_until` ถ้ายังค้าง
- Clear `provider_billing_blocked.cloudflare`
- Clear `last_error` + `stage_attempt_count = 0` ให้หนังสือ 116 เล่มที่ค้างที่ `interior_render` ด้วย error `provider_billing_locked` เพื่อให้ tick หยิบต่อ

## ผลลัพธ์ที่คาดหวัง
- ใช้ neuron ครบ 60k/วัน (6× ของเดิมที่ latch หลุดที่ 10k)
- เมื่อบัญชีหนึ่งหมด อีก 5 บัญชียังทำงานต่อได้ทันที ไม่ต้องรอ 00:00 UTC
- Load กระจาย: cf1..cf6 ถูกใช้เฉลี่ยเท่าๆ กัน ไม่ใช่ cf6-heavy เหมือนตอนนี้
- Fallback provider (Runware/OpenAI) ทำงานเฉพาะกรณี 6/6 ล็อคจริงเท่านั้น

## Technical details
- ไฟล์ที่แก้: `supabase/functions/_shared/image-providers.ts` (ไฟล์เดียว, edit ในตำแหน่ง cfCredsList, cloudflareFluxSchnell, และ generateImage caller)
- Migration: ไม่ต้อง (ใช้ jsonb คีย์ใหม่ใน `generation_settings.coloring_autopilot` ที่มีอยู่แล้ว)
- One-off SQL: reset latch + attempt counters ผ่าน supabase read/insert tool
- Regression test: เพิ่ม unit test `coloringCfMultiAccountRotation.test.ts` ยิง mock ให้ cf1 429, cf2 200 → verify cf2 ถูกเรียก, latch เกิดที่ cf1 เท่านั้น, ไม่ latch global
