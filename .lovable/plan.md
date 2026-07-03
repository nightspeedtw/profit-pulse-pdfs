Do I know what the issue is? Yes.

ปัญหาหลักไม่ใช่แค่ PDF renderer ตัวเดียว แต่คือ Autopilot ยังไม่มี “backend self-healing supervisor” ที่ถือเป็นแหล่งตัดสินใจเดียว ระบบบางจุดยังหยุดที่ `needs_review`/`needs_admin_attention`, บาง auto-fix ต้องรอให้หน้า UI render ก่อนถึงจะยิงเอง, และบาง error ไม่ถูกแปลงเป็น “กำลังแก้เอง / รอลองใหม่ / ต้องแก้โค้ดพร้อม prompt” ทำให้ผู้ใช้เห็นเหมือนระบบนิ่งและไม่รู้ต้องทำอะไรต่อ

Plan to fix permanently

1. Create a single Autopilot Recovery Contract
- ทุก step ต้องจบด้วยสถานะเดียวใน 5 แบบเท่านั้น:
  - `working` = กำลังทำเล่มนี้อยู่
  - `queued` = รอคิว เพราะ Sequential Safe Mode
  - `waiting_retry` = รอ slot/quota/worker แล้วจะกลับมาทำเอง
  - `auto_fixing` = เจอ QC/dependency issue และกำลังซ่อมเอง
  - `needs_code_fix` = auto-fix ครบ 3 ครั้งแล้วยังไม่ผ่าน พร้อม Lovable prompt
- ห้ามใช้สถานะเงียบ ๆ เช่น failed/needs_review โดยไม่มี `blocker_reason`, `structured_error`, `next_action`, และ `lovable_prompt` เมื่อจำเป็น

2. Move auto-fix trigger from UI to backend worker
- ตอนนี้ `QcGateCard` ช่วย auto-fix เมื่อหน้า dashboard เปิดอยู่ ซึ่งไม่พอ
- เพิ่ม logic ใน recovery worker ให้ scan ebook ที่ QC gate ไม่ผ่าน:
  - formatter
  - reader
  - cover_pdf
  - cover_thumb
- ถ้ายังไม่ครบ 3 ครั้ง ให้เรียก targeted auto-fix เองทันที
- ถ้าครบ 3 ครั้งแล้วยังไม่ผ่าน ให้สร้าง `system_fix_instructions` พร้อม prompt แก้ Lovable โดยอัตโนมัติ
- UI จะเป็นแค่ตัวแสดงผล ไม่ใช่ตัวที่ทำให้ระบบเดินต่อ

3. Fix PDF pipeline state machine so it cannot stall
- PDF step ต้องมี strict decision tree:
  - missing manuscript/chapters → route back to writing/manuscript build
  - missing cover → route back to cover generation
  - Browserless 429/lock busy → `waiting_for_browserless_slot` + retry time
  - PDF rendered but QC failed → `auto_fixing` + rerender reason + attempt count
  - PDF still fails after attempts → `needs_code_fix` + prompt naming exact gate and producer
- ลบพฤติกรรม “soft-pass แล้วค่อยมาติดท้าย pipeline” เพราะทำให้ดูเหมือนผ่านแต่สุดท้ายโดนบล็อก

4. Make every blocker visible and actionable
- ทุก ebook/run ต้องเขียนข้อมูลต่อไปนี้เสมอเมื่อมีปัญหา:
  - `canonical_status`
  - `blocker_class`
  - `blocker_reason`
  - `structured_error`
  - `next_retry_at`
  - `current_step`
  - `current_subtask`
  - `progress_pct`
  - `last_heartbeat_at`
  - `auto_fix_attempt_count`
  - `next_recommended_action`
- ถ้าเกิด bug ใหม่ที่ classifier ไม่รู้จัก ให้ default เป็น “Needs Code Fix” พร้อม prompt ไม่ใช่ failed เฉย ๆ

5. Expand the error classifier
- เพิ่ม signatures สำหรับปัญหาที่เจอบ่อยและยังอาจหลุดเป็น error เงียบ:
  - PDF no file / storage upload failed
  - cover_pdf never reaches 100
  - thumbnail mockup below 90
  - reader QC stuck after repairs
  - Shopify draft guard blocked by QC
  - worker wait expired but not resumed
  - stale lock / stale heartbeat / lock holder mismatch
  - unknown function 4xx/5xx after retries
