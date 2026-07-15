# Lovable Builder Prompt

Build a production-grade web application named **Storybook Studio AI** for creating original, illustrated English children's books and ebooks from concept to export. The system must support guided creation and full autopilot while keeping every stage editable and versioned.

## Product objective

Enable a user to generate commercially developable children's picture books, bedtime stories, early readers, wordless picture books, educational stories, and illustrated chapter books. The app must create the story, page plan, character bible, illustration prompts/images, cover concepts, metadata, and a rigorous QC report. It must never copy reference stories or imitate named living artists.

## Core user flows

### 1. New project wizard
Collect or infer:
- target age: 0-3, 3-5, 4-7, 6-8, 7-10, 9-12
- format: picture book, bedtime, early reader, rhyming, wordless, educational, adventure, SEL, chapter book
- genre/category
- theme or lesson
- tone
- desired word count and page count
- trim size
- narration style
- art medium and visual mood
- diversity and representation preferences
- prohibited content
- publishing target: digital PDF, EPUB, Amazon KDP print, web reader
- mode: guided or autopilot

### 2. Concept generator
Generate 3-10 fully original concepts. Score child appeal, emotional clarity, visual potential, originality, age fit, read-aloud quality, series potential, and commercial title potential. Let users select, combine, regenerate, or lock a concept.

### 3. Story bible
Generate and edit:
- hook
- emotional promise
- protagonist desire, internal need, fear, and growth
- supporting cast
- setting rules
- conflict ladder
- climax choice
- ending image
- repetition pattern
- vocabulary target
- continuity ledger

### 4. Manuscript studio
Create the complete English manuscript. Provide:
- page/spread view
- text editor
- version history
- word count and reading-time indicator
- age-level readability indicator
- page-turn strength indicator
- read-aloud playback using TTS when available
- regenerate sentence, paragraph, page, scene, or full manuscript
- lock approved text so later regeneration cannot overwrite it

### 5. Storyboard and page planner
Show every page/spread as a card containing:
- page number
- story text
- visual beat
- character list
- setting
- emotion
- continuity data
- illustration status
- QC status
Allow drag-and-drop reordering while warning about broken continuity.

### 6. Character and visual bible
Create reusable character sheets with immutable attributes, palette, clothing, props, expressions, proportions, and reference poses. Store character reference images and inject the locked description/reference into every illustration request.

### 7. Illustration generation
Support image generation providers through a provider adapter layer. Never hard-code one vendor. Include:
- generate page illustration
- regenerate with preserved character identity
- image-to-image/reference-image support where provider allows
- seed/reference persistence
- selectable aspect ratio and print resolution
- crop/safe-zone overlay
- no-text image rule
- negative prompt
- asset versioning
- manual upload replacement
- batch generation queue
- failed-job retry

### 8. Cover studio
Generate three cover strategies: emotional character-led, action-led, and atmospheric/symbolic. Include thumbnail preview, title-safe area, spine/back cover planning, barcode-safe area, and cover QC. Typeset title separately from artwork.

### 9. QC engine
Run automatic checks after every major generation and before export.

Hard gates:
- child safety failure
- age mismatch
- copied/derivative concept or franchise-like character
- plot contradiction
- missing ending
- unresolved severe fear
- duplicate/missing pages
- visual continuity failure
- cover that misrepresents the book
- body text embedded in generated art
- unverified educational claim

Score 100 points:
- story/child experience 35
- age/safety 20
- visual production 20
- originality/commercial readiness 15
- technical/editorial 10

Thresholds:
- 92+: production ready only when all hard gates pass
- 85-91: editorial review
- 70-84: needs revision
- below 70: draft

Implement up to three automatic revision passes: structural, language/continuity, commercial/production. Show before/after changes and never overwrite locked content.

### 10. Export and publishing package
Export:
- print-ready PDF with selectable bleed and trim
- digital PDF
- EPUB with reflowable or fixed layout options
- manuscript DOCX
- illustration ZIP
- cover files
- metadata CSV/JSON
- KDP checklist
- complete project JSON

Add preflight checks for missing fonts, low-resolution images, unsafe margins, bleed, gutter, page count, blank pages, and missing metadata.

## Autopilot mode

The user may choose a category or allow the system to select one. Autopilot must:
1. Build a category opportunity matrix, not generate random books.
2. Avoid duplicate concepts in the user's library.
3. Choose age, genre, theme, art direction, title angle, and series opportunity.
4. Generate concept, story bible, manuscript, storyboard, visual bible, illustration jobs, cover, metadata, and QC.
5. Revise until thresholds pass or flag for human review.
6. Stop and request review for hard-gate safety, originality, or factual concerns.
7. Preserve a complete audit log of prompts, outputs, model/provider, versions, QC, and approvals.

## Content categories

Support animals, bedtime, friendship, confidence, emotions, family, school, kindness, adventure, fantasy, magic, dinosaurs, space, nature, environment, STEM, humor, mindfulness, hygiene, good manners, cultural celebrations, mysteries, wordless imagination, and custom categories. Use age-sensitive controls for scary or emotionally difficult themes.

## Architecture

Use TypeScript, React, Tailwind, and shadcn/ui. Use Supabase for authentication, PostgreSQL data, row-level security, storage, and job records. Use server-side edge functions for all AI provider calls and secrets. Build provider adapters for text, image, moderation, embeddings/originality comparison, TTS, and export rendering.

Suggested tables:
- users
- workspaces
- projects
- project_versions
- briefs
- concepts
- story_bibles
- characters
- character_assets
- visual_bibles
- pages
- page_versions
- image_jobs
- assets
- cover_concepts
- qc_runs
- qc_issues
- revision_runs
- exports
- prompt_templates
- provider_settings
- audit_logs

Use strict row-level security. Never expose API keys in the browser. Add quotas, cost tracking, retry policies, idempotency keys, and job cancellation.

## Admin area

Include:
- model/provider configuration
- prompt template editor with versioning
- age-band rules editor
- banned topic and safety rule editor
- QC weight/threshold editor
- category manager
- generation cost dashboard
- failed job queue
- user/project management
- audit log

## UI requirements

Create a polished, friendly, premium children's publishing interface for adults, not a childish toy UI. Use a clean dashboard, project cards, progress steps, split manuscript/preview view, visual page grid, QC badges, version compare, and clear approval/lock controls. Ensure excellent mobile and desktop behavior.

## Originality and safety

- Generate only original stories and visual directions.
- Do not imitate named living artists.
- Do not clone copyrighted characters, franchises, covers, plots, or page sequences.
- Run semantic similarity checks against the user's own library and any provided reference summaries.
- References may influence only high-level qualities such as pacing, age targeting, emotional clarity, visual rhythm, and educational structure.
- Add human-review notices before commercial publication.

## Definition of done

The app is complete only when a user can create a project, generate and edit a full book, maintain character consistency, generate or upload every illustration, create a cover, pass QC, preview the complete book, and export a production package without manually editing the database.
