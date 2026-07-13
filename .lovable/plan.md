
# Kids Book Taxonomy & Dual-Filter Storefront

เพิ่มระบบจัดหมวดหมู่ 3 แกน (อายุ / แนวเรื่อง / แท็กการตลาด) พร้อมหน้า Kids Hub ที่มี Dual Filter ใช้งานได้จริง โดยไม่ทำลาย categories เดิมของสินค้าอื่น

---

## 1. โครงสร้างข้อมูล (Backend)

เพิ่ม **taxonomy แบบ tag-based** ผูกกับ `ebooks` ผ่านตารางกลาง เพื่อให้หนังสือเล่มเดียวเลือกได้หลายอายุ/หลายธีม

### ตารางใหม่

- `kids_age_groups` (id, slug, label_th, label_en, sort_order, min_age, max_age)
  - seed: `0-3`, `4-6`, `7-9`, `9-12`, `13+` พร้อมชื่อไทย ("นิทานภาพ 4-6 ปี" ฯลฯ)
- `kids_themes` (id, slug, label_th, label_en, icon_name, sort_order)
  - seed: `bedtime`, `animals-nature`, `ef-life-skills`, `adventure-fantasy`, `friendship-family`, `humor-fun`, `stem-educational`
- `ebook_kids_ages` (ebook_id, age_group_id) — many-to-many
- `ebook_kids_themes` (ebook_id, theme_id) — many-to-many

### ต่อยอดคอลัมน์ที่มีอยู่บน `ebooks`

- `is_bestseller boolean default false` (แท็กจัดโดยแอดมิน; เกณฑ์อัตโนมัติจาก orders มาต่อยอดทีหลัง)
- `series_id uuid null` + ตาราง `book_series` (id, slug, title, description, cover_image_url) — สำหรับ "จัดเซ็ต/ซีรีส์"
- ใช้ `created_at` เดิมสำหรับ "มาใหม่" (ไม่ต้องเพิ่มคอลัมน์)

### RLS / Grants

- Public `SELECT` (anon + authenticated) ทุกตาราง taxonomy — เพื่อให้ storefront อ่านได้
- Write เฉพาะ `service_role` (แอดมินจัดผ่าน edge function / admin UI ภายหลัง)
- ทำตาม pattern เดิม: GRANT ในไฟล์ migration เดียวกับ CREATE TABLE

---

## 2. Storefront UI

### 2.1 หน้า Kids Hub ใหม่ `/kids`

Route ใหม่ พร้อม nav link "Kids" ใน Header เมนู (แสดงเฉพาะเมื่อมีหนังสือใน `parenting-kids` ≥ 1)

Layout:
```text
┌─────────────────────────────────────────────┐
│ HERO: "หนังสือเด็ก คัดตามวัย ตามแนวเรื่อง"  │
├─────────────────────────────────────────────┤
│ AGE TABS  [0-3][4-6][7-9][9-12][13+][ทั้งหมด]│  ← แกน 1 (ปุ่มใหญ่)
├─────────────────────────────────────────────┤
│ THEME CHIPS  🌙 ก่อนนอน  🐾 สัตว์  ...       │  ← แกน 2 (multi-select)
├─────────────────────────────────────────────┤
│ MARKETING RAIL: มาใหม่ | ขายดี | ซีรีส์      │
├─────────────────────────────────────────────┤
│ RESULT GRID (filtered)                       │
└─────────────────────────────────────────────┘
```

- Filter state เก็บใน URL query string (`?age=4-6&themes=bedtime,animals-nature`) เพื่อ SEO + แชร์ลิงก์ได้
- เลือก age = **single-select** (radio), themes = **multi-select** (chips)
- ถ้าไม่มีผลลัพธ์ → empty state พร้อมปุ่มล้างตัวกรอง

### 2.2 Marketing Rails บน `/kids` (แนวนอน scroll)

- **มาใหม่**: query `created_at desc limit 8`
- **ขายดี**: query `is_bestseller = true`
- **ซีรีส์**: การ์ดจาก `book_series` แต่ละอันลิงก์ไปหน้า `/series/:slug`

### 2.3 Category page เดิม (`/category/parenting-kids`)

- เพิ่มแบนเนอร์ "เข้าสู่ Kids Hub →" ลิงก์ไป `/kids` (ไม่รื้อของเดิม)

### 2.4 Product page

- ใต้ title แสดง badge อายุ + ธีม เป็น pill เล็ก ๆ (ลิงก์ไป `/kids?age=...` / `?themes=...`)
- ใช้ semantic tokens เดิม ไม่ hardcode สี

---

## 3. Data Layer

