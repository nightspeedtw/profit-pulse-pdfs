# ทำไม LIVE แค่ 1 เล่ม + ทำไม CF โควตาหมด

## สาเหตุจริง (จากข้อมูลปัจจุบัน)

1. **LIVE ลดจากหลายเล่ม → เพราะ Bleed Sweep v16 รีเซ็ตเล่ม LIVE เอง**
   ตอน 12:12–12:15 UTC วันนี้ `coloring-v2-cover-bleed-sweep` รีเซ็ต 9+ เล่มที่เคย LIVE กลับไป stage `cover` (`bleed_sweep_v16_reset:edge_uniform_frame:top` / `edge_white_border:top`) → เล่มเหล่านี้ต้อง regenerate cover ใหม่ทั้งชุด นี่คือเหตุผลที่ยอด LIVE ตกลง ไม่ใช่การผลิตพัง

2. **CF โควตาหมดจริงทั้ง 7 บัญชี — latched ถึง 2026-07-26T00:00Z**
   `cf_account_latches` = cf1..cf7 ล็อกครบ, `paused: true`, `stage_attempt_count = 95` ที่เล่ม `Flutterwing` (interior_render) แปลว่าเล่มเดียวยิง CF ไปเกือบร้อยครั้งก่อนจะยอมรับว่าหมด

3. **CF โดนเผาเพราะ 3 เหตุพร้อมกันวันนี้**
   - Bleed sweep บังคับ regenerate cover 9+ เล่ม (แม้ cover ใช้ Gemini/OpenAI, แต่ระบบ tick วิ่งลูปดันเล่มค้างที่ interior_render ต่อ)
   - `interior-pacer.ts` ตั้ง `cf_daily_image_budget: 750` แต่ใช้เป็น "รวม" ไม่ใช่ "ต่อบัญชี" — และ code path ปัจจุบันไม่ได้ enforce กับ dispatcher จริง จึงยิงจน 429
   - เล่มที่โดน 429 ไม่ถูก park → tick หยิบมาลองใหม่ทุกรอบ = attempts นับพัน

## แผนแก้ (2 ส่วน: ตอนนี้ + ถาวร)

### A. ปลดสถานการณ์วันนี้ (ทำก่อน)
1. Park `Flutterwing Fairy Friends` (id `19e40d23`) → `pipeline_status = awaiting_quota_reset`, `next_retry_at = 2026-07-26T00:02Z` (ใช้ `parkColoringBook` ที่มีอยู่แล้ว) หยุด attempt 95→n
2. ตั้ง `generation_settings.paused = false` แล้วจำกัด tick ให้เดินเฉพาะ stage ที่ไม่ใช้ CF (page_plan / cover / publish / storefront) จนกว่า CF จะ reset — backlog 317 เล่ม page_plan และ 38 cover ทำต่อได้ทันที
3. หยุด bleed-sweep รอบต่อไปจนพ้น window CF-dry (ป้องกัน regen เพิ่ม)

### B. Permanent guardrails
1. **Auto-park on CF-dry**  
   ใน `_shared/image-providers.ts` (ตัว dispatcher CF) เมื่อได้ error `all N accounts daily-latched` ให้ throw เป็น `CfAllAccountsLatchedError` แล้ว `coloring-v2-interior-render` จับแล้วเรียก `parkColoringBook(db, id, "awaiting_quota_reset", err)` แทนที่จะ increment `stage_attempt_count`  
   → กฎ: **ไม่มีเล่มไหน stage_attempt_count > 5 เพราะ CF quota อีก**

2. **Per-account pacer enforced จริง**  
   แก้ `_shared/coloring/interior-pacer.ts` ให้:
   - เก็บ `cf_daily_image_budget` เป็น **ต่อบัญชี** (default 750 × 7 = 5,250 รูป/วัน)
   - `maxCfImagesThisTick` เช็ค latch + budget per-account, return `{ account, allowed }`
   - Dispatcher เรียกก่อนยิงทุกครั้ง; ถ้า `allowed=0` ทั้ง 7 → throw `CfAllAccountsLatchedError` ทันที (ไม่ยิง network เลย)

3. **Bleed-sweep policy**  
   ใน `coloring-v2-cover-bleed-sweep`:
   - เพิ่ม guard: ถ้าเล่ม LIVE อยู่ ให้ตั้ง flag `bleed_regen_pending = true` แทนที่จะ demote ทันที; tick หยิบมาซ่อมทีละเล่ม (One-Book-At-A-Time) ไม่ยัดเข้า queue พร้อมกัน
   - Batch cap = 3 เล่ม/รอบ (แทน 120)
   - Blackout window: sweep ทำงานเฉพาะเมื่อ `cf_account_latches` มีบัญชีว่างอย่างน้อย 3

4. **Tick priority ใหม่**  
   `coloring-v2-tick` เลือกงานจากรายการนี้ตามลำดับ:
   1. Book ที่ใกล้ `completed` มากสุด และ stage ไม่ใช้ CF
   2. Book ใน `awaiting_quota_reset` ที่ `next_retry_at ≤ now()` และมี CF บัญชีว่าง
   3. Book ใหม่ (queued/page_plan)  
   → เมื่อ CF dry: ระบบยังเดินหน้าเผาไฟฝั่ง text/cover ได้

## Technical details

- ไฟล์ที่แตะ:  
  `supabase/functions/_shared/image-providers.ts` (throw typed error)  
  `supabase/functions/_shared/coloring/interior-pacer.ts` (per-account budget shape)  
  `supabase/functions/coloring-v2-interior-render/index.ts` (catch → park)  
  `supabase/functions/coloring-v2-cover-bleed-sweep/index.ts` (soft-flag + batch cap + blackout)  
  `supabase/functions/coloring-v2-tick/index.ts` (priority reorder + wake sweep)
- ไม่แก้ threshold คุณภาพ / ไม่ bypass gate ตามกฎรากของโปรเจกต์
- Regression tests เพิ่ม 3 ไฟล์: `coloringCfAllLatchedPark.test.ts`, `coloringInteriorPacerPerAccount.test.ts`, `coloringBleedSweepBatchCap.test.ts`

## Acceptance
- เล่ม `19e40d23` เข้า `awaiting_quota_reset` ภายใน 1 tick (ไม่ยิง CF อีก)
- Backlog `page_plan` 317 → drain ≥ 20 เล่มใน 30 นาทีแม้ CF ยัง latched
- หลัง 00:00 UTC 26 ก.ค.: ระบบ auto-wake, ผลิต interior ต่อ, ไม่มีเล่มไหน `stage_attempt_count > 5` จาก CF
- Bleed sweep รอบถัดไปแตะเล่ม LIVE ไม่เกิน 3 เล่ม/รอบ และเฉพาะเมื่อ CF ว่าง
