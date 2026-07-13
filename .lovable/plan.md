# อัปเกรด Kids Cover Prompt + รีเจนปกเดิม Barnaby

## 1. อัปเดต Memory — Kids Cover Prompt (v2 "Peppa Pig-style logo")

แทนที่ `mem/design/kids-cover-prompt.md` ด้วยเวอร์ชันใหม่ที่รวมกฎ 3 ชั้น:

**Layer A — Illustration base**
- Warm storybook / gouache-watercolor / Disney-Scholastic publishing quality
- Soft pastel palette, painterly texture, gentle lighting, cozy magical mood
- Main character = hero of cover, joyful expression, dynamic pose
- Background: whimsical แต่ clean เพื่อให้ character เป็น focal point

**Layer B — Custom illustrated title (สำคัญที่สุด)**
- ❌ ห้ามใช้ฟอนต์สำเร็จรูปทุกชนิด (ไม่ว่าจะ hand-drawn font ก็ตาม)
- ✅ ต้อง design ตัวอักษรใหม่ทั้งหมดแบบ **logo เฉพาะเรื่อง** (Peppa Pig / Bluey / Paddington / Gruffalo tier)
- ตัวอักษรหนา นุ่ม โค้งมน อ่านง่ายสำหรับเด็ก
- แต่ละตัวมี decorative element ที่ผูกกับเนื้อเรื่อง (เถาวัลย์, เบอร์รี่, ใบไม้, ดาว, หูสัตว์, หาง, เห็ด, ก้อนเมฆ ฯลฯ)
- คำที่สื่ออารมณ์ให้เอียง/โค้งตามความหมาย (เช่น "Wobbly" เอียงเล็กน้อย)
- Subtitle เป็น handcrafted font เล็กกว่า เข้าชุดกับ title

**Layer C — Composition & print**
- Character centered, title ใหญ่อ่านง่าย, breathing room เยอะ
- Ultra detailed, 8K, CMYK-friendly, print-ready

**Reusable Prompt Template** (จะบันทึกเป็น block พร้อม `[TITLE]`, `[CHARACTER]`, `[SETTING]`, `[STORY_MOOD]`, `[LETTER_DECOR_IDEAS]` placeholders + ตัวอย่าง Barnaby ที่ user ให้มาเป็น worked example)

## 2. อัปเดต Core Rule ใน `mem/index.md`

ปรับ core rule เดิมให้เข้มขึ้น:
> Kids picture book covers: title ต้องเป็น **custom illustrated logo เฉพาะเรื่อง** (Peppa Pig-tier) — ห้ามใช้ฟอนต์สำเร็จรูปแม้แต่ฟอนต์ hand-drawn, ตัวอักษรต้องมี decorative element ผูกกับ story (เถาวัลย์/ใบไม้/หูสัตว์/เบอร์รี่ ฯลฯ)

## 3. รีเจนปก Barnaby's Wobbly Problem ใหม่ (v3)

ใช้ template ใหม่กับ Barnaby โดย fill ค่าที่ user แนะนำ:
- B มีเถาวัลย์พัน
- o เป็นผลเบอร์รี่
- y ปลายเป็นใบไม้
- "Wobbly" เอียงเล็กน้อยสื่อความโยกเยก
- จุด i เป็นดอกไม้/ผลไม้
- ตัวอักษรหนา นุ่ม โค้งมน

**Steps:**
1. Generate `cover_v3.png` ด้วย `imagegen--generate_image` model=`premium` (text legibility critical), 1024×1280
2. Upload → `ebook-covers/bcbb9b53-.../cover_v3.png`
3. Sign URL (1 ปี) + update `ebooks.cover_url`, bump `cover_score`, `updated_at`
4. เก็บ v1/v2 เป็น backup ใน bucket (ไม่ลบ)
5. Regenerate `store_thumbnail` ผ่าน edge function `generate-store-thumbnail` (force=true) เพื่อให้ storefront ใช้ปกใหม่

## 4. QA ปกใหม่

- อ่านชื่อเรื่องออกที่ thumbnail 160px ✓
- ตัวอักษรแต่ละตัวมี decorative element ตามที่กำหนด ✓
- Barnaby (แบดเจอร์เสื้อกั๊กเหลือง) คงเส้นคงวา ✓
- ไม่มีฟอนต์สำเร็จรูปหลุด ✓

ถ้าไม่ผ่าน QA → regenerate อีก 1 รอบด้วย prompt ที่เข้มขึ้นก่อนจบ

## สิ่งที่ไม่แตะ
- เนื้อหาเล่ม, ราคา $10.99, PDF ภายใน
- ปกของหนังสือประเภทอื่นๆ (non-kids) — กฎนี้ใช้เฉพาะ kids picture book
