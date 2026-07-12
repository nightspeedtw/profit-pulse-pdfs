---
name: childrens-ebook-studio
description: create original, commercially ready english children's picture books, bedtime stories, early readers, wordless picture books, and illustrated ebooks from concept through manuscript, page plan, illustration prompts, cover direction, metadata, and quality control. use when the user asks to write, design, illustrate, package, review, or automate a children's storybook or ebook for ages 0-12, including autopilot generation, lovable app workflows, amazon kdp preparation, character consistency, age suitability, story qc, cover qc, and production-ready page specifications.
---

# Children's Ebook Studio

Create original children's books suitable for commercial development. Never imitate a living artist, copy a protected story, reuse distinctive characters, or reproduce reference artwork. Extract only high-level qualities such as pacing, age targeting, emotional clarity, page rhythm, educational value, and visual storytelling.

## Core workflow

1. Establish a production brief. Infer reasonable defaults when the user omits details.
2. Build a market-aware concept matrix and choose the strongest original concept.
3. Create a story bible before drafting.
4. Write the full manuscript to the target age and format.
5. Convert the manuscript into a page-by-page storyboard.
6. Create a visual bible and illustration prompts with strict character continuity.
7. Create front cover, back cover, title page, copyright page, and optional activity pages.
8. Run story, child-safety, originality, illustration, typography, cover, and commercial QC.
9. Revise automatically until all hard gates pass.
10. Deliver structured production files or a Lovable implementation prompt.

Read these references as needed:
- `references/story-engine.md` for age bands, formats, plot architecture, and manuscript rules.
- `references/illustration-system.md` for visual bibles, page prompts, cover direction, and consistency.
- `references/qc-system.md` for scoring, hard gates, auto-revision, and release status.
- `references/lovable-build-prompt.md` when the user wants an app, website, or autopilot system in Lovable.
- `references/output-schema.md` when structured JSON or database-ready output is needed.

## Default production assumptions

Unless the user specifies otherwise:
- Language: English (US), natural and globally understandable.
- Age: 4-7.
- Format: 32-page picture book including front matter.
- Trim: 8.5 x 8.5 inches, portrait-safe square composition.
- Story text: 600-900 words.
- Reading time: 6-9 minutes.
- Tone: warm, imaginative, emotionally engaging, reassuring ending.
- Commercial goal: parent-approved, child-requested rereading, series potential.
- Art: original, expressive, colorful, readable at thumbnail size, no embedded text.

## Required brief

Create or infer:
- target age and reading level
- genre and category
- emotional promise
- educational or social-emotional theme
- main character, desire, flaw, and growth
- setting and visual hook
- word count and page count
- narration style
- art medium and palette
- market positioning and series potential
- prohibited topics, words, or visual elements

Do not begin final prose until the concept and story bible are coherent.

## Originality rules

- Generate new names, settings, conflicts, visual motifs, and resolutions.
- Do not paraphrase a reference story scene-by-scene.
- Avoid title structures, catchphrases, costumes, silhouettes, or character pairings strongly associated with an existing franchise.
- Record an originality note describing how the concept differs from references.
- Flag accidental similarity and regenerate before release.

## Manuscript behavior

- Match vocabulary, sentence length, emotional intensity, and plot complexity to the age band.
- Build a clear beginning, escalating middle, satisfying climax, and emotionally complete ending.
- Use page-turn questions, reveals, or visual surprises without creating unsafe fear.
- Prefer concrete verbs, sensory language, read-aloud rhythm, and purposeful repetition.
- Keep moral lessons implicit through action. Avoid lecturing.
- Give the child character meaningful agency.
- Maintain continuity of names, objects, time, weather, clothing, and character knowledge.
- For wordless books, write visual beats and emotional actions rather than prose.

## Illustration behavior

- Lock the character bible before generating page prompts.
- Repeat invariant character details in every prompt.
- Describe composition, camera distance, action, emotion, setting, lighting, palette, continuity, and negative constraints.
- Reserve quiet visual zones for text when text and image share a page.
- Keep key faces and actions away from trim and gutter danger zones.
- Never ask the image model to render final body text. Typeset text separately.
- Generate the cover only after the story and visual bible are locked.

## QC and autopilot

Use the release gates in `references/qc-system.md`. Revise automatically for up to three passes. A book cannot be labeled ready for sale if any hard gate fails.

Always provide:
- QC scorecard
- issues found
- revisions applied
- remaining human-review items
- release status: `draft`, `needs_revision`, `editorial_review`, or `production_ready`

Never claim legal clearance, copyright registration, guaranteed sales, guaranteed KDP approval, or professional developmental editing. State that final commercial publication should receive human proofreading and print-proof review.

## Deliverables

For a full book, deliver in this order:
1. Book brief
2. Three original concepts with selection rationale
3. Story bible
4. Full manuscript
5. Page-by-page storyboard
6. Character and visual bible
7. Illustration prompt for every spread/page
8. Cover brief and cover prompts
9. Front/back matter copy
10. Metadata: title, subtitle, description, keywords, categories, age/grade range
11. QC scorecard and revision log
12. Production notes for PDF/EPUB/KDP or Lovable implementation

When asked for an automated application, use `references/lovable-build-prompt.md` and return a complete builder prompt rather than a vague feature list.
