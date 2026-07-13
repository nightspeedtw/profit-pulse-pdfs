# Project Memory

## Core
Kids picture books: 32 pages standard, 8.5×8.5", watercolor+ink storybook style, character invariants locked per page.
Kids cover workflow (TWO PASS): Pass 1 = generate soft watercolor storybook base illustration ONLY (atmospheric, cozy, painterly, uncrowded — v2 direction, never busy). Pass 2 = use imagegen--edit_image to overlay a custom illustrated title LOGO (Peppa Pig / Bluey / Paddington / Gruffalo tier) painted in the same medium, every letter uniquely hand-drawn with story-linked decoration (vines/berries/leaves/ears/stars), emotion words visually distort (Wobbly=wavy, Sleepy=droops, Zoom=streaks). NEVER bake the title into pass 1. NEVER an existing font, NEVER hand-drawn fonts, NEVER flat text overlay.
Kids covers storefront display: after shipping the finished cover to ebooks.cover_url, ALSO set ebooks.store_thumbnail_url = the same cover URL. Do NOT run generate-store-thumbnail for kids picture books — that function ignores cover_url and produces a generic template mockup (yellow book, stars, "ILLUSTRATED STORY" badge) that replaces the beautiful hand-painted cover on the storefront.
User does not use Shopify anymore — skip all shopify- steps, publish natively via storefront + Stripe.
Auto-price kids picture book: base $6.99 + $2 if ≥32pg + $1 if cover_score≥90 + $1 if original character bible → round to .99.

## Memories
- [Kids cover prompt template](mem://design/kids-cover-prompt) — Custom illustrated logo prompt formula (3-layer: illustration + title-logo + composition), with letter-decoration idea bank and Barnaby worked example
- [Barnaby review scores](mem://features/barnaby-review) — User content review scores for reference on future books
