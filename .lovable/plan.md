## Goal
ยกระดับหน้าปก coloring book ให้ได้คุณภาพเทียบเท่ารูปตัวอย่าง 3 ใบ (Robot Doodle Lab / Amazing Earth & Space / The Last Message from Tomorrow) — ตัวอักษรวาดมือหนา สีสันจัดจ้าน ตัวละคร/ฉากรายละเอียดสูง badge อายุกลมกลืน และ full-bleed ทุกด้าน

## สิ่งที่รูปตัวอย่างมีเหมือนกัน (จะ bake เข้า pipeline)
1. **Hero title lettering** — ตัวหนาแบบ hand-painted / chunky, มี outline ดำหนา, drop-shadow, และ **ไล่สีต่างกันในแต่ละคำหรือแต่ละตัวอักษร** (Amazing/Earth&Space, Robot/Doodle Lab)
2. **Title container** — วางบน plaque/ribbon/panel สีตัด (rounded black bubble, tan scroll ribbon, torn-paper) เพื่อให้อ่านได้บนพื้นภาพยุ่ง
3. **Subtitle เป็น ribbon แยก** — "COLORING BOOK" / "COLORING ADVENTURE" ใน banner แคบใต้ title
4. **Age badge เป็น sticker กลม** — ไล่สี, ขอบเข้ม, engraved "AGES X-Y" (Amazing Earth ชัดเจน)
5. **Character ensemble แน่นหน้าปก** — hero กลาง + supporting characters ล้อมรอบ พร้อม props/ฉาก
6. **Environmental frame** — ของแต่ง (gears, planets, stars, lightning) โผล่จากขอบเป็น decorative border
7. **Rich background** — deep navy, cosmic purple, painted texture — ไม่มีขาวเลย

## Root cause ของปกปัจจุบันที่ยังไม่ถึง
- `LETTERING_STYLES` มี 6 style แต่ prompt ไม่ได้ **บังคับ container/plaque** ใต้ title → ตัวอักษรลอยบนภาพยุ่ง อ่านยาก
- ไม่ได้บังคับ **multi-color per-word letter fill** (แต่ละคำสีต่างกัน) — ตอนนี้เป็น "chunky puffy multicolor" กว้างเกินไป โมเดลเลยเลือกสีเดียว
- Subtitle "Coloring Book" ถูกใส่เป็นส่วนของ title spelling lock แทนที่จะเป็น **แยก ribbon**
- ไม่มี **"ensemble" clause** → มัก generate hero เดี่ยว + พื้นหลังโล่ง
- Prompt เน้น "square 1:1 full-bleed" แต่ไม่ได้สั่ง **decorative border objects** ที่ทำให้หน้าปกดูเต็ม

## แผนแก้ (v16: `cover_reference_quality_v16`)

### 1. เพิ่ม COMPOSITION SYSTEM ใน `coloring-v2-illustrated-cover-once/index.ts`
สร้าง 3 building block ใหม่ ประกอบเข้ากับ layout/lettering/mood ที่มีอยู่:

**`TITLE_CONTAINERS`** (เลือก deterministic จาก book_id):
- `black_bubble_plaque` — bubble ดำ rounded + starburst decoration (แบบ Robot Doodle Lab)
- `torn_scroll_ribbon` — กระดาษเก่าฉีก tan/cream + stitching edge (แบบ Amazing Earth)
- `painted_banner` — แถบสีตัดคาดกลางบน + curl ปลาย (แบบ Last Message)
- `sticker_stack` — title เป็น sticker แต่ละคำแยกกันซ้อนเหลื่อม (ทางเลือกสำหรับ title สั้น)
- `clean_stroke_only` — ไม่มี container, ใช้ outline หนาพิเศษเป็น container ในตัว (สำหรับสไตล์ minimal)

**`TITLE_COLOR_MODES`**:
- `multi_word_gradient` — แต่ละคำสีต่างกัน (yellow / green-earth / cosmic-purple)
- `per_letter_theme` — แต่ละตัวอักษรมี theme pattern ในตัว (starfield, water, gears)
- `duotone_pop` — 2 สีสลับคำ, contrast แรง
- `unified_glow` — สีเดียวแต่มี inner glow + edge highlight (สำหรับ dramatic mood)

