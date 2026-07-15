# Illustrated Book Contract

## Required bibles

Persist before illustration:

- Story Bible: premise, age, reading level, arc, theme, world, chronology.
- Character Bible: immutable physical traits, silhouette, costume, props, personality, forbidden variations.
- Character Reference Sheet: front, side, three-quarter, back, expressions, scale, palette.
- Style Bible: line weight, coloring method, texture, lighting, shading, background detail, palette.
- Prop/Location Bible: recurring objects and locations with versioned references.
- Page Plan: canonical page number, text, event, characters, action, emotion, props, setting, before/after state.

## Cover-to-interior lock

The approved cover and character references establish canonical identity. Interior pages must not redesign the character. Compare every page to the reference and adjacent pages.

Require consistency in:

- face geometry;
- eye shape and highlights;
- body proportions and apparent age;
- fur/skin/hair palette;
- costume and accessories;
- recurring props;
- line art, coloring, shading, texture, and world style.

## Textless illustration policy

Ask image models for illustration only. Do not generate story text, title lettering, speech bubbles, labels, signatures, URLs, or watermarks in the raster image. Place approved text with HTML/CSS/SVG or another controlled text layer.

Regenerate an image containing unapproved text; do not merely crop it.

## Semantic page contract

Each page declares:

- required characters;
- required action and emotion;
- required props and setting;
- forbidden objects;
- continuity state before and after.

Generic portraits cannot pass action scenes. A mentioned supporting character or critical prop must appear when visually required.

## Chronology

Events must be ordered by the canonical page plan, never by asset creation time. Validate previous/next event IDs, problem state, prop state, emotional progression, climax, resolution, and ending.

## Repair behavior

Regenerate only the failed illustration when references and story are valid. Never modify the canonical reference to make a drifted page appear compliant.
