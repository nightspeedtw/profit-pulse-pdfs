## Goal

เปลี่ยนระบบ generate ภาพเด็กใน pipeline จาก Lovable AI Gateway ปัจจุบัน → **Fal.ai** (Flux Schnell draft + Recraft V3 final) พร้อมระบบ **auto-rotate style** + **character consistency ผ่าน Character Bible + Reference Image (image-to-image)**

---

## วิธีสมัคร Fal.ai API Key (ทำก่อน)

1. เข้า https://fal.ai/ → Sign up (ใช้ Google/GitHub ได้)
2. ไปที่ Dashboard → **Keys** (https://fal.ai/dashboard/keys)
3. กด **Add Key** → ตั้งชื่อ (เช่น `secretpdf-kids`) → คัดลอกค่าคีย์ที่ขึ้นต้นด้วย `fal-…` ทันที (แสดงครั้งเดียว)
4. ไปที่ **Billing** → เติมเครดิตขั้นต่ำ $5–$10 (Flux Schnell ~$0.003/ภาพ, Recraft V3 ~$0.04/ภาพ → พอ generate ได้หลายพันภาพ)
5. เมื่อได้คีย์แล้ว บอกผมกลับมา → ผมจะเปิดฟอร์ม `add_secret` ให้กรอกเป็น `FAL_API_KEY` (เก็บใน Lovable Cloud secrets, ไม่โผล่ในโค้ด)

---

## สถาปัตยกรรม

```text
autopilot-kids-pipeline
   │
   ├─ step: lock_bibles
   │    ├─ AI เขียน character_bible_json (ชื่อ, หน้าตา, ผม, ตา, ผิว, ชุด, สัดส่วน, forbidden_changes[])
   │    ├─ AI เลือก style จาก style pool แบบ auto-rotate (ดูด้านล่าง)
   │    └─ Fal Flux Schnell generate "character reference sheet"
   │         → upload storage → บันทึกใน kids_book_bibles.character_reference_image_url
   │
   ├─ step: illustrate_spread (× 14 spreads)
   │    ├─ mode = "draft"  → Fal Flux Schnell (i2i, ref image + prompt+style)
   │    ├─ QC pass ≥ 85    → mode = "final" → Fal Recraft V3 (i2i, ref image + prompt+style)
   │    └─ ล้มเหลว 3 ครั้ง  → mark failed (ไม่มี placeholder)
   │
   └─ step: cover → Fal Recraft V3 (ใช้ ref image + title guard)
```

### Style Auto-Rotation (ไม่ล๊อค 1 สไตล์)

สร้าง `kids_style_presets` table:
```text
id | slug                    | prompt_suffix                                    | weight | last_used_at
---|-------------------------|--------------------------------------------------|--------|-------------
1  | watercolor_soft         | "soft watercolor, pastel palette, gentle..."     | 10     | ...
2  | ghibli_hand_drawn       | "hand-drawn animation cel, lush background..."   | 10     | ...
3  | 3d_pixar                | "3D rendered, soft global illumination..."       | 10     | ...
4  | flat_vector             | "flat vector illustration, bold shapes..."       | 10     | ...
5  | crayon_texture          | "crayon and colored pencil texture..."           | 10     | ...
6  | gouache_painterly       | "gouache painterly, thick brush strokes..."      | 10     | ...
```
เลือกด้วย weighted random + penalty สำหรับ style ที่ใช้ล่าสุด → หนังสือแต่ละเล่มมี style ต่างกัน แต่**ในเล่มเดียวกัน**ใช้ style เดียวตลอด (บันทึกใน `kids_book_bibles.style_preset_id`).

### Character Consistency (2 ชั้น)

1. **Character Bible** (text) — ต่อท้ายทุก prompt ทุกหน้า verbatim
2. **Reference Image** (image-to-image) — Fal endpoint รับ `image_url` + `strength: 0.65` → ยึดหน้าตัวละครจากภาพต้นแบบ

---

## Technical

### Files ใหม่
- `supabase/functions/_shared/fal.ts` — helper: `falFluxSchnell()`, `falRecraftV3()`, upload response → Supabase storage, cost log
- `supabase/functions/_shared/style-picker.ts` — weighted-random style selection with recency penalty
- `supabase/migrations/xxx_kids_style_presets.sql` — table + seed 6 styles + GRANTs
- `supabase/migrations/xxx_book_style_link.sql` — เพิ่ม `style_preset_id`, `character_reference_image_url` ใน `kids_book_bibles` (มีอยู่แล้วจาก QC v2 — เพิ่มเฉพาะที่ขาด)

### Files แก้
- `supabase/functions/autopilot-kids-pipeline/index.ts` — step lock_bibles ใช้ Fal สร้าง ref image, step illustrate เรียก fal.ts (draft→final), ลบ path ที่เรียก Lovable AI Gateway image
- `supabase/functions/_shared/covers/kids-cover-render.ts` — เปลี่ยนไปใช้ Fal Recraft V3 + ref image
- `supabase/functions/_shared/kids-visual-bible.ts` — ให้ผลลัพธ์รวม `style_preset_id` ที่ picker เลือก

### Fal.ai API call
```ts
POST https://fal.run/fal-ai/flux/schnell   // draft
POST https://fal.run/fal-ai/recraft-v3      // final
Authorization: Key ${FAL_API_KEY}
Body: { prompt, image_size:"square_hd", num_inference_steps:4,
        image_url?, strength?:0.65 }   // image_url present = i2i
Response: { images:[{url, width, height, content_type}] }
```
→ fetch URL → upload buf ไปที่ Supabase `ebook-covers` / (bucket ใหม่) `ebook-illustrations`.

### Secret
- ใหม่: `FAL_API_KEY` (ผ่าน `add_secret` หลังผู้ใช้สมัคร)
- Lovable AI Gateway image generation → เลิกใช้ในสาย kids (ยังใช้กับ text/QC ต่อไป)

### QC ยังทำงานเดิม
Pipeline QC v2 (`kids-qc-run`, `sellable.ts`, `pdf-preflight.ts`) ไม่เปลี่ยน → gate ยังบังคับ 90 คะแนน / no placeholder / no critical เหมือนเดิม

### ต้นทุน/ภาพ ประมาณการ
- 1 หนังสือ = 1 ref + 14 spreads (draft) + 14 spreads (final) + 1 cover ≈ 15×$0.003 + 15×$0.04 = **~$0.65/เล่ม (~23 บาท)**
- ถ้าไม่มี regenerate = ต่ำกว่า Lovable Gateway ปัจจุบันมาก

---

## Rollout

1. ✅ อธิบายวิธีสมัคร Fal (message นี้)
2. ⏸ รอผู้ใช้สมัคร → ให้คีย์
3. ผม `add_secret` ขอ `FAL_API_KEY`
4. Implement code + migration ตามลำดับข้างบน
5. Deploy edge functions อัตโนมัติ
6. รัน 1 เล่มทดสอบ → เช็คภาพ + คะแนน QC + character consistency
7. เปิด autopilot ต่อ

**ขั้นต่อไป: กรุณาสมัคร Fal.ai และกลับมาบอก แล้วผมจะเปิดฟอร์มขอคีย์ให้ครับ**
