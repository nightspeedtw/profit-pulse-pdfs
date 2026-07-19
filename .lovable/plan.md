สาเหตุ retry หลายรอบที่ตรวจพบตอนนี้มี 4 จุดหลัก:

1. **Cover retry วนจาก metadata บวม**
   - `coloring_cover_single_attempt` และ `coloring_cover_ideogram_attempts` ยังมีข้อมูลใหญ่ประมาณ 10MB ต่อคีย์
   - ทำให้ทุกครั้งที่ระบบอัปเดตแถวนี้ backend ต้องเขียน JSON ก้อนใหญ่มาก เสี่ยง timeout/คิววน/ฐานข้อมูลหน่วง

2. **Cover มีไฟล์จริงแล้ว แต่ metadata cover contract หาย**
   - แถว `d6da92a8` มี `cover_url` และ `thumbnail_url` แล้ว
   - แต่ metadata ไม่มี `coloring_cover` / `coloring_cover_gate` ทำให้ขั้นต่อไปมองว่า cover ยังไม่ครบ แล้วกลับไปเส้นทาง cover retry ได้

3. **Assembly retry จากการเรียก `waiveOrBlock` ผิด signature**
   - ฟังก์ชันจริงรับ object เดียว
   - assembly เคยเรียกผิดรูปแบบบางจุด ทำให้เกิด `Cannot read properties of undefined (reading 'slice')` และวนกลับคิว

4. **Self-advance/requeue กำลัง retry ปัญหาเชิงเทคนิคเหมือนปัญหาคุณภาพ**
   - บาง blocker เช่น metadata missing, cover contract missing, assembly crash ควรถูกแก้ state/contract ก่อน ไม่ใช่ schedule retry ต่อเนื่อง

แผนแก้ถาวร:

1. **Patch assembly ให้ไม่ crash**
   - ตรวจทุกจุดที่เรียก `waiveOrBlock` ใน `coloring-book-assemble`
   - แก้ให้ใช้ object signature เท่านั้น
   - เพิ่ม guard ให้ `reasons` เป็น array เสมอ เพื่อไม่เกิด `.slice()` crash อีก

2. **ทำ metadata bloat cleanup แบบถาวร**
   - เพิ่ม sanitizer/compact helper ที่ล้าง `_rawBytes`, base64, transcript ยาว, reason ยาว ก่อน persist
   - จำกัด attempt history เหลือ 5 รายการจริงทุก write path
   - เพิ่ม regression test ว่า metadata attempt history ไม่มี raw bytes และไม่โตเกินเพดาน

3. **ซ่อม cover contract เมื่อมี cover_url แล้ว**
   - ถ้า `cover_url`/thumbnail มีอยู่ แต่ `coloring_cover` หรือ `coloring_cover_gate` หาย ให้สร้าง minimal accepted cover metadata จาก asset ปัจจุบัน
   - ไม่กลับไปจ่ายเงิน generate cover ใหม่ถ้า asset มีแล้ว
   - ใช้ publish-contract เป็นจุดบังคับ spelling non-waivable ต่อไป

4. **แยก technical retry ออกจาก quality retry**
   - technical crash/missing metadata/oversized metadata จะถูก mark เป็น incident/blocker ชัดเจน ไม่ยิง provider ซ้ำ
   - quality retry เฉพาะกรณีที่ยังต้อง generate asset จริง และอยู่ใต้ ceiling เท่านั้น

5. **กู้เล่ม `Superhero Unicorn Fantasy Coloring Book` ต่อจนจบ**
   - prune metadata ของเล่มนี้ให้เล็กลง
   - rebuild cover metadata contract จาก cover/thumbnail ที่มีอยู่
   - trigger assembly ด้วย `override_freeze:true`
   - ถ้า assembly ผ่าน ให้ chain publish ต่อ

6. **ยืนยันผล**
   - ตรวจว่าเล่มมี `pdf_url`, `cover_url`, `thumbnail_url`
   - ตรวจว่า metadata ไม่บวมซ้ำ
   - ตรวจ logs ว่าไม่มี retry loop ใหม่จาก cover/assemble