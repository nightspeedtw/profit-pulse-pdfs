
# รีวิวเนื้อหา & ปรับปรุงหน้าปก — Barnaby's Wobbly Problem

## 1. บันทึกคะแนนรีวิวเข้า Memory

บันทึกคะแนนที่คุณให้ (Plot 9.5, Language 9, Illustrations 8.5, Overall 9/10) และแนวทาง cover art ที่เลือกเข้า project memory เพื่อใช้อ้างอิงในเล่มต่อไป

## 2. สร้างหน้าปกใหม่ด้วย Vine Typography Prompt

ใช้ Option 1 (เน้นตัวหนังสือที่ทำจากเถาวัลย์และธรรมชาติ) เป็น prompt หลัก generate ภาพปกใหม่ผ่าน image generation tool:

```
Children's book cover illustration, the title text "Barnaby's Wobbly Problem" 
is organically integrated into the environment. The letters are whimsically 
crafted out of living green vines, twisted branches, and colorful forest 
flowers, making the text fully part of the artwork. A cute badger character 
wearing a yellow vest is looking up at the wobbly vine letters in surprise. 
Enchanted forest background, soft sunbeams filtering through leaves, warm 
watercolor and ink storybook style, highly detailed, cozy and magical 
atmosphere, professional typography integrated into nature
```

Quality tier: **premium** (text legibility critical for book title)

## 3. บันทึก Cover Prompt Template เข้า Memory

บันทึก Option 2 (Format Logic template) เป็น reusable prompt template สำหรับหนังสือเด็กเล่มต่อไป:

```
Children's book cover, the title "[TITLE]" is organically integrated into 
the scene. The letters are made entirely out of [MATERIAL] and blend 
naturally with the environment. A cute [CHARACTER] is interacting with 
the letters. Beautiful [SETTING], pastel color palette, whimsical storybook 
illustration style, text is highly legible but completely part of the image, 
no flat digital font overlay
```

## 4. อัปเดตปกในระบบ

- Generate ปกใหม่ → อัปโหลดเข้า storage bucket `ebook-covers`
- อัปเดต `cover_url` ใน ebooks table
- ปกเดิมเก็บไว้เป็น backup

## 5. QA ตรวจสอบปกใหม่

- ตรวจความชัดของ title text
- ตรวจ character consistency (Barnaby ใส่เสื้อกั๊กเหลือง)
- ตรวจ overall composition และ mood

## สิ่งที่ไม่แตะ
- เนื้อหาภายในเล่ม (คะแนน 9/10 ผ่านแล้ว)
- ราคา $10.99 คงเดิม
- PDF ภายในไม่เปลี่ยน
