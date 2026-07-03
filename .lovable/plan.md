
## สถานะจริงตอนนี้ (จากฐานข้อมูล)

| กลุ่ม | จำนวน | ความหมาย |
|---|---|---|
| `queued_for_production` | 14 | รอคิว แต่ไม่ขยับ |
| `needs_admin` / `needs_admin_attention` | 13 | ค้างที่ `manuscript_qc` — ระบบยอมแพ้ รอมนุษย์ |
| `waiting_for_worker_slot` | 1 | The Credit Float Exit Protocol — ค้างที่ `cover` |
| `needs_action` | 1 | ยังไม่เริ่ม |

**สาเหตุหลักที่ทุกอย่างหยุด:**

1. **`generate-cover` ชน CPU Time exceeded** (เห็นใน edge logs) → เล่มที่ถือคิวอยู่ทำ cover ไม่จบ → เล่มอื่นรอไม่รู้จบ
2. **ไม่มี lock ค้างในตาราง `production_locks`** แต่ recovery worker ก็ไม่ได้ปล่อยเล่มถัดไปเดินหน้า → มี bug ในการ pick up
3. **13 เล่มค้าง `manuscript_qc` แบบ `needs_admin_attention`** — auto-fix ไม่ทำงานกับสถานะกลุ่มนี้ (worker กรองเฉพาะ `queued_for_production`)
4. **UI ไม่บอกว่ากำลังทำอะไร** — ผู้ใช้เห็นแต่ตัวเลข ไม่รู้ว่าติดตรงไหน ทำไม จะจบเมื่อไร

---

## แผนแก้ (3 เฟส)

### เฟส 1 — ปลดล็อกทันที (ไม่ต้องแก้โค้ด)
- ล้าง `production_locks` ที่ค้าง (ถ้ามี) + reset `The Credit Float Exit Protocol` กลับไป step ก่อน `cover`
- Reset `auto_fix_attempt_count = 0` ให้ 14 เล่ม `queued_for_production` + 13 เล่ม `needs_admin*` แล้วส่งกลับ `queued_for_production`
- Kick `autopilot-recovery-worker` ทันที

### เฟส 2 — แก้ producers ที่พังจริง (ต้นเหตุ)
- **`generate-cover` CPU timeout**: แยกงานหนัก (image generation + composite) เป็น 2 invocations, cache prompt result, ตัด retry loop ที่ไม่จำเป็น, ใส่ `EDGE_SAFE_DEADLINE_MS` เหมือน reader-qc
- **`render-pdf` วนซ้ำ auto-fix 3 รอบไม่ผ่าน**: log ให้ชัดว่า sub-score ไหนตก แล้ว mirror score ให้ถูกก่อน retry (bug คล้าย cover_thumb เดิม)
- **`manuscript_qc` → `needs_admin_attention`**: ให้ auto-fix ครอบสถานะนี้ด้วย (ไม่ใช่แค่ `queued_for_production`) + ถ้า repair 3 รอบไม่ผ่านให้ downgrade ไป rebuild from chapters แทน stop

### เฟส 3 — "Now Playing" Panel (ให้เห็นว่าระบบทำอะไรอยู่)
เพิ่ม card เดียวบนสุด Command Center ที่ตอบ 4 คำถาม:
1. **ตอนนี้กำลังทำอะไร?** → ชื่อเล่ม + step + heartbeat อายุกี่วินาที
2. **ทำไมหยุด?** → เหตุผลเป็นภาษาคน (เช่น "generate-cover ใช้ CPU เกิน กำลัง retry ครั้งที่ 2/3")
3. **ต่อไปจะทำอะไร?** → เล่มถัดไปในคิว + เวลาโดยประมาณ
4. **ต้องให้ฉันช่วยอะไรไหม?** → ปุ่ม "Fix All Stuck" + "Force Next Book" + link ไปดู logs
- Progress bar รวม: X/28 เล่มถึง Shopify draft
- Auto-refresh ทุก 5 วินาที

---

## รายละเอียดเทคนิค

**ไฟล์ที่จะแตะ:**
- `supabase/functions/generate-cover/index.ts` — แยก image gen ออกจาก composite step, ใส่ deadline guard
- `supabase/functions/render-pdf/index.ts` — log sub-score ที่ fail + persist ก่อน retry
- `supabase/functions/autopilot-recovery-worker/index.ts` — ครอบ `needs_admin_attention` ใน pickup query
- `supabase/functions/admin-data/index.ts` — เพิ่ม `now_playing` payload (active run + reason + next in queue)
- `src/components/admin/NowPlayingPanel.tsx` — component ใหม่
- `src/pages/Production.tsx` หรือ Command Center — mount panel ไว้บนสุด

**Migration (ไม่มีตารางใหม่)**: SQL อย่างเดียว — reset ebooks ที่ค้าง + ล้าง lock

**ไม่ทำ:**
- ไม่ลด threshold QC ใดๆ
- ไม่แตะ schema ตารางใหม่
- ไม่ทำ Phase 2 SEO
