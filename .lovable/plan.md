
## ปัญหาที่พบ

ปกสไตล์ที่คุณชอบ (Bouncy Bubble Letters — book `e2b5a66b`) ไม่เคยถูกใช้ซ้ำเลย เพราะ `supabase/functions/coloring-v2-cover/index.ts` ใช้ prompt เดียวตายตัว:

- `buildIllustratedPrompt()` ฝัง art direction เพียงแบบเดียว: *"warm cheerful storybook style — gouache + watercolor feel"*
- ไม่มี style rotation, ไม่มี recency window, ไม่มี reference image
- ทุกเล่มจึงออกมาเป็น "gouache watercolor" ล้วน — ทำให้สลับไปมาแบบสุ่มดูไม่ได้

`STYLE_FAMILIES` ใน `_shared/coloring/style-families.ts` (12 แบบ) และ `cover-recency.ts` (recency picker) ถูกเขียนไว้แล้วแต่ **ไม่ได้ถูกเรียกใช้จาก cover generator ปัจจุบัน** — มันค้างจากยุค deterministic typography ที่ถูกปลดไปตอน `cover_illustrated_only_v12`

## แผนแก้

### 1. สร้าง `cover-art-styles.ts` (curated illustration styles)
ตำแหน่ง: `supabase/functions/_shared/coloring/cover-art-styles.ts`

แต่ละ style มี:
- `id` (slug), `label`
- `prompt_fragment` — art direction ที่จะแทน "gouache + watercolor" ใน prompt
- `title_lettering_fragment` — คำสั่งวิธีวาดตัวหนังสือ (bubble letters, brushed script, cut-paper ฯลฯ)
- `themeAffinity` regex (optional)

Seed 8–10 สไตล์ รวมถึง:
- `bouncy_bubble_letters` — ตรงกับ URL ที่คุณส่งมา (bold rainbow bubble typography, thick outlines, pop-art fill)
- `soft_gouache_storybook` — สไตล์เดิม
- `crayon_scribble_kids`, `cut_paper_collage`, `retro_saturday_cartoon`, `japanese_kawaii_sticker`, `chalkboard_neon`, `flat_vector_bold`, `ink_watercolor_wash`, `puffy_3d_gummy`

### 2. Weighted style picker with recency window
ใหม่: `pickCoverArtStyle(db, book)` ใน cover-art-styles.ts
- ดึง `meta.cover_art_style` ของ `cover_final` 15 เล่มล่าสุด
- ตัดสไตล์ที่ใช้ในช่วง 4 เล่มล่าสุดออกก่อน แล้วสุ่มถ่วงน้ำหนัก
- ถ้า title match `themeAffinity` เพิ่ม weight
- Return `{style, reason}`

### 3. Wire เข้า `coloring-v2-cover/index.ts`
- เรียก `pickCoverArtStyle` หลัง sticky check
- แทน constant art-direction ใน `buildIllustratedPrompt()` ด้วย `style.prompt_fragment` + `style.title_lettering_fragment`
- บันทึก `cover_art_style: style.id` ใน asset meta (สำหรับ recency + audit)
- Log ลง `coloring_v2_provider_calls.purpose` เป็น `cover_illustrated_<style_id>_aN`
- เก็บ hard reject/attempt cap เดิมทั้งหมด (ไม่แตะ sticky short-circuit, ไม่แตะ COVER_HARD_ATTEMPT_CAP, ไม่ลด quality gate)

### 4. เคลียร์ปกเก่าให้สุ่มสไตล์ใหม่ (optional — คุณสั่งเมื่อพร้อม)
Migration/script แยกต่างหาก: รีเซ็ต `stage='cover'` + null `approved_cover_asset_id` ให้เล่มที่ยัง live ด้วยสไตล์เดิม เพื่อให้ regenerate ตามสไตล์ใหม่ทีละเล่มตามกฎ one-book-at-a-time
- **ไม่รันในแผนนี้** — รอคุณอนุมัติหลังเห็น 3–4 เล่มใหม่ออกมาสวย

### 5. Regression test
`src/__tests__/coloring-cover-style-rotation.test.ts`:
- `bouncy_bubble_letters` มีอยู่ใน registry
- `pickCoverArtStyle` ไม่คืนสไตล์ที่อยู่ใน recency 4 เล่มล่าสุด
- prompt ที่ build มี fragment ของ style ที่ถูกเลือก

## ไม่แตะ
- Sticky-law short-circuit (ปกที่ owner-approved ยังคงอยู่)
- OCR/spell gate, hard attempt cap, provider ladder (Gemini → OpenAI)
- One-book-at-a-time law, budget ceiling
- SVG typography (ยังคงถูกห้ามตาม `cover_illustrated_only_v12`)

## Deliverable
หลัง deploy: เล่มใหม่ทุกเล่มจะสุ่มสไตล์จากกลุ่ม 8–10 แบบ (รวมทั้ง bubble-letters แบบใน URL) โดยไม่ซ้ำติดกัน — catalog จะดูหลากหลาย ไม่ใช่ gouache แบบเดียวทั้งร้าน
