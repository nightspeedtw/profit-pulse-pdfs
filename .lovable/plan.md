# แผนแก้ปัญหา: Cover Split v1 Race Condition (ต้นเหตุที่ทำให้ `d6da92a8` และเล่มอื่นค้าง)

## ปัญหาที่พบ (จากรอบก่อน)
เล่ม `d6da92a8` interior เสร็จหมด 32 หน้าแล้ว แต่ไปต่อไม่ได้เพราะ **cover ค้างที่ generate→verify loop**:

1. `coloring-cover-generate` สร้างรูปสำเร็จ อัปโหลดขึ้น storage แล้ว
2. เรียก `patchMeta()` เพื่อเซ็ต `cover_pending_verify` ใน `ebooks_kids.metadata`
3. `patchMeta` เป็น **read-modify-write** (อ่าน meta → merge → update ทั้งก้อน) ไม่ atomic
4. Fire-and-forget เรียก `coloring-cover-verify` ทันที
5. verify อ่าน meta **เวอร์ชันเก่า** (ก่อน patch ลง) → เจอ `no_pending_verify` → ออก
6. ผลลัพธ์: รูปถูกสร้างแล้วทิ้ง, `invocations` เพิ่มขึ้นเรื่อยๆ, เล่มไม่ไปต่อ, ค่าใช้จ่ายไหลไม่หยุดจนชน ceiling 8

ปัญหานี้กระทบ **ทุกเล่มที่ผ่าน cover split v1** ไม่ใช่แค่เล่มเดียว

## สิ่งที่จะแก้ (3 จุด)

### 1. เปลี่ยน `patchMeta` เป็น atomic JSONB update (แก้ระดับ class)
- แทน read-modify-write ด้วย SQL `jsonb_set` / `||` ในคำสั่ง update เดียว
- ใช้ optimistic concurrency: `WHERE id = ? AND (metadata->>'cover_gen_seq')::int = ?`
- ทุก writer ของ metadata (generate, verify, publish) ผ่าน helper เดียวกัน
- ย้ายไป `_shared/kids-metadata.ts` เพื่อไม่ให้มี patch logic กระจายในหลายไฟล์

### 2. เปลี่ยน generate→verify จาก fire-and-forget เป็น awaited chain
- `coloring-cover-generate` เขียน pending → **await** call `coloring-cover-verify` ก่อน return
- ถ้า verify pass → advance state, ถ้าไม่ pass → คืนเข้า retry pool ตามปกติ
- ตัด race หมด: state ที่ verify เห็นคือ state ที่ generate เพิ่งเขียนแน่นอน

### 3. Ceiling refund เมื่อ generate สำเร็จแต่ verify race ตก
- ป้องกันไม่ให้ `invocations` เพิ่มเวลาที่ failure เกิดจาก race ของระบบเราเอง (ไม่ใช่ provider fail)
- นับ invocation เฉพาะเมื่อเรียก provider จริง ไม่ใช่ทุก HTTP hit

## Regression test (ตามกฎ AGENTS.md)
- Fixture: mock generate สำเร็จ 3 ครั้งติด, verify ต้อง pass ครั้งแรก ไม่วนซ้ำ
- Test ต้อง fail ก่อน patch, pass หลัง patch
- Vitest ใน `supabase/functions/**/__tests__/`

## หลังแก้เสร็จ
- Reset `d6da92a8` เฉพาะ cover metadata (interior 32 หน้า preserve ไว้)
- ปล่อยเล่มเดียว ไม่ปลด autopilot freeze ตามคำสั่งเดิม
- ถ้า LIVE แจ้งผล; ถ้ายังติด แจ้ง incident ใหม่ทีละอย่างตาม policy freeze

## ไฟล์ที่จะแตะ
- `supabase/functions/_shared/kids-metadata.ts` (เพิ่ม atomic helper)
- `supabase/functions/coloring-cover-generate/index.ts` (await verify + refund)
- `supabase/functions/coloring-cover-verify/index.ts` (อ่าน meta หลัง patch)
- `supabase/functions/**/__tests__/coverGenerateVerifyRace.test.ts` (ใหม่)

## ไม่แตะ
- Autopilot freeze (ยังคงอยู่)
- Ceiling / budget (ไม่เปลี่ยน)
- Story gate / rulebook / QC thresholds

เอาแผนนี้ไหมครับ หรือให้ทำเฉพาะข้อ 2 ก่อน (เร็วสุด แต่ไม่ atomic 100%)?