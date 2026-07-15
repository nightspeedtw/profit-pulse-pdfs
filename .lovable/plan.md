# Stop ebook row recycling + recover Flicker

Diagnosis confirmed: `kids-fresh-book-start` accepts `use_ebook_id` and unconditionally overwrites `title`, `subtitle`, `description`, `manuscript_md`, `storefront_meta` on that row. `kids-one-click-build` calls it on its first parent-loop iteration with the placeholder id — but the "placeholder" turns out to be an ebook that was previously fully built (row 784ce3aa was published as "Flicker's Wobbling Wheel" at 06:11, then a repair/rerun cycle at 06:21 relabeled it "Flicker's Wobbling Wheel" via metadata_gate auto_sync on a NEW manuscript, then at 06:52 the same row was overwritten again as "Stir-Stir-Whiff!"). Audit shows 15+ rows with >1 distinct manuscript refrain, worst: `12708bfc` (6 refrains / 17 runs) and `1b1d9e1d` (6 refrains / 11 runs). This is systemic.

## 1. Permanent stop — row identity is immutable

New migration:

- Add `ebooks_kids.ever_live boolean not null default false` and backfill `true` for any row whose `listing_status='live'` now or whose `pdf_url is not null AND pipeline_status in ('published','retired')` (retired-with-pdf means it WAS built and shipped, matches Flicker case).
- Add `ebooks_kids.identity_locked_at timestamptz` set the first time `manuscript_md` is written (via trigger). Once set, `title`, `subtitle`, `manuscript_md`, `story_bible` become effectively immutable.
- Add trigger `ebooks_kids_identity_guard` (BEFORE UPDATE):
  - Reject if `pipeline_status` was already `retired` (OLD) and NEW changes any of `title, subtitle, description, manuscript_md, story_bible`.
  - Reject if `OLD.ever_live` and NEW changes those same columns.
  - Reject if `OLD.identity_locked_at IS NOT NULL` and NEW changes `title, manuscript_md, story_bible` unless columns are being set to the same value.
  - Reject if any `royalty_holdings` row references this book_id and content columns change.
  - Escape hatch: session GUC `app.allow_identity_override = 'on'` bypasses the trigger (admin-only, set per-transaction). No permanent boolean column — an override flag on the row is itself mutable and defeats the guard.
- `book_royalty_markets` / `royalty_holdings` foreign keys already point at `ebooks_kids.id`; the trigger's holdings check protects the upcoming money surface.

## 2. Code — always insert a new row per attempt

`supabase/functions/kids-fresh-book-start/index.ts`:
- Remove the `use_ebook_id` branch entirely. Every call inserts a fresh `ebooks_kids` row and returns its id.
- Callers must adapt to the new id.

`supabase/functions/kids-one-click-build/index.ts`:
- Delete the `firstIteration` special-case that reused the placeholder. Every loop iteration calls `kids-fresh-book-start` with no `use_ebook_id`. The placeholder created at request time is immediately marked `pipeline_status='retired'`, `blocker_reason='placeholder_superseded'`, so it becomes an inert tombstone (kept for audit).
- `resumeParentRun` no longer forwards `run.ebook_kids_id` as `currentEbookId` — the loop always creates fresh.

`supabase/functions/autopilot-kids-pipeline/index.ts` (generate_manuscript step): pre-check — if the row already has `manuscript_md` AND `identity_locked_at IS NOT NULL`, skip and log `skipped: identity_locked` instead of overwriting.

Repair supervisor / watchdog / kids-repair-supervisor: any path that today re-invokes `rewrite-kids-manuscript` on an existing row is neutered by the DB trigger (retired + ever_live rows reject the update). Log the rejection cleanly rather than crash.

## 3. Recover "Flicker's Wobbling Wheel"

