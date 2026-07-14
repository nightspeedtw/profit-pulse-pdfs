
## เป้าหมาย
ให้การ์ดหนังสือใน /kids ดูเหมือนภาพอ้างอิง (Barnaby's Wobbly Problem) — พรีเมียม โปร่ง อ่านง่าย ราคาชัด ปุ่มซื้อชัด

## จุดที่แก้
1. **`src/components/kids/MatchedResults.tsx`** — การ์ดในกริด "เล่มที่แนะนำ"
2. **`src/components/kids/SocialProofStrip.tsx`** — แถบ "ตัวอย่างจากเล่มจริง" (เปลี่ยนจากรูปปกเปล่าเป็นการ์ดย่อทรงเดียวกัน)

## ดีไซน์การ์ดใหม่ (ทั้งสองที่ใช้คอมโพเนนต์เดียวกัน)
สร้างคอมโพเนนต์ใหม่ `src/components/kids/KidsBookCard.tsx` เพื่อไม่ให้ซ้ำ:

```text
┌────────────────────────────────────┐
│ [THEME-CHIP]           ┌ $10.99 ┐  │
│                        └────────┘  │
│                                    │
│         [  ปกเต็ม object-cover  ]  │
│           (aspect-square)          │
│                                    │
├────────────────────────────────────┤
│ TITLE IN DISPLAY CAPS              │
│ tagline หนึ่งบรรทัด (muted)         │
│                                    │
│ 32 illustrated pages               │
│ Original character                 │
│                                    │
│ ┌──────────────────────────────┐   │
│ │        BUY · $10.99          │   │
│ └──────────────────────────────┘   │
└────────────────────────────────────┘
```

รายละเอียด:
- กรอบการ์ด `rounded-2xl border-2 border-border bg-card`, hover `-translate-y-1 shadow-brand`
- **Theme chip** (มุมบนซ้าย): pill สี `bg-accent/15 text-accent` ตัวหนังสือ `font-mono uppercase tracking-widest text-[10px]`; label มาจาก theme หลักของเล่ม (theme_ids[0] → lookup ใน themes prop → `label_th` หรือ slug uppercase)
- **Price badge** (มุมบนขวา): กรอบสี่เหลี่ยม `border-2 border-foreground bg-background px-2 py-1 rounded-md font-display`, แสดง `$X.XX` (`price_cents/100`)
- **Cover**: `aspect-square object-cover` เต็มขอบ (ไม่ crop สูงเกิน), fallback เดิม
- **Body**: 
  - Title: `font-display uppercase text-base md:text-lg tracking-tight`
  - Tagline: `text-sm text-muted-foreground line-clamp-2` — จาก `storefront_meta.conversion_copy.short_hook` (fallback `selling_hook`)
  - Meta 2 บรรทัด: `text-xs text-muted-foreground` — บรรทัด 1 `32 illustrated pages` (คงที่, ทุกเล่ม 32 หน้า), บรรทัด 2 `Original character`
  - ปุ่ม BUY: `w-full py-3 rounded-md bg-foreground text-background font-display tracking-wide` → link ไป `/kids/checkout/:id` แสดง `BUY · $X.XX`
- ทั้งการ์ด (ยกเว้นปุ่ม BUY) คลิกไป `/product/:id` เหมือนเดิม; hover overlay "ดูตัวอย่างข้างใน" ยังใช้ได้ในกริด (ซ่อนใน strip)

## การเปลี่ยนแปลงต่อไฟล์

### `src/components/kids/KidsBookCard.tsx` (ใหม่)
- Props: `{ book, themes, variant: "grid" | "strip", onPreview? }`
- คืน markup ตามดีไซน์บน; `variant="strip"` ตัด hover-preview overlay ออกและใช้ความกว้างคงที่ `w-56 md:w-64` (สำหรับสไลด์แนวนอน)

### `MatchedResults.tsx`
- ลบ inline `BookCard`, ใช้ `<KidsBookCard book=… themes=… variant="grid" onPreview=…/>`
- ยังส่ง `themes` prop ที่มีอยู่แล้ว

### `SocialProofStrip.tsx`
- เพิ่ม prop `themes: KidsTheme[]` (Kids.tsx ส่งเข้าไป — มีอยู่แล้วในหน้า)
- `SampleBook` เพิ่มฟิลด์ที่ต้องใช้: `price_cents`, `theme_ids`, `storefront_meta` (ต้อง select เพิ่มใน Kids.tsx)
- แทนแถวรูปสี่เหลี่ยมด้วย `<KidsBookCard variant="strip" …>` ในสไลด์แนวนอน

### `src/pages/Kids.tsx`
- ใน query ที่ดึง sampleBooks ให้เพิ่ม `price_cents, theme_ids, storefront_meta` (แค่ปรับ `.select(...)`), ส่ง `themes` เข้า `<SocialProofStrip/>`

## รายละเอียดที่ยืนยันจากคำตอบ
- ใช้ทั้งสองส่วน (grid + strip)
- Chip = ธีมหลักของเล่ม
- ราคาเป็นดอลลาร์ `$` (ใช้ `price_cents/100`, ไม่แปลงเป็นบาท)

## นอกขอบเขต
- ไม่แตะ backend/QC/pipeline
- ไม่เปลี่ยน typography ระดับโปรเจกต์ (ใช้ font-display เดิมของหน้า /kids)
- ไม่เพิ่ม theme chip กับ MarketingRail หรือหน้าอื่น
