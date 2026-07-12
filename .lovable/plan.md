## เป้าหมาย
เพิ่ม skill ใหม่ **childrens-ebook-studio** สำหรับสร้างนิทาน/หนังสือการ์ตูนเด็กภาษาอังกฤษ (อายุ 0–12) แบบครบวงจร โดย **คงสกิลเดิมทั้ง 3 ตัว** (`premium-ebook-master`, `shopify-product-expert`, `world-class-cover-designer`) ไว้ครบ เพื่อให้ระบบยังขายได้หลายหมวดหมู่

## ที่มาของเนื้อหา
ใช้ไฟล์จาก `skill.zip` ที่อัปโหลด — โครงสร้างสมบูรณ์แล้ว 7 ไฟล์:
- `SKILL.md` — workflow หลัก, defaults (32-page, 8.5×8.5", ages 4-7), originality rules, QC autopilot สูงสุด 3 รอบ
- `references/story-engine.md` — age bands, plot architecture
- `references/illustration-system.md` — character bible + illustration prompts (ควบคุมความสม่ำเสมอของหน้าตา/เสื้อผ้า/สี)
- `references/qc-system.md` — hard gates + scoring
- `references/output-schema.md` — JSON schema สำหรับ pipeline
- `references/lovable-build-prompt.md` — prompt สำหรับสร้าง Storybook Studio app
- `agents/openai.yaml`

## ขั้นตอนดำเนินการ
1. คัดลอกโฟลเดอร์ `childrens-ebook-studio/` จาก zip ไปที่ `.agents/skills/childrens-ebook-studio/`
2. เรียก `skills--apply_draft` เพื่อเปิดใช้งาน skill ใหม่
3. ยืนยันว่าสกิลเดิม 3 ตัวยังอยู่ครบ ไม่ถูกแตะต้อง

## สิ่งที่จะ**ไม่**ทำในรอบนี้
- ไม่แก้ pipeline edge functions หรือ autopilot ปัจจุบัน (สกิลใหม่จะถูก AI หยิบใช้อัตโนมัติเมื่อ prompt เกี่ยวกับหนังสือเด็ก)
- ไม่แตะสกิลเดิม
- ไม่สร้างหมวดหมู่ใหม่ใน `CategoryGrid` หรือฝั่ง storefront (แจ้งไว้เผื่ออยากทำต่อรอบหน้า)

## Optional (ทำต่อได้ถ้าอยากให้ autopilot ผลิตหนังสือเด็กจริงในไลน์การผลิต)
- เพิ่มหมวด `kids_picture_book` ใน `supabase/functions/_shared/category.ts`
- เพิ่ม branch ใน `write-chapters` / `generate-cover` / `final-manuscript-qc` ที่อ่านสไตล์จากสกิลนี้
- เพิ่มหมวด "Kids & Picture Books" ใน `CategoryGrid.tsx`

แจ้งได้เลยครับว่าจะเอาแค่ติดตั้งสกิลก่อน หรือให้ทำ Optional ต่อในรอบเดียว