Assets that survive on storage under `kids/784ce3aa-.../`:
- 28 interior page PNGs (page-01 → page-28, all timestamped 06:00:59–06:01:35 — the ORIGINAL Flicker interiors, not the later Stir-Stir-Whiff regeneration since no new page-XX files exist)
- `cover-master-1784095232445-71ffca6c.png` (06:00:32, original Flicker cover master)
- `book.pdf` — last updated 06:25:40, which is AFTER the 06:21 repair run's metadata_gate re-titled it back to "Flicker's Wobbling Wheel". This PDF is the Flicker book with the second (still-Flicker) manuscript, not Stir-Stir-Whiff. Recoverable.
- Character reference sheet (06:00:30).

Lost:
- `manuscript_md` full text (not stored in logs — only refrain + segment count).
- Original `story_bible` object.
- Product page copy.

Recovery plan:
- Insert a new `ebooks_kids` row with a fresh UUID (`FLICKER_NEW_ID`), title `Flicker's Wobbling Wheel`, subtitle `Chef Squeak's Sniffing Surprise` (per surviving row snapshot), `pipeline_status='needs_repair'`, `listing_status='draft'`, `sellable=false`, price 799.
- Copy each surviving storage object from `kids/784ce3aa-.../` to `kids/{FLICKER_NEW_ID}/` (Supabase Storage COPY API). Set `cover_url`, `pdf_url`, `thumbnail_url`, `preview_page_urls`, `interior_illustrations`, `character_sheet_url` from the copies.
- Add `storefront_meta.recovered_from = '784ce3aa-…'` and `storefront_meta.recovery_notes` describing what was lost.
- Queue the owner's ordered master-continuity repair (regenerate pages 4/6/7/10/12/13/15/16/18/20/23/24/25/27/30/31; reorder pages 28–31) on the NEW row. Hold from publish until the master QC passes — matches earlier `illustrated_book_master_continuity_lock` skill.
- Mark old row `784ce3aa` `pipeline_status='retired'`, `blocker_reason='row_recycled_recovered_as:{FLICKER_NEW_ID}'`.

## 4. Audit findings

Rows that show recycling AND had a built PDF at some point (i.e., a real book existed before being overwritten):

| id | current title | distinct refrains | had pdf |
|----|---------------|-------------------|---------|
| 12708bfc | Chef Pip's Puf-Tastic Pizza! | 6 | yes — original was Pip's Perfect Pudding |
| 1b1d9e1d | Chef Pip's Sticky Situation | 6 | yes |
| 784ce3aa | Stir-Stir-Whiff! (was Flicker) | 2 | yes |
| 241be79f, a532dca0, 82edbb75, 148eda2c, b12f7fcd | various retired | 1 | yes |

Recovery beyond Flicker: only `12708bfc` and `1b1d9e1d` show enough recycling to be worth investigating further, and both are already `retired`. I'll list their surviving storage paths in the delivery report so the owner can decide whether to recover any as separate rows — but I won't auto-recover them (unclear which manuscript version matches the surviving PDF).

## 5. New pipeline_skill (learned, data-integrity)

Insert into `pipeline_skills`:
- `skill_key = 'book_identity_immutable'`, `source='learned'`, `target_dimension='data_integrity'`.
- Body: "A book_id is never reused. Every concept attempt inserts a new `ebooks_kids` row. Rows that were ever `listing_status='live'`, ever had `pipeline_status='published'`/`retired` with assets built, or have any `royalty_holdings` / `book_royalty_markets` / `book_sales_ledger` reference are TOMBSTONES — their title/manuscript/story_bible are read-only. Concept rotation, repair loops, and watchdogs must all create new rows. The DB trigger `ebooks_kids_identity_guard` enforces this; code paths must NOT try to bypass it."

## Verification

After deploy: try to `UPDATE ebooks_kids SET title='X' WHERE id='784ce3aa…'` — expect trigger rejection. Trigger a fresh `kids-one-click-build` — expect a new row per attempt, placeholder marked retired. Confirm Flicker recovery row is visible in admin and holds original assets.

## Deliverables

Migration, edge function edits (fresh-book-start, one-click-build, pipeline generate_manuscript guard), storage-copy recovery script for Flicker, skill row, audit table, and final report.

Please approve so I can execute — especially the Flicker recovery approach (new row + storage copies + repair queue), since it changes storefront visibility.
