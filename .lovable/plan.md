# แผนถาวร: หยุดสัตว์พิการในหนังสือระบายสี V2

## รากของปัญหา (ยืนยันจากโค้ด)

หน้าปกใน "Bubbly Ocean Buddies" มีเต่าหัว 2 หัว / ครีบซ้อน เพราะ **pipeline V2 ไม่เรียก anatomy verifier เลย**:

- `supabase/functions/coloring-v2-render-page/index.ts` → ยิง Ideogram แล้ว upload ทันที ไม่มีการตรวจกายวิภาค
- `supabase/functions/coloring-v2-qc/index.ts` → เช็คแค่ 3 อย่าง: หน้าครบไหม, มีปก, มี title เท่านั้น pass = 92 คงที่
- โมดูล `_shared/coloring/anatomy-verify.ts` (v6 `deformity_hard_gate`) มีอยู่แล้ว ครบเครื่อง (deformity + recognizability + text-contamination) แต่ **V2 lane ไม่เคยเรียก** — ใช้อยู่แค่ใน V1 legacy

นี่คือ defect class ระดับ pipeline ไม่ใช่ bug รายเล่ม — แก้ที่ต้นทางครั้งเดียว จบทุกเล่มในอนาคต

## การแก้ (Defect-class fix, ไม่แตะเล่มเก่า)

### 1. Anatomy gate ที่ตอน render (ต้นน้ำ)
แก้ `coloring-v2-render-page/index.ts`:
- หลังได้ bytes จาก Ideogram แต่**ก่อน** `uploadAsset` → เรียก `verifyAnatomyBatch([{page, subject, bytes, mime, category_key, scene}])`
- `subject` + `category_key` + `scene` ดึงจาก `coloring_v2_page_plans` (มีอยู่แล้วใน plan.prompt แต่ต้อง persist เป็น columns — ดูข้อ 4)
- ถ้า `verdict.pass === false` และ `!degraded` → ทิ้ง bytes, retry ด้วย negative prompt ที่ inject defect classes (`extra_head`, `fused_limbs`, `two_heads`, etc.) เข้า `INTERIOR_NEGATIVE_PROMPT`
- `MAX_ATTEMPTS` เดิม = 3 → คงไว้ แต่ทุก attempt ต้องผ่าน verifier ก่อนถึงจะ upload
- ถ้า 3 attempts ยังไม่ผ่าน → บันทึก `coloring_v2_qc_findings` (rule_id=`anatomy_deformity_persistent`) และ park book ที่ `stage=needs_admin` + `blocker_reason=anatomy_unrecoverable_page_N` (แจ้งใน HealthIncidentBanner แล้วหยุดเผาเครดิต)
- ถ้า `verdict.degraded === true` (verifier ล่ม) → upload ตามปกติแต่ mark asset `metadata.anatomy_unmeasured=true` เพื่อให้ QC gate จับต่อ

### 2. Anatomy gate ที่ตอน QC (ปลายน้ำ safety net)
แก้ `coloring-v2-qc/index.ts`:
- ก่อน advance ไป `pdf` → ดึงทุก interior asset, batch-verify (batch 6 ภาพต่อ call เพื่อประหยัด token)
- Hard fail ถ้ามีหน้าใดๆ ที่ `pass=false && !degraded` → rewind ไป `interior_render` เฉพาะหน้านั้น (ลบ asset เดิม, re-queue) — ใช้ pattern เดิมที่ `qc-v2` มีอยู่แล้ว
- Hard fail ถ้า `unmeasured_pages.length > 0` → verifier ต้องกลับมาก่อนถึงจะปล่อยผ่าน (ไม่ให้ค่า default 92)
- คะแนน overall = `min(page anatomy_score)` แทน hardcoded 92

### 3. Negative prompt ที่ target deformity ตรงๆ
แก้ `_shared/coloring-v2/prompts.ts` `INTERIOR_NEGATIVE_PROMPT`:
- เพิ่ม: `two heads, extra head, duplicated head, fused faces, extra limbs, missing limbs, floating limbs, disembodied parts, wrong number of legs, wrong number of fins, mangled anatomy, deformed body, frankenstein composition`
- เมื่อ retry จาก verdict → concat defect classes ที่ verifier ระบุ (dynamic negative)

### 4. Persist subject/category บน page_plan
เพิ่มคอลัมน์ (migration): `coloring_v2_page_plans.subject text, category_key text, scene text`
- Backfill จาก `book.category_key` + parse จาก `prompt` (regex "a [subject]" หรือ store ตอน `coloring-v2-page-plan` สร้าง plan)
- แก้ `coloring-v2-page-plan/index.ts` ให้ persist 3 field นี้พร้อม prompt

### 5. Regression test (ปิดฝา defect class)
- `src/__tests__/coloring-v2-render-anatomy-gate.test.ts`: mock render → คืนภาพ "2 heads" → verify ว่า render loop ไม่ upload, retry, และ park ที่ attempt 3
- `src/__tests__/coloring-v2-qc-anatomy-safety-net.test.ts`: seed asset ที่ verdict fail → verify QC rewinds ไม่ advance
- `src/__tests__/coloring-v2-page-plan-persists-subject.test.ts`: verify plan row มี subject/category_key/scene

### 6. เล่มเก่า (36 เล่ม legacy + Bubbly Ocean Buddies)
- **ไม่แตะ** legacy 36 เล่มตามคำสั่งเจ้าของก่อนหน้า
- Bubbly Ocean Buddies: หลัง gate ทำงาน จะ re-verify ตอน sweep ปกติ — ถ้าเจ้าของสั่งให้ regen หน้าที่พิการ ค่อยรันเป็น task แยก

## Definition of Done
1. 3 fresh books ผ่านโดยไม่มี `anatomy_deformity_persistent` finding
2. Regression tests ทั้ง 3 pass
3. ไม่มีการลด threshold, ไม่มี bypass, ไม่มีการ manually แก้ QC score
4. เครดิตต่อเล่มจำกัด: ≤ 3 retries × page_count (คุมโดย MAX_ATTEMPTS + park mechanism)

## เทคนิคที่จะแตะ
- Files: `coloring-v2-render-page/index.ts`, `coloring-v2-qc/index.ts`, `coloring-v2-page-plan/index.ts`, `_shared/coloring-v2/prompts.ts`
- Migration: `coloring_v2_page_plans` add columns
- Tests: 3 ไฟล์ใหม่ใน `src/__tests__/`
- ไม่แตะ: legacy V1 code, cover pipeline (ปัญหานี้คือ interior)
