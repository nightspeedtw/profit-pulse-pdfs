
## เป้าหมาย
Unblock vision provider ด้วย Vertex AI (GCP) แล้วเก็บ Starlight Unicorns ให้จบ (ปกวาดใหม่ + anatomy sweep) ก่อนไปเล่มถัดไป (Bold Block Alphabet) ตามกฎ one-book-at-a-time

## ต้องได้จากเจ้าของก่อน (blocker)
Vertex AI ต้องใช้ GCP service account credentials ผมจะขอเป็น secret 3 ตัว:
- `GCP_PROJECT_ID` — GCP project ที่เปิด Vertex AI API แล้ว
- `GCP_LOCATION` — เช่น `us-central1` หรือ `asia-southeast1`
- `GCP_SERVICE_ACCOUNT_JSON` — service account key JSON (มี `roles/aiplatform.user`)

เจ้าของทำใน GCP Console:
1. Enable **Vertex AI API** ใน project ที่เลือก
2. IAM → Service Accounts → สร้างใหม่ → grant **Vertex AI User**
3. Keys → Add Key → JSON → ดาวน์โหลด → ทั้งไฟล์ = value ของ `GCP_SERVICE_ACCOUNT_JSON`

ระหว่างรอ ผม implement โค้ดให้พร้อมเรียกได้ทันทีที่ secrets มา

## แผนงาน

### Step 1 — Vertex AI vision adapter (โค้ดใหม่)
สร้าง `supabase/functions/_shared/vertex-vision.ts`:
- OAuth2 JWT bearer flow: sign JWT ด้วย service account private key → แลก access_token ที่ `oauth2.googleapis.com/token` (cache 55 นาที)
- ฟังก์ชัน `vertexGeminiVision({imageUrl, prompt, model})` เรียก `https://{LOCATION}-aiplatform.googleapis.com/v1/projects/{PROJECT}/locations/{LOCATION}/publishers/google/models/gemini-2.5-pro:generateContent`
- Return `{ ok, text, raw }`

### Step 2 — Wire เข้า anatomy ladder
แก้ `supabase/functions/_shared/coloring-v2/anatomy-check.ts`:
- Ladder ใหม่: **(1) Vertex Gemini 2.5 Pro → (2) OpenAI GPT-4o direct → (3) Gemini AI Studio direct → (4) Lovable Gateway (ถ้ามี allow)**
- ใช้ `buildUserPrompt` + `CANONICAL_PARTS` checklist ที่ทำไว้แล้ว
- Skip provider ที่ throw 401/402/404/billing → ลอง provider ถัดไป (3-strike ทั้ง book ถึงจะหยุด, ไม่ใช่ per-page)

### Step 3 — Wire เข้า cover generator
แก้ `supabase/functions/coloring-v2-cover/index.ts` + `coloring-v2-illustrated-cover-once/index.ts`:
- ก่อน route ไป OpenAI images → เช็ค OpenAI available; ถ้า billing_hard_limit → route ไป **Vertex Imagen 3** (`imagen-3.0-generate-002`) เป็น secondary
- คงกฎ Gemini/OpenAI-only (ห้าม Runware/CF ทำปก) และ 3-strike stop

### Step 4 — Repair Starlight Unicorns
1. Clear `meta.repair_verdict` ทุกหน้า (v2_id `0c1bfd74-...`)
2. เรียก `coloring-v2-repair-book` batch (6 หน้าต่อรอบ) จนครบ ~32 หน้า — anatomy gate ใช้ ladder ใหม่จริง
3. เรียก `coloring-v2-illustrated-cover-once` (subject-aware unicorn prompt ที่ patched ไปแล้ว) → ได้ cover วาดมือใหม่ที่มี **4 legs, 1 horn, 1 tail** ครบ
4. rebuild PDF, run OCR/SVG spelling verifier, restore `listing_status=live` เมื่อ pass

### Step 5 — ไปเล่มถัดไปตามกฎ
เมื่อ Starlight ขึ้น shelf แล้ว → pick **Bold Block Alphabet Coloring Book** (v2_id `dc696ca8-...`, stage=cover, interiors เสร็จ) → run cover → QC → PDF → publish → ค่อยเลื่อนไปเล่มถัดไป

### Step 6 — Regression + memory
- Regression fixture: fake OpenAI 402 + fake Gemini 404 → ต้อง fallback ไป Vertex สำเร็จ
- Register `pipeline_skills` เอกสาร `vertex_vision_ladder_v1`
- อัปเดต `mem://` core rule: Vision provider ladder = Vertex → OpenAI → Gemini-direct

## Deliverables
- โค้ดใหม่/แก้ไข: 4 edge functions + 1 shared helper
- Starlight Unicorns: `sellable=true`, cover วาดมือใหม่, anatomy pass ทุกหน้า
- Bold Block Alphabet: อยู่ระหว่างผลิต หรือเสร็จ
- Regression test + release-manifest validator pass

## หมายเหตุ (technical)
- Vertex OAuth JWT signing ทำใน Deno ผ่าน `crypto.subtle` (RS256) — ไม่ต้องมี dep เพิ่ม
- Access token cache ใน module scope (edge function warm reuse)
- ค่าใช้จ่าย: Gemini 2.5 Pro บน Vertex ~$1.25/1M input tokens; vision QC หน้าละ ~$0.005 — ต่ำมาก
- Vertex billing ไปที่ GCP project ของเจ้าของโดยตรง (ไม่ผ่าน Lovable credits)
