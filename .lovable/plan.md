Plan: ลบ overlay เก่าและสร้างปกใหม่ทดแทน

ขอบเขตที่ตรวจสอบแล้ว
- V2: live อยู่ 6 เล่ม → ทั้ง 6 มี `approved_cover_asset_id` และ `meta.overlay` ยังไม่ใช่ `premium_cover_overlay_v5_no_text_ever` (legacy overlay)
- V1: live อยู่ 12 เล่ม (book_type = 'coloring_book') ยังไม่ถูก archive ตามคำสั่ง cutover ก่อนหน้า
- ระบบปัจจุบันมี overlay v5 ที่ไม่วาดอะไรเลย (title วาดโดย Ideogram / textless fallback วาด title) แต่ไฟล์ปกเก่าที่ยังอยู่ใน storage ยังแสดง popups เก่า

งานที่ต้องทำ
1. ตรวจสอบและ lockdown กฎ
   - ยืนยัน `premium-cover-overlay.ts` v5 ยังคงไม่วาด chip/ribbon/banner/age pill
   - ยืนยัน OCR gate `cover-text-transcription.ts` ยัง reject token ห้าม (sale, ages, coloring, book, ...)

2. รีเซ็ต V2 live books เพื่อสร้างปกใหม่
   - อัปเดต `coloring_v2_books` 6 แถวให้ stage = 'cover', stage_attempt_count = 0, last_error = null
   - เรียก `coloring-v2-cover` สำหรับทุก book_id (fire-and-forget หรือ synchronous batch)
   - ติดตามให้ทุกเล่มผ่าน OCR gate ได้ `cover_final` asset ใหม่ที่ `meta.overlay = v5`
   - หลังจาก cover ใหม่พร้อม ให้ pipeline ดันไป `qc` → `publish` ตามปกติ

3. จัดการ V1 live books 12 เล่ม
   - ตัวเลือก A: archive ทั้งหมด และสร้าง V2 books ใหม่ทดแทน (fresh concept + interior + cover)
   - ตัวเลือก B: migrate ข้อมูลบางส่วน (title, theme, age_band) ไปสร้าง V2 book แล้วรัน V2 pipeline ใหม่
   - ตัวเลือกที่เหมาะสม: A หรือ B ขึ้นอยู่กับว่าต้องการเก็บเนื้อหาเดิมหรือไม่

4. อัปเดต storefront / cache
   - หลังจากปกใหม่พร้อมและ `publish_status = 'live'` ให้เคลียร์ CDN cache / signed URL cache
   - ตรวจสอบ `Kids.tsx`, `KidsCategory.tsx`, `ColoringProduct.tsx` ว่าไม่มี HTML overlay ทับปกอีก
   - ยืนยัน `KidsBookCard` ไม่วาด "AGES" badge / "SALE" ribbon ลงบนภาพปก

5. ตรวจสอบผลลัพธ์
   - สุ่มตรวจ 2-3 เล่มจากแต่ละ batch ด้วย OCR + สายตา
   - ตรวจสอบว่าไม่มี token ห้ามปรากฏในภาพปก

คำถามก่อนเริ่ม
1. ต้องการ migrate 12 เล่ม V1 ที่ยัง live ให้เป็น V2 ด้วยหรือไม่? หรือ archive แล้วปล่อยให้ autopilot สร้างใหม่?
2. ต้องการรีเจนเนอเรททันทีในทีนี้ หรือให้ autopilot legacy-cover sweep ค่อยๆ ทำงาน?
3. ต้องการเก็บ interior / PDF ของ V1 ไว้เป็นเวอร์ชันขาย หรือสร้าง interior ใหม่ทั้งหมดใน V2?

ความเสี่ยง
- การสร้างปกใหม่ 6+12 เล่ม อาจใช้ budget image ~$0.30-0.60 ต่อเล่ม
- หาก Ideogram ยัง bake คำห้ามเข้าไป OCR จะ reject แล้ว fallback ไป textless mode ซึ่งอาจทำให้ title ไม่ได้สไตล์เดียวกับ art
- V1 PDF ที่มี matter pages แบบเก่าอาจยังแสดง branding เก่าอยู่ หากต้องการ consistency ควรรัน V2 pipeline ใหม่ทั้งหมด