
## Diagnosis (จาก DB จริง)

- **92bbc7de** มี **13 runs** (3 running + 10 queued) · **86dda212** = 8 · **9657b843** = 8 · **f138ad1a** = 7 · หลายเล่ม 3–4 runs
- มี **4 ebook รันพร้อมกัน** (`92bbc7de` × 3 running, `9657b843`, `f138ad1a`, `79f883af`) → **Sequential Safe Mode พัง**
- `heavy_production` lock ถือโดย `9657b843` แต่ ebook `2d81879c` ยังโชว์เป็น "holder" ใน queue messages (stale)
- `canonical_status` = NULL ทุกเล่ม → RunTracker sync ไม่ลง / ไม่เขียนจริง
- **สาเหตุจริงของ "เนื้อเรื่องซ้ำ + หน้าปกซ้ำ":** ทุกครั้งที่ recovery worker / retry เตะเล่มเดิม มันสร้าง **run ใหม่** แทนที่จะ resume run เดิม → เขียน chapter / cover ทับซ้ำใหม่หมด

## เป้าหมาย

1. ล้างข้อมูลซ้ำที่มีอยู่ (runs ซ้ำ + cover/chapter ซ้ำ)
2. แก้โค้ดถาวรไม่ให้เกิดอีก (1 ebook = 1 active run, 1 slot heavy production)
3. Sequential Safe Mode ต้อง enforce ที่ DB level ไม่ใช่แค่ app logic

---

## Phase 1 — Data Cleanup (ทำครั้งเดียวตอนนี้)

1. **ล้าง lock ค้าง** — DELETE จาก `production_locks` ทั้งหมด แล้วให้ระบบ acquire ใหม่
2. **ยุบ runs ซ้ำ** — สำหรับทุก ebook ที่มี run > 1:
   - เก็บ run **ล่าสุด** ที่มี progress สูงสุด → set = `queued`
   - runs อื่น → set = `superseded` (สถานะใหม่)
3. **ล้าง duplicate ebook_chapters** — เก็บเวอร์ชันล่าสุดต่อ `(ebook_id, chapter_number)`
4. **ล้าง duplicate cover_url / cover assets** — ถ้าเล่มเดียวมีหลาย cover asset ใน `ebook_assets`, เก็บ latest, ลบตัวก่อนหน้า (ไฟล์ใน storage bucket ด้วย)

## Phase 2 — Schema Guardrails (กันไม่ให้เกิดอีก)

Migration:

1. เพิ่ม status `superseded` ใน enum runs
2. **Partial unique index** บน `autopilot_pipeline_runs`:
   ```sql
   CREATE UNIQUE INDEX one_active_run_per_ebook
   ON autopilot_pipeline_runs (ebook_id)
   WHERE status IN ('queued','running','waiting');
   ```
   → DB จะ **ปฏิเสธ** การสร้าง run ที่ 2 ให้เล่มเดียวกันโดยตรง
3. **Partial unique index** บน `ebook_chapters (ebook_id, chapter_number)` → กัน chapter ซ้ำ
4. แก้ `try_acquire_lock` — ตัดเงื่อนไข `holder_ebook_id IS NOT DISTINCT FROM EXCLUDED.holder_ebook_id` ออก (บรรทัดนี้ปล่อยให้ ebook เดิม re-take lock แล้วรันซ้อนได้) → เหลือแค่ acquire ได้เมื่อ `expires_at < now()` เท่านั้น

## Phase 3 — Code Fixes (ถาวร)

1. **`autopilot-orchestrator` / จุด start run:**
   - ก่อน insert run ใหม่ → query `autopilot_pipeline_runs` ว่ามี active run ของ ebook นี้อยู่ไหม
   - ถ้ามี → **resume** run เดิม (return existing id) ห้ามสร้างใหม่
2. **`autopilot-recovery-worker`:**
   - ให้แตะเฉพาะ run ที่ `status IN ('waiting','failed_recoverable')`
   - ห้าม insert run ใหม่ ใช้ UPDATE เท่านั้น
3. **`autopilot-pipeline` (heavy production lock):**
   - เปลี่ยน lock name ให้ global คงที่ = `heavy_production` (เป็นอยู่แล้ว) แต่ **holder_ebook_id ต้องเช็คว่าไม่ใช่ตัวเอง ก็ยัง block** (ปิดช่องเดิมที่ ebook ตัวเองยิงซ้อนได้)
   - ก่อน acquire lock → เช็คว่า run นี้ยังคง canonical run ของ ebook (ไม่ใช่ superseded)
4. **RunTracker.syncEbook:**
   - Log ผลลัพธ์การ update `canonical_status` ให้เห็น (ตอนนี้ NULL แปลว่า update ไม่ลง)
   - เพิ่ม fallback: ถ้า update failed → retry 3 ครั้งพร้อม log error
5. **UI:**
   - Production/Live queue: dedupe display by `ebook_id` — โชว์ 1 การ์ด/เล่ม ใช้ run ล่าสุด
   - เพิ่ม badge "1 in production · N queued" ให้เห็นชัด

## Phase 4 — Verification

1. รัน SQL: `SELECT ebook_id, count(*) FROM autopilot_pipeline_runs WHERE status IN ('running','queued','waiting') GROUP BY ebook_id HAVING count(*) > 1;` → ต้องได้ 0 rows
2. รัน: `SELECT count(*) FROM autopilot_pipeline_runs WHERE status='running';` → ต้องได้ ≤ 1
3. เปิดหน้า Command Center → Focus Badge โชว์เล่มเดียว, Queue โชว์รายการเรียง 1,2,3
4. ทริกเกอร์ retry เล่มเดิมด้วยมือ → ต้องไม่มี run ใหม่เกิด (resume แทน)

---

### Technical section

- Migration adds enum value + 2 partial unique indexes + rewrites `try_acquire_lock`.
- Cleanup uses transactional UPDATE (not DELETE) — เก็บประวัติ runs ทุกตัวไว้เป็น `superseded`
- Storage cleanup ใช้ `admin.storage.from('ebook-covers').remove([...])` สำหรับไฟล์ orphan
- ไม่ต้องเปลี่ยน front-end นอกจาก dedupe display logic ใน `LiveProductionQueue` และ `Production.tsx`
- Sequential Safe Mode หลังแก้: **DB บังคับ** 1 active run / ebook + lock บังคับ 1 heavy production ทั่วระบบ → ไม่พึ่ง app logic อีกต่อไป