**`ENSEMBLE_CLAUSE`** (บังคับหน้าปกเต็ม):
- Hero character 1 คน + 2-3 supporting characters + 4-6 decorative props ที่โผล่จากขอบ 4 ด้าน
- ระบุตำแหน่ง: hero-center-bottom, supporting-left, supporting-right, props-corners

### 2. แยก subtitle ribbon ออกจาก title spelling lock
- Title spelling lock บังคับเฉพาะ **ชื่อเรื่องจริง** (เช่น "Robot Doodle Lab")
- คำว่า "Coloring Book" / "Coloring Adventure" ถูกสั่งให้เรนเดอร์เป็น **subtitle ribbon แยก** ใต้ title container
- ยัง verify OCR ทั้งสองส่วน

### 3. ยกระดับ age badge
เปลี่ยน `ageBadgeClause` เป็น sticker แบบใน Amazing Earth: วงกลม 2 ชั้น (นอกสี base, ในสีตัด), engraved letterpress "AGES 8-12", drop-shadow ดำหนา, วางมุมขวาบนหรือขวากลาง (deterministic per book)

### 4. ปรับ FULL-BLEED prompt ให้เจาะจงกว่าเดิม
เพิ่ม positive clause: "decorative motifs (gears / stars / planets / vines / tools depending on theme) emerging inward from all four edges — objects must cross the frame, half-in half-out — so no edge is empty painted background"
Verifier v15 ที่เพิ่งใส่ยังใช้ได้เหมือนเดิม แต่ prompt ที่ดีขึ้นจะลด retry จริง

### 5. เพิ่ม `theme_motif_kit` mapping
ตาม theme ของหนังสือ (space / robots / ocean / dinosaurs / etc.) ให้ preset ของ decorative props ที่ต้องโผล่ตามขอบ — ลด "generic decoration" ที่โมเดลชอบใส่ (ดาวสุ่ม, สายรุ้ง)

### 6. Regeneration policy
- **Going forward**: ปกใหม่ทุกใบใช้ v16 อัตโนมัติ
- **หนังสือที่ live แล้ว**: ไม่แตะ (ไม่สร้างค่าใช้จ่าย regenerate) — เว้นแต่จะสั่งเฉพาะเล่ม
- **เล่มถัดไปในคิว**: จะเป็น test book แรกของ v16

## Technical details
- ไฟล์ที่แก้: `supabase/functions/coloring-v2-illustrated-cover-once/index.ts` (เพิ่ม `TITLE_CONTAINERS`, `TITLE_COLOR_MODES`, `THEME_MOTIF_KITS`, ปรับ `buildPrompt`)
- ไฟล์ที่ **ไม่แตะ**: verifier v15, retry ladder, upload flow, storefront bridge — ทำงานได้ดีอยู่แล้ว
- เพิ่ม regression test: `src/__tests__/coloring-cover-reference-quality-v16.test.ts` — ตรวจว่า prompt ประกอบด้วย container + color mode + ensemble + motif kit clauses
- Metadata ที่เก็บใน `coloring_v2_assets`: `law: "cover_reference_quality_v16"`, `title_container`, `title_color_mode`, `motif_kit`

## คำถามก่อนลงมือ
ต้องการให้:
1. **สร้าง 1 เล่มทดสอบ v16 ทันทีหลัง merge** เพื่อดูผลจริง แล้วค่อยตัดสินใจ regenerate เล่มเก่า? (แนะนำ)
2. หรือ **regenerate ปกของ 3-5 เล่ม live ล่าสุด** ทันทีเพื่อเทียบ side-by-side?

## Verification
1. Unit test v16 ผ่าน (prompt structure)
2. Test cover 1 ใบ → รูปมี title container ชัด + multi-color lettering + ensemble + full-bleed pass ตั้งแต่ attempt 1
3. Verifier v15 ยังคง pass (edge check ผ่าน)
4. OCR ตรวจ title + subtitle ถูกต้อง