- ไฟล์ใหม่ `src/lib/kidsTaxonomy.ts`:
  - `listAgeGroups()`, `listThemes()`
  - `listKidsBooks({ age?, themes?[], marketingTag?, seriesId?, limit? })` — join ผ่าน `ebook_kids_ages` / `ebook_kids_themes` + filter `category_slug = 'parenting-kids'`
  - `listSeries()`, `getSeries(slug)`
- อัปเดต `src/lib/storefront.ts` เฉพาะการเพิ่ม field `age_group_slugs[]`, `theme_slugs[]`, `series_id` ในผลลัพธ์ (ไม่แตะฟังก์ชันเดิม)

---

## 4. Admin (ขั้นต่ำ พอใช้)

- ในหน้า admin ที่แก้ ebook อยู่แล้ว เพิ่ม 3 กลุ่ม toggle:
  - Age groups (checkbox list)
  - Themes (checkbox list)
  - Series (dropdown) + `is_bestseller` toggle
- Save เขียนลง join tables ผ่าน `supabase.from(...).upsert/delete`

หากยังไม่มี admin ebook editor แยก — สร้าง section เล็กใน `ProductionCommandCenter` หรือ `Settings.tsx` (ยืนยันจุดที่เหมาะสมตอนสร้าง)

---

## 5. Seed & Backfill

Migration seed:
- ใส่ age groups + themes ตามลิสต์ผู้ใช้
- Backfill: หนังสือเด็กที่มีอยู่ (เช่น "Nimble and the Whispering Star", "Barnaby") จับคู่ default:
  - Nimble → age `4-6`, themes `adventure-fantasy` + `ef-life-skills`
  - Barnaby → age `4-6`, themes `bedtime` + `friendship-family`

(รายชื่ออื่น ๆ ให้แอดมินติ๊กเพิ่มภายหลังผ่าน UI)

---

## 6. Out of scope (รอบนี้ยังไม่ทำ)

- คำนวณ Best Seller อัตโนมัติจาก orders (ตอนนี้ใช้ toggle มือ)
- หน้า `/series/:slug` แบบเต็ม (จะทำต่อรอบถัดไปถ้าต้องการ)
- ระบบแนะนำ "ลูกค้าที่ซื้อเล่มนี้ยังซื้อ..."
- Admin UI แบบเต็ม (ทำแค่ขั้นต่ำพอผูกข้อมูล)
- ไม่แตะ categories อื่น (Business, Finance ฯลฯ) และไม่แก้ Product template ที่เพิ่ง refactor

---

## รายละเอียดทางเทคนิค

**ไฟล์ที่จะสร้าง**
- `supabase/migrations/<ts>_kids_taxonomy.sql` — 4 ตาราง + 2 คอลัมน์ + seed + GRANT + RLS
- `src/lib/kidsTaxonomy.ts`
- `src/pages/Kids.tsx` (route `/kids`)
- `src/components/kids/AgeGroupTabs.tsx`
- `src/components/kids/ThemeChips.tsx`
- `src/components/kids/MarketingRail.tsx`
- `src/components/kids/KidsFilterBar.tsx` (wrapper อ่าน/เขียน URL params)

**ไฟล์ที่จะแก้**
- `src/App.tsx` — เพิ่ม route `/kids`
- `src/components/Header.tsx` — เพิ่มลิงก์ "Kids"
- `src/pages/Category.tsx` — แบนเนอร์ลิงก์ไป `/kids` เฉพาะ slug `parenting-kids`
- `src/pages/Product.tsx` — เพิ่ม badge อายุ/ธีม
- `src/lib/storefront.ts` — เพิ่ม field taxonomy ในผลลัพธ์ (backward-compat)

**Query filter (แนวคิด)**
```sql
select e.* from ebooks e
where e.category_slug = 'parenting-kids' and e.status = 'published'
  and (:age is null or exists (
     select 1 from ebook_kids_ages a
     join kids_age_groups g on g.id = a.age_group_id
     where a.ebook_id = e.id and g.slug = :age))
  and (:themes is null or exists (
     select 1 from ebook_kids_themes t
     join kids_themes k on k.id = t.theme_id
     where t.ebook_id = e.id and k.slug = any(:themes)));
```
(ใน client ใช้ 2 query: ดึง ebook_ids ที่ match filter ก่อน แล้วค่อย `in()`; หรือทำเป็น RPC ตัวเดียว — เลือก RPC เพื่อลด round-trip)

**Design system**
ทุก component ใช้ tokens ที่มี (`bg-highlight`, `bg-accent`, `border-foreground`, `font-display`, `brutal-card`) — ไม่ hardcode สี ตาม memory ของโปรเจกต์
