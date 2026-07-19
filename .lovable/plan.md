## Coloring Rulebook v2 — "Essentials Only"

**Owner intent:** หนังสือระบายสีไม่ต้องมีเนื้อเรื่อง. ระบบต้องผ่านง่ายขึ้น. เหลือเงื่อนไข "จำเป็นจริง" 3 ข้อ:

1. **ชื่อเรื่องน่าซื้อ** — title telegraphs fun + subject (parent-buyable).
2. **ตัวสะกดบนปกถูก 100%** — non-waivable (คงไว้).
3. **ปกกับข้างในเป็นเรื่องเดียวกัน** — cover-last, ใช้ interior เป็น reference.

Everything else (per-page 95/98 thresholds, duplicate rate <5%, uniqueness dHash, anatomy=95, colorability=92, weighted book gate ≥92, per-page floor 88, category presence prominence, etc.) becomes **advisory / auto-enhance**, not release-blocking.

---

### Changes (all scoped `book_type='coloring_book'` via `assertColoringOnly`)

**A. Gate simplification — `supabase/functions/_shared/coloring/gates.ts`**
- Replace `coloringPageGate` hard thresholds with a minimal **garbage floor**:
  - reject only if: `line_art_cleanliness < 70`, `printability < 70`, or any hard-fail in a reduced set: `watermark`, `random_text`, `signature`, `copyrighted_ip`, `invalid_svg`, `garbage_image_broken`.
  - Drop from hard-fail: `duplicate_page`, `duplicate_image_hash`, `out_of_category_object`, `cropped_subject`, `grayscale_area`, `anatomy_defect` (anatomy stays as advisory-only per rulebook amendment).
- Replace `coloringBookWeightedGate` with a **thin release check**:
  - keep `spelling_ok` (cover typography) as non-waivable.
  - drop `weighted_avg ≥ 92`, `per_page_floor ≥ 88`, `duplicate_scene_rate ≤ 0.05`, `hard_fails_total`.
- `coloringCoverGate` keeps only:
  - `title_readability ≥ 85` (was 95)
  - `spelling_ok` non-waivable
  - `cover_interior_match` (NEW — see B)
  - drop: `cover_category_match ≥ 98`, `cover_quality ≥ 92`, `age_label_present`, `logo_present`, `page_count_matches_final_pdf` (moved to build-time assertion, not a QC score), `blank_background` (already covered by garbage floor).
- `coloringReleaseGate` reduced to: `pdf_opens`, `cover_gate_pass`, `zero_prohibited_artifacts` (spelling + copyrighted_ip only).

**B. Cover-last "interior is the reference" — enforce a single path**
- `coloring-worker-tick`: ensure a coloring book cannot dispatch cover work until **≥60% of interior pages exist** (already partial — tighten & make sole path; remove any pre-interior cover fast-path).
- `coloring-book-cover` / `coloring-cover-generate`: require `interior_refs` (3 sampled interior pages) as inputs; reject invocation without them.
- Add `cover_interior_match` grader (vision): compares 3 sampled interior pages vs cover for subject/style parity. Passes ≥70. Failure → single inpaint/regenerate retry, then accept (no ceiling storm).

**C. Title-quality micro-gate (replaces story gate for coloring)**
- New tiny check in `coloring-book-start`: title must (a) include the primary subject/category noun, (b) be 3–8 words, (c) not be generic ("Coloring Book", "Fun Pages"). One rewrite max via `google_direct`; then accept.
- No story gate, no generic-risk, no premium score, no manuscript judges on the coloring lane. `lane-invariants.ts` already blocks these — extend test coverage.

**D. Escalation storm relief**
- `MAX_COVER_INVOCATIONS_PER_BOOK`: keep 8 absolute; but with looser gates, most books accept on attempt 1–2.
- Remove page-level regenerate loops driven by thresholds we just dropped (duplicate/anatomy/uniqueness → log advisory only).

**E. `pipeline_skills` doctrine**
- Register `coloring_rulebook_v2_essentials_only` with the 3 essentials + the removed gates list + rationale ("coloring has no story; over-gating caused false rejections & spend storms").

**F. Regression tests**
- `src/__tests__/coloring-rulebook-v2-essentials.test.ts`:
  - garbage page rejected; ordinary page passes without hitting old 95/98 thresholds.
  - cover with misspelled title rejected (non-waivable).
  - cover generated before interiors → refused.
  - cover mismatched with interiors → one retry, then either pass or garbage-only reject.
  - picture_book lane untouched (scope guard).

**G. Rescue sweep**
- One-shot SQL update: coloring books currently parked on dropped gates (`weighted_avg`, `per_page_floor`, `duplicate_scene_rate`, `cover_category_match`, `anatomy_defect`, `cover_quality`, `age_label_present`, `logo_present`) → reset to `queued` for re-evaluation under v2. Do NOT rescue: `spelling_ok=false`, `copyrighted_ip`, `garbage_image_broken`, `paid_ceiling`.

---

### Files touched
- `supabase/functions/_shared/coloring/gates.ts` (rewrite)
- `supabase/functions/coloring-book-start/index.ts` (title micro-gate; drop story-ish checks)
- `supabase/functions/coloring-worker-tick/index.ts` (cover-last enforcement)
- `supabase/functions/coloring-book-cover/index.ts` + `coloring-cover-generate/index.ts` (require interior refs; add `cover_interior_match`)
- `supabase/functions/coloring-book-publish/index.ts` (use thin release check)
- `supabase/functions/_shared/coloring/lane-invariants.ts` (extend forbidden list)
- New: `supabase/functions/_shared/coloring/cover-interior-match.ts`
- New test: `src/__tests__/coloring-rulebook-v2-essentials.test.ts`
- DB: register skill in `pipeline_skills`; rescue update on `ebooks_kids` coloring rows.

### Not touched
- Picture-book lane (all novel/story gates remain).
- Spelling gate (non-waivable, stays).
- Copyright / garbage / broken-PDF hard fails.
- Budget/paid-ceiling machinery.