- ทุก signature ต้องระบุ:
  - root cause
  - affected producer function
  - automatic recovery action
  - whether code fix is needed
  - Lovable prompt with acceptance test

6. Strengthen the recovery worker loop
- Worker ต้องทำงานเป็น tick model:
  1. release truly stale locks
  2. resume waiting retry jobs whose time arrived
  3. dispatch exactly one queued production ebook
  4. auto-fix QC-blocked ebooks
  5. escalate stuck retries to Needs Code Fix
  6. resume Shopify upload queue when ready
- ต้องไม่เริ่มหลายเล่มพร้อมกัน: heavy production lock remains concurrency 1
- ถ้า current book รอ Browserless/worker slot ให้เล่มอื่นยัง pause/queue ตามกฎ “ทำทีละเล่มให้เสร็จ”

7. Enforce final readiness before Shopify draft
- ก่อน upload Shopify draft ต้องผ่านทุก gate:
  - manuscript built and Reader QC pass
  - formatter QC >= 90
  - cover PDF full A4 = 100
  - thumbnail mockup/readability/premium/click appeal >= 90
  - PDF URL exists and downloadable
  - cover/thumbnail URL exists
  - product copy and pricing ready
- ถ้า gate ใดไม่ผ่าน: ไม่ upload, แต่ auto-fix ทันทีและแสดงว่า “ติด gate ไหน / กำลังแก้ครั้งที่เท่าไหร่”

8. Make Shopify draft the Phase 1 finish line
- เปิดเส้นทาง pipeline ให้ไปถึง `shopify_draft` และ `shopify_verify` ตามเป้าหมาย Phase 1
- ถ้า setting ปิด auto-upload อยู่ ให้ระบบแสดงชัดว่า “ผลิตเสร็จแล้ว แต่ upload ถูกปิดโดย setting” ไม่ใช่เหมือนค้าง
- ถ้าเปิด auto-upload: ใช้ Shopify Upload Queue และ verify draft หลัง upload

9. Improve Command Center / Production visibility
- เพิ่ม/ปรับ sections ให้ชัดเจน:
  - Working On: เล่มที่ lock ถืออยู่ตอนนี้ พร้อม heartbeat age
  - Queued Next: เล่มรอคิวพร้อม position
  - Waiting / Auto Retry: รอ slot/quota/worker พร้อมเวลาลองใหม่
  - Auto-Fixing: gate ที่กำลังแก้, attempt x/3, reason
  - Needs Code Fix: prompt ที่ copy ได้ทันที
  - Ready for Shopify Draft: ผ่าน gate ทั้งหมดและรอ upload/verify
- แสดง “ทำต่อเองเมื่อไหร่” และ “ถ้าซ่อมเองไม่ได้ จะส่ง prompt อะไรให้ Lovable”

10. Add acceptance tests after implementation
- Start 2 ebooks at once → exactly one Working On, one Queued
- Force missing outline → routes back to outline, then writes chapters
- Force PDF QC fail → auto-fix without dashboard click
- Force 3 failed cover_pdf repairs → creates Needs Code Fix prompt
- Force Browserless 429 → waits and resumes, no red failed state
- Force reader timeout → waiting worker slot, then resumes
- Complete passing ebook → reaches Shopify draft/verify or clearly reports upload setting disabled

Expected result
- ระบบจะไม่ค้างเงียบ
- ถ้าซ่อมเองได้ ระบบซ่อมเอง
- ถ้าซ่อมเองไม่ได้ ระบบสร้าง prompt ให้ Lovable พร้อมไฟล์/สาเหตุ/acceptance test
- ผู้ใช้เห็นตลอดว่าเล่มไหนกำลังทำอยู่, ติดอะไร, จะลองใหม่เมื่อไหร่, และต้องแก้อะไร
- Autopilot จะพยายามไปให้ถึง Shopify draft แบบทีละเล่มตาม Sequential Safe Mode

<presentation-actions>
  <presentation-open-history>View History</presentation-open-history>
</presentation-actions>

<presentation-actions>
<presentation-link url="https://docs.lovable.dev/tips-tricks/troubleshooting">Troubleshooting docs</presentation-link>
</presentation-actions>