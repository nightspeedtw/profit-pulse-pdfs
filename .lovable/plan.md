## เป้าหมาย
สร้างหนังสือระบายสี Sci-Fi 1 เล่ม สำหรับเด็กโต (13-17) ผ่าน Coloring Lane V2 ที่เพิ่ง build เสร็จ พร้อมปกสไตล์ YA Sci-Fi มืออาชีพเลียน mood อ้างอิง (cinematic, dramatic lighting, cyberpunk city, lightning, dynamic hero pose) — **แต่คงกฎ line-art interior + cover ต้องเป็นภาพระบายสี ไม่ใช่ full-color illustration**

## สเปกเล่มทดสอบ
- **Age band:** `13-17` (intricate line work, mandala-quality)
- **Page count:** 32
- **Theme:** "Neon Rebellion" — YA sci-fi, teen hero, cyberpunk cityscape, holographic UI, lightning storms, time-glitch motifs (นาฬิกา 11:11, floating papers/glyphs, geometric portals)
- **Trim:** 8.5 × 8.5 นิ้ว (square, ตามกฎ SQUARE-FIRST)
- **Provider:** Runware Ideogram 3.0 (`ideogram:4@1`)

## Cover — สไตล์ YA Sci-Fi (อ้างอิงภาพผู้ใช้)
Cover ของ coloring book **ยังต้องเป็น line art ระบายได้** — ไม่สามารถส่ง full-color YA illustration ให้ลูกค้าระบาย แต่จะ inject "YA Sci-Fi Cinematic" mood เข้า `master-cover-prompt`:
- Composition: hero teen มุมกล้อง 3/4, dynamic pose, wind-swept hair/scarf
- Background: cyberpunk skyline + lightning bolts + floating holographic panels + glitch papers
- Line-weight strategy: bold hero outline (5-7px) + fine detail background (2-3px) = premium hierarchy
- Title treatment: shatter/glitch display font, 2 บรรทัด, subtitle "A Coloring Adventure"
- ยังบังคับ: pure black ink on white, ไม่มี grayscale fill, ไม่มี text ใน AI layer (title วาดทับด้วย HTML overlay ตามเดิม)

## Steps
1. **Extend master-cover-prompt** — เพิ่ม `coverStyle: "ya_scifi_cinematic"` variant (dynamic hero + cyberpunk motifs + shatter title zone) โดยไม่กระทบ default coloring cover
2. **Fire ยิงเล่ม** ผ่าน `coloring-v2-start`:
   ```json
   { "age_band": "13-17", "theme": "Neon Rebellion — a teen hero racing against a glitching city clock",
     "page_count": 32, "cover_mood": "ya_scifi_cinematic",
     "main_character_mode": "recurring_hero", "autopilot_mode": "full_auto",
     "daily_cost_ceiling_usd": 15 }
   ```
3. **Monitor pipeline** — concept → style bible → page plan (32 หน้า distinct: hero portraits, city vistas, tech close-ups, portal/glitch patterns, action beats) → interior render → cover (จะรัน cover-last โดยใช้ 3 interior refs) → QC → PDF → publish
4. **Verify** — เปิด `/admin/coloring-lab-v2` ดู progress, ตรวจ cover ว่า mood ตรง reference, ตรวจ anatomy (ห้าม deform), ตรวจ title spelling
5. **Publish to storefront** — insert เข้า `ebooks_kids` แบบ auto ผ่าน `coloring-v2-publish` (มีอยู่แล้ว)

## รายละเอียดเทคนิค
**Files to modify:**
- `supabase/functions/_shared/coloring/master-cover-prompt.ts` — เพิ่ม `COVER_STYLE_PRESETS.ya_scifi_cinematic`
- `supabase/functions/coloring-v2-cover/index.ts` — ส่ง `cover_mood` เป็น style preset key
- `supabase/functions/coloring-v2-start/index.ts` — validate `cover_mood` ใน allowed list (`default`, `ya_scifi_cinematic`, etc.)

**สิ่งที่จะไม่แตะ:**
- v1 pipeline, threshold, gates, RLS, storefront components
- Anatomy hard-gate (ยังบังคับ), title spelling hard-gate (ยังบังคับ)
- Line-art law (pure black on white — ห้าม gray/color fill ใน interior + cover)

## Success criteria
- 32 interior pages ผ่าน QC (0 deformity, unique subjects)
- Cover ได้ mood YA sci-fi (dynamic hero + city + lightning + glitch motifs) แต่ยังเป็น pure line art
- Title สะกดถูก 100%
- PDF 8.5×8.5 สร้างเสร็จ, published `sellable=true`
- ใช้งบ ≤ $15

## Risks & mitigations
- **Ideogram อาจ render title ทับเอง** → prompt บังคับ `NO TEXT` + title วาดโดย HTML overlay (มีอยู่แล้ว)
- **Cover อาจได้ shading/gray fill** เพราะพยายามทำ cinematic → prompt ต้องย้ำ "pure black line only, cinematic composition through LINE HIERARCHY only, no shading"
- **13-17 band ยังใหม่** → ถ้า cover fail 3 ครั้ง จะ fallback เป็น default coloring cover style
