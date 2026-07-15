# Illustration System

## Visual bible

Lock these fields before page generation:
- art direction name
- medium and texture
- line quality
- shape language
- palette with 5-8 dominant colors
- lighting rules
- environment design
- character proportions
- facial-expression range
- clothing and prop invariants
- scale chart
- prohibited visual traits

## Character sheet

For every recurring character define:
- name and role
- species/age/body type
- head, eyes, nose, mouth, ears/hair
- body proportions
- clothing and exact colors
- signature prop
- posture and movement style
- expression set: neutral, happy, worried, surprised, determined, sleepy
- front, 3/4, side, and back views
- immutable details

## Page prompt template

Use this order:

1. Book and style anchor.
2. Character invariants.
3. Exact scene action.
4. Emotion and relationship.
5. Setting and continuity props.
6. Composition and camera distance.
7. Lighting and palette.
8. Text-safe area.
9. Print-safe constraints.
10. Negative constraints.

Example structure:

"Original children's picture-book illustration, [medium/style anchor]. [Character invariants]. Scene: [single clear action]. Emotion: [expression/body language]. Setting: [specific environment and continuity details]. Composition: [wide/medium/close], focal point [x], text-safe negative space [location]. Lighting [x], palette [x]. Keep faces, hands, and key props away from gutter and trim. No words, no lettering, no watermark, no extra limbs, no costume changes, no duplicated characters, no photorealism unless requested."

## Consistency ledger

Track per page:
- character present
- clothing
- carried objects
- object location
- time of day
- weather
- light direction
- emotional state
- damage or changes to props
- environmental geography

Never generate a page that contradicts the ledger.

## Cover system

The cover must communicate at thumbnail size:
- one clear focal character
- one emotional promise
- one visual mystery or action
- readable title zone
- genre-appropriate palette
- no crowded background

Create three distinct cover concepts:
1. Character-led emotional cover.
2. Action or adventure cover.
3. Symbolic or atmospheric cover.

Score each on thumbnail clarity, title readability, age fit, originality, emotional appeal, and series branding.

## Cover prompt rules

- Do not render the final title unless the image system reliably handles typography; create clean title space.
- Keep focal elements inside the safe zone.
- Avoid small details that disappear as a marketplace thumbnail.
- Make front and back cover palette compatible.
- Reserve barcode space on the lower back cover when print publishing is intended.

## Production safety

- Use 300 DPI equivalent source images at final trim size.
- Add bleed according to the chosen printer/platform.
- Keep text and faces inside safe margins.
- Check spreads for gutter loss.
- Export illustration-only masters and typeset pages separately.
- Do not upscale low-resolution art as a substitute for creating adequate source resolution.
