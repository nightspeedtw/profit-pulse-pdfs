
## สรุปสถานะปัจจุบัน (verified)

**Hero images ขาด:** จาก 18 posts ที่ published, มี **10 posts** ที่ `hero_image_url IS NULL` — ทั้งหมด published 2026-07-22 (batch เดียวกัน). สาเหตุ: `blog-autopilot/index.ts:170-184` เรียก Runware ใน try/catch แล้วถ้าล้ม จะ **แค่ warn แล้ว publish ต่อ** (`heroUrl=null`). Design fail-open นี้ทำให้ post โผล่ขึ้น shelf โดยไม่มีรูปประกอบ

**Autopilot ยังไม่ auto:** `SELECT * FROM cron.job` ไม่มี entry สำหรับ `blog-autopilot` หรือ `seo-autopilot-tick` (มี marketing/coloring/kids/drive แต่ไม่มี blog+SEO) → SEO blog ต้องเรียกด้วยมือทุกครั้ง

---

## แผนแก้ถาวร (build mode)

### Step 1 — Fail-closed hero image policy (`blog-autopilot`)
แก้ `supabase/functions/blog-autopilot/index.ts:168-232`:
- Provider ladder ใหม่: **(1) Runware Ideogram → (2) Cloudflare Workers AI (flux-1-schnell) → (3) Gemini image (Nano Banana)**. ทุก provider มีเครดิตอยู่แล้วใน secrets
- ถ้าครบ 3 provider ล้มหมด → **ไม่ publish** ให้ save เป็น `status='draft'` พร้อม `blocker_reason='hero_image_all_providers_failed'` แทน (fail-closed)
- Log ทุกความล้มเหลวไปที่ `alert_log` เพื่อให้ health-monitor ส่งอีเมลเตือน

### Step 2 — Backfill 10 posts เก่า (`blog-hero-backfill` edge function ใหม่)
- Query `blog_posts WHERE status='published' AND (hero_image_url IS NULL OR hero_image_url='')`
- สำหรับแต่ละโพสต์: สร้างรูปด้วย provider ladder เดียวกับ Step 1 (ใช้ `hero_image_prompt` ที่ regenerate จาก title+dek), อัปโหลด `ebook-covers/blog/`, update `hero_image_url`
- Idempotent: skip โพสต์ที่มีรูปแล้ว
- รันครั้งเดียวหลัง deploy เพื่อเก็บ 10 posts ค้าง

### Step 3 — ตั้ง cron อัตโนมัติ (migration)
เพิ่ม 2 pg_cron entries:
- `blog-autopilot-weekly` — `0 9 * * 1` (จันทร์ 09:00 UTC = 16:00 ICT) เรียก `blog-autopilot`. Function มี **monthly cap 8 posts** guard อยู่แล้ว (`seo-autopilot-tick` เก็บ counter) — เรียกซ้ำได้ปลอดภัย
- `seo-autopilot-tick-daily` — `0 8 * * *` (ทุกวัน 08:00 UTC) เรียก `seo-autopilot-tick` (keyword sweep + queue publish)
- `blog-hero-backfill-hourly` — `23 * * * *` เรียก `blog-hero-backfill` เพื่อ self-heal โพสต์ที่พลาดรูป (idempotent, no-op เมื่อไม่มีค้าง)

### Step 4 — Regression + observability
- เพิ่ม `pipeline_skills` row `blog_hero_fail_closed_v1` เอกสารกฎ fail-closed
- อัปเดต `HealthIncidentBanner` ให้แสดง blog blocker ถ้ามีโพสต์ค้าง `hero_image_all_providers_failed` > 0
- Regression: หลังรัน backfill ต้องได้ `count(hero_image_url IS NULL AND status='published') = 0`

## Deliverables
- แก้ไข: `supabase/functions/blog-autopilot/index.ts` (fail-closed + provider ladder)
- ใหม่: `supabase/functions/blog-hero-backfill/index.ts`
- Shared: `supabase/functions/_shared/blog-hero-image.ts` (provider ladder helper — reuse ทั้ง autopilot และ backfill)
- Migration: 3 pg_cron entries + 1 skill row
- ผลลัพธ์: 10 posts ค้าง → มีรูปครบ, blog+SEO autopilot รันเองสัปดาห์ละครั้ง, จะไม่มีโพสต์ published ไม่มีรูปอีก
