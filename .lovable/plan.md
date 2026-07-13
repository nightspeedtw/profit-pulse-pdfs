
# แยกระบบสร้าง Ebook: Kids Track vs Adult Track

ตอนนี้ backend มีแค่ guard (`is-kids-book.ts`) กันไม่ให้ pipeline ผู้ใหญ่ทับหนังสือเด็ก แต่ logic กระจายอยู่ทั่วและ track เด็กยังไม่มี orchestrator ของตัวเอง แผนนี้แยกให้ชัดเจนทั้ง 4 ชั้น (Prompts + Outline / QC / Pipeline steps / Cover+Thumbnail) โดยใช้ **category_slug** เป็นตัวกำหนด track อัตโนมัติ

## 1. Track Registry (แกนกลาง)

สร้างไฟล์ `supabase/functions/_shared/track-registry.ts` เป็นแหล่งความจริงเดียว:

```text
TRACKS = {
  kids:  { slugs: ["parenting-kids"], product_types: ["kids-book","picture-book"] },
  adult: { slugs: [<19 slugs ที่เหลือ>],  fallback: true }
}

resolveTrack(ebook|idea) -> "kids" | "adult"
  ├─ ถ้ามี kids_visual_bible / kids_scene_briefs_json → kids
  ├─ match product_type → track
  ├─ match category_slug → track
  └─ default → adult
```

แทนที่ `isKidsBook()` เดิม (ยังคง export ไว้เพื่อ backward-compat แต่ให้เรียก `resolveTrack() === "kids"`)

## 2. แยก Prompts + Outline Schema

```text
supabase/functions/_shared/
├── prompts/
│   ├── adult.ts     (ย้าย HARDSELL_COPYWRITER_SYSTEM, PREMIUM_WRITER_SYSTEM เดิม)
│   └── kids.ts      (kids storyteller system + storybook consistency rules)
└── outlines/
    ├── adult-outline.ts  (10-chapter TOC + bonuses schema เดิม)
    └── kids-outline.ts   (story bible + page-by-page storyboard schema)
```

## 3. แยก QC Gates

```text
supabase/functions/_shared/qc/
├── adult.ts   (topicGate, outlineGate, chapterGate, productCopyGate, publishGate)
└── kids.ts    (character_consistency ≥95, illustration_style ≥95,
                story_continuity ≥95, age_appropriateness ≥95,
                cover_to_interior_match ≥95)
```

Threshold + prompt QC ของแต่ละ track แยกกันชัด ไม่ปนกัน

## 4. แยก Pipeline Orchestrator

```text
supabase/functions/
├── autopilot-orchestrator/   ← เดิม แต่ refactor เป็น "router only"
│   └── route ตาม resolveTrack() → เรียก sub-orchestrator ที่ถูก track
├── autopilot-adult/          ← ย้าย logic เดิมทั้งหมดมาที่นี่
│   (topic QC → outline → chapters → editorial QC → copy → cover → shopify → publish)
└── autopilot-kids/           ← สร้างใหม่
    (story bible → manuscript → visual bible → per-spread illustrations →
     kids QC gates → kids cover → shopify draft → publish)
```

ทุก step function (`generate-outline`, `write-chapters`, `qc-fix`, `generate-cover`, `generate-store-thumbnail`) เปลี่ยน guard จาก `isKidsBook → kidsGuardResponse` เป็น:
- ถ้า track ไม่ตรง → return `{ skipped: true, reason: "wrong-track", expected, got }`
- ทำให้ track ผู้ใหญ่จะไม่ยิงเข้าเล่มเด็ก **และ** track เด็กจะไม่ยิงเข้าเล่มผู้ใหญ่ (ป้องกันทั้งสองทาง)

## 5. แยก Cover + Thumbnail Style

```text
supabase/functions/_shared/covers/
├── adult-cover.ts       (typographic hard-sell, current template)
└── kids-cover.ts        (illustrated cover + character reference lock)

supabase/functions/_shared/thumbnails/
├── adult-thumbnail.ts   (book mockup with perspective — เดิม)
└── kids-thumbnail.ts    (soft frame + illustration-forward)
```

`generate-cover` และ `generate-store-thumbnail` อ่าน track แล้วเลือก template

## 6. Routing (autopilot ทำงานเงียบ)

- `autopilot-tick` / `autopilot-orchestrator` โหลด ebook → `resolveTrack()` → invoke `autopilot-kids` หรือ `autopilot-adult`
- `generate-idea` เพิ่ม field `track` ลงใน idea (derive จาก category_slug ตอนสร้าง) เพื่อให้ downstream ไม่ต้อง resolve ซ้ำ
- ไม่ต้องแก้ UI ฝั่ง admin — ยังกดปุ่มเดิม แต่หลังบ้าน route แยกแล้ว

## Technical details

**ไฟล์ใหม่**
- `_shared/track-registry.ts`
- `_shared/prompts/{adult,kids}.ts`
- `_shared/outlines/{adult,kids}-outline.ts`
- `_shared/qc/{adult,kids}.ts`
- `_shared/covers/{adult,kids}-cover.ts`
- `_shared/thumbnails/{adult,kids}-thumbnail.ts`
- `autopilot-adult/index.ts` (ย้ายจาก orchestrator เดิม)
- `autopilot-kids/index.ts` (สร้างใหม่ ใช้ `rewrite-kids-manuscript` + `generate-interior-visuals` + `kids-visual-bible` ที่มีอยู่แล้ว)

**ไฟล์แก้**
- `autopilot-orchestrator/index.ts` → กลายเป็น router (~80 บรรทัด)
- `generate-outline`, `write-chapters`, `qc-fix`, `generate-cover`, `generate-store-thumbnail`, `generate-shopify-package`, `auto-list-ebook`, `list-storefront`, `render-pdf` → เปลี่ยน guard เป็น track-aware
- `_shared/is-kids-book.ts` → wrapper รอบ `resolveTrack()` (keep backward-compat)
- `generate-idea/index.ts` → set `ebook_ideas.track` ตอน insert

**ไม่มี DB migration** (ใช้ column `category_slug` + `product_type` เดิม; ถ้าจำเป็นจะเพิ่ม `ebooks.track` เป็น generated column ใน iteration ถัดไป)

**Rollout ปลอดภัย**
- Adult track = ย้ายโค้ดเดิม 1:1 ไม่เปลี่ยน behavior
- Kids track = wire สิ่งที่มีอยู่ (`rewrite-kids-manuscript`, `kids-visual-bible`) เข้า orchestrator เท่านั้น
- ทุก step function เพิ่ม log `{ track, ebook_id, step }` ให้ debug ง่าย

## ผลลัพธ์

- Logic เขียนหนังสือเด็ก vs ธุรกิจ/การเงิน แยกไฟล์ แยก prompt แยก QC แยก orchestrator ชัดเจน — แก้ track หนึ่งไม่กระทบอีก track
- Autopilot route อัตโนมัติจาก `category_slug` (parenting-kids → kids, ที่เหลือ → adult)
- ป้องกันการทับกัน 2 ทาง (kids guard + adult guard) ไม่ใช่ทางเดียวเหมือนตอนนี้
- เพิ่ม track ใหม่ในอนาคต (เช่น workbook, finance เฉพาะ) แค่เพิ่ม entry ใน `TRACKS` + สร้างโฟลเดอร์ prompt/qc/orchestrator
