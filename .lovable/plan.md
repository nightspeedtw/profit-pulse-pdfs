## Goal

เพิ่ม Conversion elements มาตรฐาน (rating, preview, reviews, trust badges, sticky buy bar) ในหน้า Product Detail — ทำครั้งเดียวใน `src/pages/Product.tsx` เพื่อให้ **หนังสือทุกเล่ม** ที่มาใหม่ได้ทันที ไม่ใช่แค่เล่ม Barnaby

หน้า Product ปัจจุบันเป็น template กลางอยู่แล้ว (route `/product/:handle`) — ทุกเล่มดึงข้อมูลจาก `fetchStorefrontById` เหมือนกัน จึงเพิ่ม component เข้าไปที่นี่ที่เดียว

## Database (Cloud) – สร้าง `product_reviews` + view aggregate

Migration:

```text
1. CREATE TABLE public.product_reviews
   - id uuid PK
   - ebook_id uuid FK → ebooks(id) ON DELETE CASCADE
   - reviewer_name text
   - rating int (1..5)  ← validation trigger, not CHECK
   - comment text
   - verified_purchase boolean default false
   - created_at timestamptz default now()

2. GRANT SELECT ON public.product_reviews TO anon, authenticated  (public reads)
   GRANT ALL ON public.product_reviews TO service_role
   ENABLE RLS
   POLICY "public read" FOR SELECT USING (true)
   POLICY "service writes" — inserts only via edge/admin (no anon INSERT)

3. VIEW public.product_review_stats
   SELECT ebook_id, avg(rating)::numeric(3,2) AS average_rating,
          count(*)::int AS review_count
     FROM product_reviews GROUP BY ebook_id
   GRANT SELECT TO anon, authenticated
```

ไม่ใส่ข้อมูลปลอม — ตารางเริ่มว่าง component จะซ่อนตัวเองเมื่อไม่มีรีวิว

`src/lib/storefront.ts` เพิ่มการ join `product_review_stats` เพื่อให้ `StorefrontEbook` มี `average_rating` + `review_count` ติดมาโดยไม่ต้อง fetch เพิ่ม

## Reusable components (`src/components/product/`)

1. **`ProductRating.tsx`** — props: `average`, `count`. ใช้ icon `Star` จาก lucide-react เติมครึ่งดวงตามค่าเฉลี่ย. คลิก → smooth-scroll ไป `#reviews`. **ถ้า `count === 0` → return null** (ไม่โชว์ 0 ดาว)

2. **`ProductPreview.tsx`** — wrapper ของ `BookPreviewCarousel` เดิม + ปุ่ม "ดูตัวอย่างฟรี" เปิด Dialog (shadcn) แสดง TOC (จาก `product.toc` ถ้ามี) + 1-2 หน้าตัวอย่างเต็ม. ถ้าไม่มีภาพ preview → return null

3. **`ProductReviews.tsx`** — props: `ebookId`. Fetch จาก `product_reviews` limit 3 + ปุ่ม "ดูรีวิวทั้งหมด" (ขยาย limit ใน state). แต่ละการ์ด: ชื่อย่อ, ดาว, ข้อความ, วันที่. **ถ้าไม่มีรีวิว → return null** (ไม่มี placeholder ปลอม)

4. **`TrustBadges.tsx`** — static 3 badges ใช้ icon `Download`, `ShieldCheck`, `Lock`:
   - "ดาวน์โหลดทันที"
   - "การันตีคืนเงิน 30 วัน"
   - "ไฟล์ปลอดภัย เข้ารหัส"
   วางใต้ปุ่ม Buy

5. **`StickyBuyBar.tsx`** — props: `title`, `price`, `onBuy`. ใช้ `IntersectionObserver` เฝ้าปุ่ม Buy หลัก, โผล่มาเมื่อปุ่มหลักหลุด viewport. Mobile: fixed bottom, full-width. Desktop (md+): fixed bottom-right card ขนาด ~360px. ใช้ semantic tokens (`bg-background`, `border-foreground`) ตาม design system เดิม

## Integrate ใน `src/pages/Product.tsx`

- ใต้ H1 → `<ProductRating>`
- ใต้ปุ่ม Buy → `<TrustBadges>`
- แทน `BookPreviewCarousel` ด้วย `<ProductPreview>`
- ปิดหน้าด้วย `<section id="reviews"><ProductReviews ebookId={product.id} /></section>`
- Mount `<StickyBuyBar>` เสมอ (มี logic ซ่อน/โชว์ในตัว)

ไม่แตะ layout หลัก, Header, Footer, หรือหน้าอื่น — เพียง swap/insert ใน Product.tsx

## Design system

ทั้งหมดใช้ tokens เดิม (`text-foreground`, `bg-background`, `border-foreground`, `font-display`, `font-mono`, sticker style). ไม่ hardcode สี ไม่เพิ่มฟอนต์ใหม่

## Files touched

- **New migration**: `product_reviews` + `product_review_stats` view + RLS + GRANTs
- **New**: `src/components/product/ProductRating.tsx`, `ProductPreview.tsx`, `ProductReviews.tsx`, `TrustBadges.tsx`, `StickyBuyBar.tsx`
- **Edit**: `src/pages/Product.tsx` (insert 5 components)
- **Edit**: `src/lib/storefront.ts` (join stats view, add `average_rating` + `review_count` fields)
- **Edit**: `src/integrations/supabase/types.ts` — auto-regenerated after migration

## Out of scope

- ไม่ทำ admin UI เขียนรีวิว (ตอนนี้ยังไม่มีคน login ฝั่งลูกค้า) — ถ้าต้องการค่อยเปิด phase 2
- ไม่ทำ Urgency/Scarcity (user prompt แนะไว้แต่บอก "ถ้ามีจริง" — ยังไม่มี field รองรับ, ข้ามเพื่อไม่หลอกลูกค้า)
- ไม่แก้หน้าอื่น

อนุมัติแล้ว build ต่อได้เลย
