## สถานะปัจจุบัน (verified)

โครงมีอยู่แล้ว — ไม่ต้องสร้างใหม่จากศูนย์:
- **DB**: `blog_posts`, `blog_keywords`, `seo_content_queue`, `seo_keyword_clusters`, `seo_autopilot_settings`
- **Edge Functions**: `blog-autopilot`, `seo-autopilot-tick`, `seo-content-qa`, `seo-publish-approved`, `seo-keyword-seed`
- **UI**: `Blog.tsx`, `BlogPost.tsx`, `admin/SeoAutopilot.tsx`

Spec ที่คุณให้มา = 18 หมวด ครอบคลุมมาก ทำจบทีเดียวไม่ได้จริง (จะรวมกว่า 30 ไฟล์ + 6 migration + Core Web Vitals + SSR) จะแยกเป็น 4 phase ที่ ship แล้วใช้ได้ทันทีในแต่ละ phase

## ข้อจำกัดสำคัญที่ต้องแจ้งก่อน (Section 11)

โปรเจกต์นี้เป็น **Vite + React SPA client-side** — ไม่มี SSR/SSG จริง Google อ่านได้ (execute JS) แต่ social crawlers / AI crawlers บางตัวอ่าน static HTML เท่านั้น

**ทางเลือก:**
- (a) **Prerender บทความ blog เป็น static HTML** ตอน build (script อ่าน `blog_posts` แล้ว emit `.html` ต่อ slug ใน `dist/blog/`) — ทำได้ใน stack ปัจจุบัน
- (b) ย้ายทั้งโปรเจกต์ไป TanStack Start (SSR จริง) — งานใหญ่มาก กระทบทุกหน้า

Plan นี้จะไปทาง (a) — พอสำหรับ Google + AI SEO + Rich Snippets

---

## Phase 1 — Editorial Foundation (DB + Author + Structured Data)

**Migration** — extend `blog_posts` + สร้างตารางใหม่:
- ต่อคอลัมน์: `search_intent`, `funnel_stage`, `target_audience`, `country`, `language`, `content_cluster_id`, `parent_pillar_id`, `semantic_keywords[]`, `long_tail_questions[]`, `entities[]`, `related_product_ids[]`, `competing_urls[]`, `cannibalization_risk`, `author_id`, `reviewer_id`, `last_updated_at`, `reading_time_min`, `content_score`, `word_count_target_min`, `word_count_target_max`, `direct_answer`, `takeaways[]`, `sources[]`, `internal_links jsonb`, `og_image`, `canonical_url`, `robots`, `noindex`, `redirects_to`, `article_section`, `tags[]`, `published_status` enum, `decay_status` enum
- ตารางใหม่: `blog_authors` (E-E-A-T), `blog_reviewers`, `blog_content_clusters` (pillar↔supporting), `blog_redirects` (301 manager), `blog_revisions` (version history + rollback), `blog_internal_link_suggestions`, `blog_qa_findings`, `blog_decay_metrics`
- Enum: `blog_status` = draft, ai_generated, needs_fact_check, needs_human_review, approved, scheduled, published, needs_update, archived
- GRANTs + RLS ตามมาตรฐาน (public read published, admin full)

**Frontend**:
- `BlogPost.tsx`: เพิ่ม Breadcrumb, Author box, Reviewer badge, Published/Updated dates, Reading time, TOC (สำหรับบทความ >1200 คำ), Direct Answer summary block, Key Takeaways, FAQ (accordion), Sources list, Related Articles
- `Blog.tsx`: filter ตาม cluster/intent, hero + featured
- JSON-LD ครบ: `BlogPosting`, `Article`, `BreadcrumbList`, `Person`, `Organization`, `WebPage`, `FAQPage` (เฉพาะเมื่อมี FAQ ≥3 ข้อ)
- `react-helmet-async`: per-route title/meta/canonical/og:*/twitter (canonical + og:url self-reference)

**เกณฑ์เสร็จ Phase 1**: 1 บทความสาธิตแสดง breadcrumb + author + JSON-LD ที่ validate ผ่าน Rich Results Test

---

## Phase 2 — AI Writer + Quality Gate + Scoring

**Edge Functions** (upgrade เดิม + สร้างใหม่):
- `blog-brief-builder` (ใหม่): รับ primary keyword → เรียก Semrush (`keyword_research`, `serp_analysis`) + Gemini → สร้าง brief (secondary/semantic/entities/questions/intent/word count target/outline) และ **cannibalization check** (query `blog_posts` ด้วย primary_keyword + intent เดียวกัน; ถ้าเจอ → เสนอ update/merge/redirect แทน)
- `blog-writer` (ใหม่): brief → draft ด้วย Gemini 2.5 Pro (bypass gateway), ใส่ direct answer, TOC, H2/H3, examples, tables, FAQ, key takeaways
- `blog-quality-gate` (ใหม่): 17-check scanner (17 หัวข้อใน spec §6) + คำนวณคะแนน 100 คะแนน (10 categories ใน spec §16) → คืน `qa_findings` + `content_score` + verdict
- `blog-internal-link-suggester` (ใหม่): เทียบ topic/entity/cluster → เสนอ 3-8 links
- อัปเกรด `seo-content-qa`: เพิ่ม keyword-density guardrail 0.5-1.2% (เตือน >1.5%), heading order check, alt-text stuffing check, placeholder scanner

