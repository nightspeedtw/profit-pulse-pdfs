## เป้าหมาย
ยกระดับหน้าปกให้มี **custom illustrated title lettering** สวยระดับตัวอย่าง (The Last Message, Amazing Earth & Space, Glitch City Grit) + เพิ่ม **Age Badge** บนปก

## 1. อัปเกรด Title Lettering (prompt overhaul)
แก้ `supabase/functions/coloring-v2-illustrated-cover-once/index.ts`:
- เพิ่มโหมด lettering ที่เลือกตาม theme ด้วย hash (แทน mood เดียว):
  - **chunky_puffy_multicolor** — ตัวอักษรบวมกลม แต่ละตัวคนละสี มีดาว/ประกาย (แบบ Amazing Earth & Space)
  - **cracked_metal_epic** — ตัวหนาเหมือนโลหะแตก มีสายฟ้า/รอยร้าว (แบบ The Last Message)
  - **arcade_chrome_neon** — chrome + neon glow ขอบ (แบบ Glitch City Grit)
  - **hand_painted_storybook** — สีน้ำมือวาด (คงของเดิม)
  - **balloon_bubble_gradient** — ตัวอักษรลูกโป่ง gradient
  - **wood_carved_adventure** — ป้ายไม้แกะสลัก (แบบ Dragon Saddle Stories)
- prompt บังคับ: ตัวอักษรวาดมือทีละตัว, ห้ามใช้ system font, ตัวอักษรเป็นส่วนหนึ่งของภาพประกอบ, มี texture/highlight/shadow, ตัวใหญ่กินพื้นที่บน 40-50% ของปก
- คง full-bleed + spelling verification (SVG verifier) ไว้

## 2. Age Badge บนปก (ใหม่)
เพิ่ม `age_badge` เป็นส่วนของ prompt:
- วงกลม/รูปดาว มุมขวาบนหรือขวาล่าง
- ข้อความ "AGES 2-4" / "4-6" / "6-8" / "8-12" / "13-17" ตาม `age_band`
- สีตัดกับพื้นหลัง (เหลือง/ส้ม/แดง)
- Ideogram/Gemini วาดเป็นส่วนหนึ่งของภาพ (ไม่ใช่ overlay)
- เพิ่ม age tokens เข้า OCR allowlist ไม่ให้ spelling gate ตี fail

## 3. Regression Tests
- `coloring-cover-lettering-variety.test.ts` — hash เดียวกันได้ style เดียวกัน, hash ต่างกันได้ variety
- `coloring-cover-age-badge.test.ts` — age band ทุกค่า produce badge token ถูก

## 4. ทดสอบกับหนังสือจริง
สร้างปกใหม่ 2-3 เล่มล่าสุด (Bubbly Ocean Buddies, Alphabet Picnic Party) เพื่อเทียบก่อน/หลัง แล้วให้ user อนุมัติก่อนใช้กับหนังสือใหม่ทั้งหมด

## รายละเอียดเชิงเทคนิค
- ไฟล์แก้: `supabase/functions/coloring-v2-illustrated-cover-once/index.ts`
- Provider: คงเดิม (Gemini 2.5 Flash Image → OpenAI gpt-image-2)
- Spelling gate: ขยาย allowlist ให้รับ "AGES", "2-4", "4-6", "6-8", "8-12", "13-17"
- Law ใหม่: `cover_illustrated_lettering_v13` (แทน v12)

## คำถาม
1. Age Badge อยากให้เป็น **มุมขวาบน** หรือ **มุมขวาล่าง** ของปก?
2. อยากให้ระบบ **สุ่ม** lettering style ตามธีม หรือ **บังคับ** ให้ทุกเล่มใช้สไตล์เดียวเพื่อ brand consistency?
