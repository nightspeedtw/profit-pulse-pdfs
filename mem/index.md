# Project Memory

## Core
Kids picture books: 32 pages standard, 8.5×8.5", watercolor+ink storybook style, character invariants locked per page.
CHARACTER LOCK (mandatory for every kids book): before ANY image (cover or interior) is generated, build ebooks.kids_visual_bible (species, exact fur/skin color+hex, eyes, clothing with color+material+one memorable detail, proportions, signature identifier, art medium, palette, world, negative). Every subsequent image prompt MUST inject the character `invariant_features` string verbatim. Cover character MUST match every interior chapter character (same fur, same outfit, same eye color, same art medium). Shared helper: supabase/functions/_shared/kids-visual-bible.ts (isKidsPictureBook, getOrBuildKidsVisualBible, kidsIllustrationPrompt, generateSceneBriefs). generate-cover and render-pdf both read from this bible for kids books — never the finance/nonfiction planner.
Kids cover workflow (TWO PASS): Pass 1 = generate soft watercolor storybook base illustration ONLY (atmospheric, cozy, painterly, uncrowded — v2 direction, never busy). Pass 2 = use imagegen--edit_image to overlay a custom illustrated title LOGO (Peppa Pig / Bluey / Paddington / Gruffalo tier) painted in the same medium, every letter uniquely hand-drawn with story-linked decoration (vines/berries/leaves/ears/stars), emotion words visually distort (Wobbly=wavy, Sleepy=droops, Zoom=streaks). NEVER bake the title into pass 1. NEVER an existing font, NEVER hand-drawn fonts, NEVER flat text overlay.
Kids covers storefront display: after shipping the finished cover to ebooks.cover_url, ALSO set ebooks.store_thumbnail_url AND ebooks.thumbnail_url = the same cover URL. Do NOT run or accept generic book mockups for kids picture books (yellow book, stars, "ILLUSTRATED STORY" badge); preserve the hand-painted cover everywhere.
User does not use Shopify anymore — skip all shopify- steps, publish natively via storefront + Stripe.
Auto-price kids picture book: base $6.99 + $2 if ≥32pg + $1 if cover_score≥90 + $1 if original character bible → round to .99.

## Memories
- [Kids cover prompt template](mem://design/kids-cover-prompt) — Custom illustrated logo prompt formula (3-layer: illustration + title-logo + composition), with letter-decoration idea bank and Barnaby worked example
- [Barnaby review scores](mem://features/barnaby-review) — User content review scores for reference on future books