**Quality Rules** (บังคับใน gate ก่อน publish):
- score ≥80, no critical error, no placeholder, no unsupported claim, no duplicate title/meta/slug, canonical valid, structured data valid, featured image present, ≥1 internal link, primary keyword ปรากฏใน H1/URL/intro/H2/meta/conclusion อย่างเป็นธรรมชาติ
- Word count ตามช่วง intent (spec §2) — ไม่บังคับความยาวถ้าตอบครบ

**Default**: AI สร้าง `draft` → gate → `needs_human_review` (ห้าม auto-publish default)

---

## Phase 3 — Admin Dashboard + Cluster Map + Internal Linking

**หน้าใหม่/อัปเกรด**:
- `admin/BlogAutopilot.tsx` (upgrade `SeoAutopilot.tsx`): toggle autopilot, draft/publish quotas, require-human-approval, min score, blacklist/whitelist, brand voice, language/country, default author
- `admin/BlogEditor.tsx`: edit outline/metadata/body, live score, cannibalization warning, internal link suggestions panel, image manager, source verification checklist, revision history + rollback, merge/redirect actions
- `admin/BlogClusterMap.tsx`: visual pillar↔supporting graph, orphan detector, cannibalization detector, weak-link detector, outdated detector
- `admin/BlogUpdateQueue.tsx`: decay status pipeline (Stable/Growing/Declining/Needs Refresh/Rewrite/Merge/Redirect/Remove)
- `admin/BlogAuthors.tsx`: manage author profiles + reviewers (E-E-A-T)

**สิ่งที่บังคับใน UI**:
- แสดงคะแนน realtime ตอน edit
- แถบ warning เมื่อ cannibalization / duplicate / low score / missing internal link
- ปุ่ม "propose update/merge/redirect" แทน "create new" เมื่อ brief-builder เตือน

---

## Phase 4 — Technical SEO + Prerender + Performance

**Prerender script** (`scripts/prerender-blog.ts`): predev/prebuild hook อ่าน published `blog_posts` → เขียน `dist/blog/<slug>/index.html` พร้อม head tags + JSON-LD + body HTML (ให้ crawler ที่ไม่ execute JS อ่านได้)

**Sitemap upgrade** (`scripts/generate-sitemap.ts`):
- ดึง blog posts จาก DB
- แยก image sitemap
- lastmod จริง

**ไฟล์เพิ่ม/แก้**:
- `public/robots.txt`: allow all, sitemap reference
- `public/rss.xml`: generated จาก blog_posts
- Edge function `indexnow-ping`: เมื่อ publish/update/merge/redirect/delete → ping IndexNow (Bing) + Google Indexing API (ถ้าคีย์พร้อม)
- Edge function `blog-redirect-handler`: 301 manager (client-side redirect + `<link rel="canonical">` fallback ตราบใดที่ยังไม่มี edge redirect layer)
- Edge function `blog-broken-link-checker` (cron): scan `body_md` links → HEAD check → mark broken

**Image pipeline** (`_shared/image-pipeline.ts`):
- Featured image ≥1200px
- Emit WebP + AVIF crops 1:1 / 4:3 / 16:9
- Width/height attrs, lazy-load (except LCP), meaningful filename + alt
- Alt-text stuffing detector

**CWV** (Blog/BlogPost only — ไม่แตะหน้าอื่น):
- Font preload, image dimensions, prevent CLS on hero, code-split blog routes, remove unused JS on blog pages

**Search Console / Bing integration**: guide + secret slots (`GOOGLE_SEARCH_CONSOLE_KEY`, `BING_WEBMASTER_KEY`, `INDEXNOW_KEY`) — request via `add_secret` เมื่อ user พร้อม

**Decay monitor** (`blog-decay-scanner` cron): daily → คำนวณ decay status จาก impressions/CTR/position/last_updated → enqueue update recommendations

---

## Technical notes

- ทุก AI call ผ่าน `BYPASS_LOVABLE_GATEWAY=1` (Gemini direct primary, GPT fallback)
- ทุกตารางใหม่ = migration พร้อม GRANT + RLS (public SELECT เฉพาะ published, admin ALL, service_role ALL)
- ไม่แตะ `secretpdf-production-suite` (แยก lane จาก kids/coloring pipeline)
- Type gen อัตโนมัติหลัง migration
- `react-helmet-async` ต้อง install + wrap `<HelmetProvider>` ที่ `main.tsx` (แค่ครั้งเดียว)
- Semrush tools ใช้จาก Lovable built-in (ไม่ต้อง connect เพิ่ม สำหรับ per-brief lookup)

---

## เริ่มจากไหน — โปรดยืนยัน

Plan นี้ **จะเริ่ม Phase 1** (Editorial Foundation) ก่อนเป็นค่า default — ได้โครงที่ถูกต้อง แล้วค่อยชั้น AI writer + admin + technical ทีหลัง

ถ้าอยาก **rearrange** (เช่น เริ่ม Phase 4 prerender ก่อนเพราะ Google index สำคัญกว่า, หรือทำ Phase 2 AI writer ก่อนเพราะอยากได้บทความเร็ว) บอกได้เลย จะจัดใหม่ตาม priority

**ต่อ Phase 1 เลย หรือปรับลำดับก่อน?**