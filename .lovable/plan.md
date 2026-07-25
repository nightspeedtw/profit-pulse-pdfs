## Goal
เพิ่ม Cloudflare account ตัวที่ 7 เข้าไปใน rotation เพื่อปลดล็อค interior render (โควตาเพิ่ม +10,000 neurons/วัน) และให้ระบบเดินหน้าสร้างเล่มใหม่ต่อทันที ไม่ต้องรอ 00:00 UTC

## Current state (verified)
- 116 เล่มค้างที่ `interior_render` — error เดียวกันทั้งหมด: `provider_billing_locked (429): cloudflare: all 6 accounts daily-latched`
- Live วันนี้ 9 เล่ม, ล่าสุด 05:09 UTC
- Production lock ปกติ (ถือโดย `abce4e6d Alphabet Appetites`, page 31/32)
- Text stages (page_plan/concept) เดินได้ปกติผ่าน Gemini/OpenAI

## Steps

### 1. รับ credentials CF #7 (blocking)
ผมจะเรียก `add_secret` สองตัว — user paste ค่าจาก Cloudflare dashboard ของบัญชีที่ 7:
- `CF_ACCOUNT_ID_7` — Account ID (32-hex string)
- `CF_API_TOKEN_7` — API token ที่มีสิทธิ์ Workers AI → Read/Run

### 2. ต่อสายบัญชีที่ 7 ใน rotation
แก้ `supabase/functions/_shared/image-providers.ts`:
- ขยาย `CF_ACCOUNT_SLOTS` จาก 6 → 7
- เพิ่ม env pair `CF_ACCOUNT_ID_7` / `CF_API_TOKEN_7` เข้า array
- Round-robin cursor ยังใช้ modulo N เดิม (ไม่ต้องแก้ logic)
- Latch key ใช้ index `6` (ตัวที่ 7) — key namespace เดิม, ไม่กระทบ latch เก่า

### 3. ปลดล็อคเล่มที่ค้าง (เฉพาะ interior_render)
รัน insert-tool SQL:
- Reset `stage_attempt_count = 0`, `last_error = NULL` สำหรับ 116 เล่มที่ error = billing_locked
- **ไม่แตะ** เล่มที่ error อื่น (`PGRST116` ฯลฯ — เป็นคนละ class)
- **ไม่แตะ** production lock — ปล่อยให้ `abce4e6d` ทำต่อจนจบ แล้ว tick ค่อยเลือกเล่มถัดไปตาม ranking เดิม

### 4. Deploy + verify
- Deploy เฉพาะ 2 edge functions: `_shared` (ผ่าน function ที่ import) + `coloring-v2-render-page`
- เรียก `coloring-v2-tick` 1 ครั้งเพื่อยืนยัน dispatch
- อ่าน log `coloring-v2-render-page` — ต้องเห็น `cf_account_index: 6` ไม่ใช่ `all 6 accounts latched`

## Technical notes
- Latch state เก็บใน `generation_settings` (row `cf_account_latches`) — mapping by index, ไม่ต้อง migrate. บัญชี #7 (index 6) จะเป็น "unlatched" โดย default
- ผมจะเก็บ **One-Book-At-A-Time law** ไว้ครบ — lock, chain owner, MAX_SLOTS=1 ไม่แตะ
- ไม่ลด quality gate, ไม่ bypass QC — แค่เพิ่ม capacity provider

## Definition of done
1. `CF_ACCOUNT_ID_7` + `CF_API_TOKEN_7` มีค่าใน secrets
2. `coloring-v2-render-page` เรียก CF โดยไม่คืน `all 7 accounts latched` (ต้องเห็น success อย่างน้อย 1 หน้า)
3. เล่มถัดไปหลัง `abce4e6d` เดินหน้าถึง `cover` หรือ `qc` ภายใน 30 นาที

## Not in scope
- ไม่อัปเกรด CF paid plan
- ไม่ route interior ไป Runware/Ideogram (คงกฎ CF-primary สำหรับ interior)
- ไม่แตะ cover stage (Gemini/GPT ตามเดิม)