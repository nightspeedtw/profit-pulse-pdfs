
## เป้าหมาย
ปรับหน้า `src/pages/Product.tsx` (Book Preview / รายละเอียดสินค้า) ให้อ่านง่ายขึ้น เพิ่ม Look Inside แบบ carousel ที่ดึงภาพในเล่มมาแสดง และเพิ่มส่วน Trust ของ SecretPDF เพื่อเพิ่มความน่าเชื่อถือ

---

## 1) Quick UI fixes
- **ราคา ($10.99):** เปลี่ยนสีจาก `text-accent-foreground` เป็นสีเข้ม/คอนทราสต์สูงบนพื้นหลัง (ใช้ token `text-foreground` + ขนาดใหญ่ + `font-black`) พร้อมกล่องล้อมบางๆ ไม่ทับพื้นหลัง
- **ชื่อหนังสือ:** เปลี่ยนหัวข้อจาก `WOBBLY PROBLEM` เป็นชื่อเต็มจาก DB (`product.title` — เช่น *Barnaby's Wobbly Problem*) แสดงเต็มบรรทัด, ไม่ตัดคำ, ใช้ `leading-tight` + `break-words`

## 2) Look Inside (Book Preview Carousel)
สร้าง component ใหม่ `src/components/BookPreviewCarousel.tsx`
- รับ prop `images: { url: string; caption?: string }[]` (dynamic — รองรับ 3–4 หน้า หรือมากกว่า)
- ใช้ shadcn `Carousel` (embla) — ลูกศรซ้าย/ขวา + dots
- ภาพหน้า **สุดท้าย** ของ array แสดง overlay เบลอ + ข้อความ *"What happens next? Find out in the full book!"* + ปุ่ม CTA "Buy Now" ที่เลื่อนไปที่ปุ่มซื้อ
- ถ้า `images.length === 0` → ไม่แสดง section

### Data source
- ขยาย `StorefrontEbook` ใน `src/lib/storefront.ts` เพิ่ม field `preview_images: string[] | null`
- แก้ edge function `list-storefront` ให้ join `ebook_illustrations` (หรือ table ที่เก็บภาพในเล่ม) → ส่ง URL 3–4 ภาพแรกกลับมา สำหรับ Barnaby จะได้ภาพ watercolor ที่เพิ่ง generate
- Fallback: ถ้าไม่มี illustrations ให้ใช้ [cover_url] เพียงภาพเดียว (component จะไม่ render carousel เมื่อ length ≤ 1)

### ตำแหน่งใน Product.tsx
วางใต้ description / bullets, เหนือ Trust section

## 3) Platform Trust & Security section
สร้าง component `src/components/PlatformTrustSection.tsx` (reuse ได้ในทุกหน้าสินค้า)
- Heading: **"Why Buy via SecretPDF?"**
- Grid 3 คอลัมน์ (mobile: stack) — แต่ละการ์ดมี icon จาก `lucide-react` + heading + คำอธิบายสั้น:
  1. **100% Secure Delivery** (`ShieldCheck`) — ได้รับไฟล์ PDF ทันทีผ่านระบบเข้ารหัสที่ปลอดภัย
  2. **Multi-Device Compatibility** (`Tablet`) — เปิดได้บน iPad, Tablet, smartphone, และปริ้นท์ลงกระดาษ
  3. **Satisfaction Guaranteed** (`BadgeCheck`) — แพลตฟอร์มการันตีความพึงพอใจ มั่นใจได้ทุกการสั่งซื้อ
- ใช้ design tokens ที่มีอยู่ (border-2 border-foreground, sticker style ให้เข้ากับ theme editorial ของ SecretPDF) — **ห้าม** hardcode สี
- วางถัดจาก Look Inside carousel ในหน้า Product

---

## Technical notes
- Files to edit: `src/pages/Product.tsx`, `src/lib/storefront.ts`, `supabase/functions/list-storefront/index.ts`
- Files to create: `src/components/BookPreviewCarousel.tsx`, `src/components/PlatformTrustSection.tsx`
- ต้องติดตั้ง shadcn `carousel` ถ้ายังไม่มี (`src/components/ui/carousel.tsx`)
- ไม่แตะ backend schema — ใช้ table `ebook_illustrations` ที่มีอยู่แล้ว
- ไม่แก้ business logic อื่นๆ (checkout, download flow ฯลฯ)

## คำถามก่อนลงมือ
**Trust section** — คุณต้องการให้ใช้ข้อความ 3 คอลัมน์ตามที่เสนอด้านบน หรือจะเพิ่มคอลัมน์ที่ 4 เช่น *"Instant Refund Policy"* หรือ *"Trusted by 10,000+ Readers"* ด้วย?
