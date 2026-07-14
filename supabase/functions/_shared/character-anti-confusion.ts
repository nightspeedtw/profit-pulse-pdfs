// Species-derived anti-confusion clause.
//
// Root cause of the Detective Dot rabbit drift: the image model saw the phrase
// "dust bunny" and generated an actual bunny/rabbit on 6/28 pages. The style
// bible said "Dust Bunny" but nothing in the prompt told the model what a
// dust bunny visually IS *and* what it explicitly is NOT.
//
// This helper generates a short deterministic anti-confusion clause from the
// character's species string. It is injected into every interior page prompt
// and can also be persisted into the character_bible_json for future books.

/**
 * Return an anti-confusion clause for the given species string. Returns an
 * empty string when the species is unambiguous (e.g. "girl", "dog").
 *
 * Heuristics target the highest-risk collisions we have observed in image
 * generators (Gemini + Flux):
 *   - "dust bunny" → drawn as rabbit
 *   - "sea bunny"  → drawn as rabbit
 *   - "cotton ball creature" → drawn as sheep
 *   - "acorn kid"  → drawn as squirrel
 *   - "puddle sprite" → drawn as generic fairy/human
 *   - "bookworm"   → drawn as worm/caterpillar instead of a small reader
 *   - "fog cat"    → drawn as generic cat
 */
export function antiConfusionClause(speciesRaw: string | null | undefined): string {
  const s = String(speciesRaw ?? "").trim().toLowerCase();
  if (!s) return "";

  // Explicit table of known collisions. Each entry says what the character
  // IS (visual description) and what it is NOT (the confusable species).
  const table: Array<{ match: RegExp; is: string; notList: string[] }> = [
    {
      match: /dust\s*bunny/,
      is: "a round fluffy ball of soft gray dust with tiny beady eyes and tiny legs; a household dust clump come alive",
      notList: ["a rabbit", "a bunny animal", "a hare", "any animal with long ears", "any animal with a cottontail"],
    },
    {
      match: /sea\s*bunny/,
      is: "a tiny fluffy white sea slug with two black rhinophores that look like ears",
      notList: ["a rabbit", "a bunny animal", "a land mammal"],
    },
    {
      match: /cotton\s*ball|lint\s*creature|fluff\s*creature/,
      is: "an amorphous soft ball of white/pastel fibers with tiny cartoon eyes",
      notList: ["a sheep", "a lamb", "a rabbit"],
    },
    {
      match: /acorn\s*(kid|child|sprite|folk)/,
      is: "a small acorn with a jaunty cap, tiny arms and legs, a friendly face",
      notList: ["a squirrel", "a chipmunk", "any rodent"],
    },
    {
      match: /puddle\s*sprite|rain\s*sprite|water\s*sprite/,
      is: "a small translucent watery blob with big cartoon eyes and rippling edges",
      notList: ["a fairy with wings", "a human child", "a mermaid"],
    },
    {
      match: /bookworm/,
      is: "a small friendly green worm wearing round reading glasses, curled around a tiny book",
      notList: ["a caterpillar", "a snake", "a regular earthworm without glasses"],
    },
    {
      match: /pocket\s*monster|pocket\s*creature/,
      is: "a small original storybook creature (not a Pokémon)",
      notList: ["Pikachu", "any Pokémon", "any copyrighted mascot"],
    },
    {
      match: /moss\s*(kid|child|sprite|folk|elf)/,
      is: "a small green mossy figure with leafy tufts on its head and root-like feet",
      notList: ["a frog", "a turtle", "a normal human child"],
    },
    {
      match: /cloud\s*(kid|child|sprite|folk)/,
      is: "a small fluffy cloud with a friendly face and tiny arms/legs",
      notList: ["a sheep", "a lamb", "a bird"],
    },
    {
      match: /sock\s*(monster|puppet|creature)/,
      is: "a soft striped sock brought to life with button eyes and a stitched smile",
      notList: ["a snake", "a caterpillar"],
    },
    {
      match: /crumb\s*(kid|creature|fairy)/,
      is: "a tiny bread-crumb figure with a golden crust face and tiny arms",
      notList: ["a mouse", "an ant", "a beetle"],
    },
  ];

  for (const row of table) {
    if (row.match.test(s)) {
      return `IMPORTANT — the hero is ${row.is}. The hero is NOT ${row.notList.join(", NOT ")}. Do not draw any of those confusable species; if unsure, err toward the described form.`;
    }
  }

  // No known collision — return empty; the general character description is sufficient.
  return "";
}

/**
 * Build a hardened character description by appending the anti-confusion
 * clause to the base description string. Safe no-op if no clause applies.
 */
export function hardenCharacterDescription(baseDescription: string, species: string | null | undefined): string {
  const clause = antiConfusionClause(species);
  if (!clause) return baseDescription;
  return `${baseDescription}. ${clause}`;
}
