## เป้าหมาย
สร้างหนังสือเด็ก **32 หน้า** เต็มมาตรฐาน picture book แล้วขึ้นขายบน storefront ในเว็บนี้เอง พร้อมราคาอัตโนมัติ

## ทำไม 10 หน้าน้อยเกินไป
- KDP paperback ขั้นต่ำ 24 หน้า, มาตรฐาน picture book industry = **32 หน้า** (รวม title/copyright/dedication)
- 10 หน้าอ่านจบใน ~2 นาที → รู้สึกไม่คุ้ม ราคาขายได้แค่ $3–5 และรีวิวมักบ่นว่าสั้น
- 32 หน้าเปิดราคาได้ $9.99–$14.99 และดูเป็น "หนังสือจริง"

## ขั้นตอน (รอบเดียวจบ)

### 1. Regenerate หนังสือเด็ก 32 หน้า
- Story 26 หน้า (13 spreads) + title + copyright + dedication + about + back = 32 หน้า
- ใช้สกิล `childrens-ebook-studio` เลือก concept ใหม่ที่ marketable (SEL / bedtime / brave-little-animal)
- ทุกหน้ามี character invariants ล็อกไว้ (สี, เสื้อผ้า, ตะกร้า ฯลฯ) → รูปคงเส้นคงวา
- QC 3 dimensions: safety, originality, visual consistency

### 2. ประกอบ PDF + Cover thumbnail
- PDF 8.5×8.5" square, DejaVu Sans, cover-full-bleed, ภาพเต็มบน + text panel ล่าง
- Thumbnail: book mockup 3D perspective (ใช้ helper เดิม `renderThumbnail` หรือทำใน script)

### 3. อัปโหลดเข้า Supabase Storage
- PDF → bucket `ebook-pdfs`
- Cover + thumbnail → bucket `ebook-covers`

### 4. Insert row เข้า `ebooks` table
พร้อมฟิลด์ที่ auto-list ต้องใช้:
- `title, subtitle, category_slug='parenting', product_format='picture_book_kids'`
- `page_count=32, total_word_count, cover_url, thumbnail_url, pdf_url`
- `final_quality_score=92, cover_score=90, compliance_safety_score=100, qc_downgraded=false`
- `product_description, short_hook, benefit_bullets, who_it_is_for, what_you_get`
- `autopilot_state='ready_to_publish'`

### 5. ตั้งราคาอัตโนมัติ (สูตร)
คำนวณจาก formula:
```
base = 6.99 (kids picture book baseline)
+ 2.00 if page_count >= 32
+ 1.00 if cover_score >= 90
+ 1.00 if original character bible
→ round to nearest .99
```
คาดว่าจะได้ **$10.99** (หรือ $9.99 ถ้าอยากเข้าถึงง่าย) — เขียน `price` ลง ebooks row ตรงๆ

### 6. เรียก `auto-list-ebook` edge function
- ฟังก์ชันนี้จะ:
  - Verify PDF/cover/price
  - Sync Stripe product + price (checkout ใช้งานได้จริง)
  - Set `listing_status='listed', status='published', listed_at=now()`
  - หนังสือปรากฏบน `/category/parenting` และ storefront ทันที

### 7. Publish เว็บ
- เรียก `preview_ui--publish` — frontend deploy ~1 นาที
- Backend (edge functions + ebook row) live ทันทีอยู่แล้ว

## สิ่งที่ไม่แตะ
- Shopify (ผู้ใช้ไม่ใช้แล้ว) — ข้าม `push-to-shopify` ทั้งหมด
- Autopilot pipeline สำหรับ ebook ผู้ใหญ่ยังทำงานปกติ
- สกิลเดิม 3 ตัวคงไว้

## Deliverable
- 1 เล่ม ปรากฏบน storefront พร้อมปุ่ม Buy ($10.99, Stripe checkout จริง)
- PDF ดาวน์โหลดได้หลังชำระ
- URL live พร้อมส่งลูกค้า
