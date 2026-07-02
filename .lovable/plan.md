
## Goal
Ebooks ที่ทำเสร็จ 100% (ก่อนอัพขึ้น Shopify) ต้องมีปุ่ม **Download PDF** + **Open PDF** ให้พรีวิวได้จากหน้า Command Center / Production ทันที

## Where the section is missing
`LiveProductionQueue.tsx` มี 6 sections (Working On / Queued / Waiting / Auto-Fix / Needs Code / Needs Admin) แต่ **ไม่มี section สำหรับเล่มที่เสร็จ 100% แล้วรอ Shopify push** — เล่มพวกนี้เลยหายจากหน้า queue แม้จะพร้อมให้พรีวิว

## Changes

### 1. Backend — `supabase/functions/admin-data/index.ts` (live_queue)
- เพิ่ม bucket ใหม่ `ready_to_publish` ใน response
- Query: `ebooks` ที่ `canonical_status IN ('ready_to_publish','completed')` **AND** `shopify_status IS NULL OR shopify_status != 'published'`
- คอลัมน์ที่ดึงเพิ่ม: `pdf_url`, `cover_url`, `final_quality_score`, `word_count` (ส่วนใหญ่มีอยู่แล้ว)
- Limit 20, order ตาม `updated_at DESC`

### 2. Frontend — `src/components/admin/LiveProductionQueue.tsx`
- เพิ่ม type field `ready_to_publish: QueueEbook[]` ใน `LiveQueue` interface
- เพิ่ม `<SectionReady items={data.ready_to_publish} />` แสดง **บนสุด** (สำคัญที่สุด — พร้อมส่งขายแล้ว)
- แต่ละการ์ดในนี้แสดง:
  - Title + cover thumbnail (ถ้ามี `cover_url`)
  - Badge เขียว **"100% — พร้อมพรีวิว"**
  - QC score + word count (ถ้ามี)
  - ปุ่ม **Download PDF** (ใช้ `downloadAdminPdf(ebook.id)` เดิมที่มีอยู่แล้วใน `EbookPDF.tsx`)
  - ปุ่ม **Open in new tab** (`window.open(pdf_url, '_blank')`)
  - ปุ่ม **Push to Shopify** (disabled + tooltip "Phase ถัดไป" — ตรงกับที่ผู้ใช้ระบุก่อนหน้า)

### 3. Icon + Empty state
- Icon: `CheckCircle2` สีเขียว (`text-emerald-600`)
- Title: `"พร้อมพรีวิว · Ready to Publish (100%)"`
- Empty: `"ยังไม่มีเล่มที่ผลิตเสร็จ 100%"`

## Out of scope
- ไม่แตะ Shopify push logic (Phase ถัดไป)
- ไม่แก้ pipeline orchestrator (`autopilot-pipeline/index.ts`) — เล่มถูก mark เป็น `ready_to_publish` โดย logic ที่มีอยู่แล้ว
- ไม่แก้ `EbookPDF.tsx` — ใช้ `downloadAdminPdf` helper เดิม

## Verification
1. Refresh Command Center — section ใหม่โผล่บนสุด
2. เล่มที่มี `pdf_url != null` แสดงปุ่ม Download active
3. คลิก Download → ไฟล์ดาวน์โหลด, Open → เปิด tab ใหม่
