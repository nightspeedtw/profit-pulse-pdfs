## ปัญหา

Flow ปัจจุบันของ 3 เล่ม smoke test ค้างที่ `manuscript_qc` เพราะ auto-repair ครบ 3 รอบแล้วยัง fail (unsafe wording, template phrases, worksheet mismatch) แล้วเปลี่ยน status เป็น `needs_admin_attention` — ทำให้ pipeline หยุดรอคนกดปุ่ม ซึ่งขัดกับหลัก "autopilot จบเองทั้งหมด"

รากเหตุ 3 จุด:
1. **`final-manuscript-qc`** — เมื่อ auto-fix loop หมด attempts, mark step = `needs_admin_attention` แทนที่จะปล่อยผ่านหรือ regenerate chapter
2. **`autopilot-pipeline` orchestrator** — เจอ terminal-fail แล้ว halt run แทนที่จะเดินหน้าไปทำปกและ publish ต่อ
3. **`daily-cron` publish gate** — ต้องการ `compliance_safety_score ≥ 70` และ `final_quality_score ≥ minimum_qc_pass_rate` ถ้าไม่ผ่าน = skip ตลอดกาล ต้องรอ admin

## แผนแก้ (ให้ autopilot จบเองได้ 100%)

### 1. เพิ่ม self-heal escalation ขั้นสุดท้ายใน `final-manuscript-qc`
เมื่อ auto-fix attempt = 3 แล้วยัง fail:
- **แทนที่จะ escalate ไปหา admin** → เรียก `write-chapters` ใหม่เฉพาะ chapter ที่ fail (targeted regenerate) อีก 1 รอบ
- ถ้ายัง fail → **soft-pass**: mark step เป็น `passed` พร้อม `qc_downgraded=true` และบันทึก issues ลง `ebooks.qc_notes` (ให้ admin ดูย้อนหลังได้ แต่ไม่บล็อค pipeline)

### 2. ปรับ orchestrator `autopilot-pipeline`
- ลบเงื่อนไข halt-on-terminal-fail สำหรับ QC steps (`manuscript_qc`, `reader_experience_qc`, `cover_qc`, `thumbnail_qc`, `pdf_qc`, `product_page_qc`) — ให้ soft-pass และเดินหน้าเสมอ
- คงการ halt เฉพาะ hard failures (missing PDF, missing cover URL, storage upload fail — ปัญหา infra จริง)

### 3. ปรับ `daily-cron` publish gate ให้ยืดหยุ่น
- ลด `minimum_qc_pass_rate` gate เป็น warning เท่านั้น (log แต่ไม่ skip) เมื่อ `settings.autopilot_mode = "full"` และ `auto_publish = true`
- คง gate เฉพาะสิ่งที่ทำให้ ebook ขายไม่ได้จริง: `pdf_url`, `cover_url`/`thumbnail_url`, `price > 0`, listing copy
- ปลด `compliance_safety_score` gate (เพราะ compliance ถูก downgrade แล้วใน step 1)

### 4. ปลดล็อค 3 เล่มปัจจุบันทันที (one-shot script)
สำหรับ Cash Flow, Functional Burnout, Anti-Scramble OS:
- Mark `manuscript_qc` step = `passed` พร้อม `qc_downgraded=true`
- Clear terminal_fail status บน run
- Trigger `autopilot-pipeline` resume เพื่อให้เดินหน้าไปสร้างปก → PDF → publish

### 5. อัปเดต Smoke Test Live dashboard
- แสดง badge "QC Soft-Pass" สีเหลืองแทน "Needs Admin" สีแดง เมื่อ step ผ่านแบบ downgraded
- ไม่แสดงปุ่ม "Override" อีก (เพราะระบบทำเองแล้ว)

## Technical Details

**Files to edit:**
- `supabase/functions/final-manuscript-qc/index.ts` — เพิ่ม targeted-regenerate ก่อน soft-pass
- `supabase/functions/autopilot-pipeline/index.ts` — เปลี่ยน terminal-fail behavior สำหรับ QC steps
- `supabase/functions/daily-cron/index.ts` — ลด publish gates เหลือ hard-requirements
- `src/pages/admin/SmokeTestStatus.tsx` — badge สีใหม่
- SQL insert one-shot (via `supabase.insert`) — mark 3 steps เป็น passed + downgraded

**Config flags ที่จะเพิ่มใน `generation_settings`:**
- `autopilot_soft_pass_enabled` (default true) — เปิด/ปิดกลไก soft-pass
- `autopilot_max_regen_attempts` (default 1) — targeted regenerate กี่รอบก่อน soft-pass

## Risks & คำถาม

**Trade-off:** Books จะ publish ได้แม้ content ยังมี unsafe wording/template phrases อยู่บ้าง — พึ่ง QC score notes ย้อนหลังแทน hard gate

**คำถามยืนยันก่อนลงมือ:**
1. Soft-pass = publish ทันทีถึงจะมี content warning หลงเหลือ → OK ไหม? หรืออยากให้ soft-pass แค่ smoke test แล้ว production ยังคง gate เดิม?
2. ให้ปลด 3 เล่มปัจจุบันด้วย mechanism ใหม่นี้เลย หรือปลดมือแยกก่อน แล้วค่อย deploy กลไก?
