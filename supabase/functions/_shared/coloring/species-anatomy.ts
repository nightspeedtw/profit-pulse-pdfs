// SPECIES_ANATOMY_SKILL v1 — deterministic anatomical spec per allowed_subject.
// Owner mandate ("สัตว์ผิดสัดส่วน ห้ามมีผิดอีกตลอดไป"): every interior page
// must be generated with a positive anatomical checklist injected into the
// prompt AND verified against that same checklist by vision at birth.
//
// Extend this table as new categories go live. Unknown subjects fall back to
// GENERIC_ANATOMY (no crash) but their pages are flagged so QA can add the
// species spec before the class is closed.

export interface SpeciesAnatomy {
  species_key: string;               // canonical lowercase key, matches allowed_subjects
  aliases: string[];                 // spellings the LLM may use
  body_parts: Record<string, string>;// part -> "exact count/shape/attachment rule"
  proportion_rules: string[];
  common_ai_failure_modes: string[];
  /**
   * Owner law "anatomy_imagination_vs_deformity" (2026-07-16):
   * true = this is a canonical FANTASY creature. Its own anatomy is judged
   * by the fantasy canon (unicorn: one horn; mermaid: torso+fish tail).
   * A fantasy creature PASSES in any scene when the page plan's subject IS
   * this creature, and specifically in fantasy-flagged categories.
   */
  fantasy?: boolean;
}

const s = (o: SpeciesAnatomy): SpeciesAnatomy => o;

/**
 * Category keys where uninvited fantasy additions on a REAL species are
 * still out-of-spec (a sea_animals dolphin doesn't sprout a horn), but the
 * category itself hosts fantasy creatures whose canonical form is passable.
 * Extend as fantasy categories are queued.
 */
export const FANTASY_CATEGORY_KEYS = new Set<string>([
  "cute_mermaid_and_ocean_fantasy",
  "mermaid",
  "fantasy",
  "princess_and_fantasy",
  "unicorn_and_rainbow",
  "unicorn",
  "dragons_and_castles",
  "fairy_garden",
]);

export function isFantasyCategoryKey(key?: string | null): boolean {
  if (!key) return false;
  const k = String(key).toLowerCase().trim();
  if (FANTASY_CATEGORY_KEYS.has(k)) return true;
  return /(fantasy|mermaid|unicorn|dragon|fairy|princess)/i.test(k);
}

// NOTE: keep body_parts values short — they are concatenated into prompts.
export const SPECIES_ANATOMY: SpeciesAnatomy[] = [
  s({
    species_key: "dolphin",
    aliases: ["dolphin", "bottlenose dolphin", "porpoise"],
    body_parts: {
      body: "streamlined torpedo body, smooth continuous curve from rostrum to tail",
      dorsal_fin: "exactly ONE dorsal fin on the back, curved backward",
      pectoral_fins: "exactly TWO pectoral (side) fins, one per side, small paddle shape",
      tail: "HORIZONTAL two-lobed tail flukes (never vertical, never mermaid fin, never split into a Y-tail)",
      blowhole: "single blowhole on top of head",
      eye: "one small round eye visible in profile (cute stylization such as eyelashes, sparkles, or big pupils is allowed)",
      mouth: "long narrow rostrum with subtle smile line, no teeth shown",
    },
    proportion_rules: [
      "body length roughly 6-8x body height",
      "tail flukes span roughly 1x body height, oriented horizontally",
      "no legs, no arms, no fingers",
    ],
    common_ai_failure_modes: [
      "vertical mermaid-style tail fin",
      "split Y-shaped tail",
      "extra dorsal fins or fins on belly",
      "grotesque proportions that read as injured or disabled",
    ],
  }),
  s({
    species_key: "fish",
    aliases: ["fish", "tropical fish", "reef fish", "goldfish"],
    body_parts: {
      body: "oval or teardrop body, symmetric top-to-bottom around the spine",
      dorsal_fin: "one continuous dorsal fin along the top (may be segmented)",
      pectoral_fins: "TWO paired pectoral fins (one per side) roughly behind gills",
      pelvic_fins: "TWO small pelvic fins on the underside",
      anal_fin: "one anal fin on the underside near the tail",
      tail_fin: "tail (caudal) fin attached at the peduncle at the rear",
      mouth: "small fish mouth at the very front (NO bird beak, NO lips)",
      eye: "one round eye visible in profile",
      gill: "one gill slit behind the eye",
    },
    proportion_rules: [
      "body height <= 1.5x body length (pufferfish is the only round exception)",
      "paired fins are symmetric left/right",
      "no balloon body, no legs, no arms",
    ],
    common_ai_failure_modes: [
      "balloon/spherical body",
      "beak-like mouth or duck bill",
      "leaf-shaped or plant-like fins",
      "asymmetric or missing paired fins",
    ],
  }),
  s({
    species_key: "whale",
    aliases: ["whale", "humpback whale", "blue whale", "orca", "killer whale"],
    body_parts: {
      body: "long streamlined body, wider at head, tapering to tail",
      dorsal_fin: "small dorsal fin on back (or a low ridge for some species)",
      pectoral_fins: "TWO long pectoral fins/flippers",
      tail: "HORIZONTAL two-lobed tail flukes, notch in the middle",
      blowhole: "one or two blowholes on top of head",
      eye: "one small eye low on the side of the head",
      mouth: "wide mouth line along the head",
    },
    proportion_rules: [
      "flippers roughly 1/4 body length or less",
      "horizontal flukes, never vertical",
    ],
    common_ai_failure_modes: ["vertical tail fin", "shark-like body", "extra fins"],
  }),
  s({
    species_key: "shark",
    aliases: ["shark", "great white", "hammerhead"],
    body_parts: {
      body: "streamlined torpedo body",
      dorsal_fin: "one prominent triangular dorsal fin, optional smaller second dorsal",
      pectoral_fins: "TWO large pectoral fins",
      tail: "VERTICAL caudal fin with upper lobe longer than lower lobe",
      gills: "5 gill slits on the side behind the eye",
      mouth: "crescent mouth on underside of head",
      eye: "one round eye on the side of the head",
    },
    proportion_rules: ["no horizontal flukes (that would be a whale/dolphin)"],
    common_ai_failure_modes: ["dolphin-style horizontal flukes", "extra dorsal fins along the back"],
  }),
  s({
    species_key: "octopus",
    aliases: ["octopus"],
    body_parts: {
      head: "rounded bulbous mantle (head)",
      arms: "EXACTLY EIGHT arms radiating from the head, each tapering, with suction cups on the underside",
      eyes: "TWO eyes on the head",
    },
    proportion_rules: ["arm count = 8 (never 6, 7, 9, or 10)", "no bones, arms curl smoothly"],
    common_ai_failure_modes: ["wrong arm count", "arms fused into a skirt", "extra eyes"],
  }),
  s({
    species_key: "seahorse",
    aliases: ["seahorse", "sea horse"],
    body_parts: {
      head: "horse-like head bent at ~90° to the body, tubular snout",
      body: "upright ridged body with belly plates",
      dorsal_fin: "one small fan-shaped dorsal fin on the back",
      pectoral_fins: "TWO tiny pectoral fins near the head",
      tail: "prehensile curled tail, no fin at the end",
      eye: "one small round eye on the side",
    },
    proportion_rules: ["upright posture", "tail curls forward, never a fish-like caudal fin"],
    common_ai_failure_modes: ["fish tail at end", "extra fins", "horizontal fish-like body"],
  }),
  s({
    species_key: "starfish",
    aliases: ["starfish", "sea star"],
    body_parts: {
      arms: "EXACTLY FIVE arms radiating symmetrically from a central disc (species with more arms are rare — default to 5)",
      surface: "textured upper surface, tube feet on underside (not visible from top)",
    },
    proportion_rules: ["radial symmetry, arms equal length"],
    common_ai_failure_modes: ["wrong arm count", "arms of unequal length", "eyes/face added"],
  }),
  s({
    species_key: "jellyfish",
    aliases: ["jellyfish", "jelly"],
    body_parts: {
      bell: "dome-shaped translucent bell",
      tentacles: "many long thin trailing tentacles below the bell (not legs, not arms)",
      oral_arms: "shorter frilly oral arms in the middle underside",
    },
    proportion_rules: ["tentacles hang downward, wavy", "no eyes, no face"],
    common_ai_failure_modes: ["cartoon face on the bell", "tentacles becoming legs/arms"],
  }),
  s({
    species_key: "sea turtle",
    aliases: ["sea turtle", "turtle"],
    body_parts: {
      shell: "one oval carapace on the back, patterned with plates (scutes)",
      flippers: "FOUR flippers (two large front, two smaller rear) — never legs with feet",
      head: "small head with a beak-like mouth, extending from the front of the shell",
      eyes: "TWO eyes",
      tail: "short pointed tail behind the shell",
    },
    proportion_rules: ["flipper-shape limbs, not paws"],
    common_ai_failure_modes: ["land-tortoise legs with toes", "wrong shell shape", "extra limbs"],
  }),
  s({
    species_key: "narwhal",
    aliases: ["narwhal"],
    body_parts: {
      body: "streamlined whale-like body",
      tusk: "ONE straight spiral tusk projecting forward from the upper jaw (males); may be absent (females)",
      pectoral_fins: "TWO pectoral flippers",
      tail: "HORIZONTAL two-lobed tail flukes",
      dorsal_ridge: "low dorsal ridge (NO tall dorsal fin)",
      blowhole: "one blowhole on top of head",
      eye: "one small eye on the side",
    },
    proportion_rules: ["single tusk only", "horizontal flukes"],
    common_ai_failure_modes: ["multiple tusks", "unicorn horn on forehead instead of jaw", "vertical tail"],
  }),
  s({
    species_key: "crab",
    aliases: ["crab"],
    body_parts: {
      body: "wide flat carapace (shell)",
      claws: "TWO front claws (chelipeds)",
      legs: "EIGHT walking legs (four per side) in addition to the two claws — total ten appendages",
      eyes: "TWO stalked eyes on top of the carapace",
    },
    proportion_rules: ["10 appendages total (2 claws + 8 legs)"],
    common_ai_failure_modes: ["wrong leg count", "extra claws"],
  }),
  s({
    species_key: "clownfish",
    aliases: ["clownfish", "clown fish", "anemonefish"],
    body_parts: {
      body: "oval fish body with THREE white vertical bands on orange (classic Ocellaris pattern)",
      dorsal_fin: "one continuous dorsal fin with a small notch",
      pectoral_fins: "TWO paired pectoral fins",
      pelvic_fins: "TWO pelvic fins",
      tail_fin: "rounded tail fin",
      mouth: "small fish mouth at the front (no beak)",
      eye: "one round eye on the side",
    },
    proportion_rules: ["three white bands (head, mid, tail-base) outlined in black"],
    common_ai_failure_modes: ["wrong band count", "beak mouth", "leaf-shaped fins"],
  }),
  // ── FANTASY CREATURES (owner law anatomy_imagination_vs_deformity) ─
  // Judged by their canonical fantasy anatomy, not by real biology.
  s({
    species_key: "mermaid",
    aliases: ["mermaid", "merfolk", "merboy", "mergirl", "merman", "merchild"],
    body_parts: {
      upper_body: "ONE human upper torso (head, two arms, two hands with FIVE fingers each, one head with two eyes)",
      lower_body: "ONE fish-like tail replacing the legs, ending in ONE horizontal fluke or ONE fanned caudal fin",
      hair: "flowing hair (any length)",
      eyes: "two eyes on the face (cute stylization welcome — big eyes, eyelashes, sparkles)",
    },
    proportion_rules: [
      "exactly one human torso attached seamlessly to exactly one fish tail",
      "no legs; no second tail; five fingers per hand",
    ],
    common_ai_failure_modes: [
      "legs AND a fish tail on the same body",
      "two fish tails",
      "extra arms or extra hands",
      "wrong finger count (six fingers, fused fingers)",
    ],
    fantasy: true,
  }),
  s({
    species_key: "unicorn",
    aliases: ["unicorn", "baby unicorn", "unicorn foal"],
    body_parts: {
      body: "one horse-like body with four legs and one tail",
      horn: "EXACTLY ONE straight or spiral horn projecting from the CENTER of the forehead",
      mane: "flowing mane along the neck",
      tail: "one flowing tail",
      hooves: "four hooves, one per leg",
      eyes: "two eyes on the face (cute stylization welcome)",
    },
    proportion_rules: [
      "exactly one horn (never two, never zero)",
      "four legs (never three, never five)",
      "no wings unless the subject is specifically 'winged unicorn' / 'alicorn'",
    ],
    common_ai_failure_modes: [
      "two horns",
      "horn on the nose instead of the forehead",
      "five legs / three legs",
      "extra tails",
    ],
    fantasy: true,
  }),
  s({
    species_key: "pegasus",
    aliases: ["pegasus", "winged horse", "alicorn"],
    body_parts: {
      body: "one horse-like body with four legs and one tail",
      wings: "EXACTLY TWO feathered wings, one on each side of the back",
      mane: "flowing mane",
      tail: "one flowing tail",
      hooves: "four hooves",
    },
    proportion_rules: ["four legs + two wings; alicorn adds exactly one forehead horn"],
    common_ai_failure_modes: ["one wing only", "four wings", "extra legs"],
    fantasy: true,
  }),
  s({
    species_key: "dragon",
    aliases: ["dragon", "baby dragon", "cute dragon"],
    body_parts: {
      body: "one reptilian body with four legs and one tail",
      wings: "TWO bat-like wings on the back (may be omitted for wingless/eastern dragons — declare in the plan)",
      head: "one head with two eyes and often small horns",
      tail: "one tail",
    },
    proportion_rules: ["one head; four legs; symmetric wing count (0 or 2)"],
    common_ai_failure_modes: [
      "one wing only",
      "extra heads (unless subject is specifically 'hydra')",
      "five legs / three legs",
    ],
    fantasy: true,
  }),
  s({
    species_key: "fairy",
    aliases: ["fairy", "pixie", "sprite"],
    body_parts: {
      body: "one human-shaped body (child or adult proportion)",
      wings: "EXACTLY TWO wings (insect- or butterfly-style) on the back",
      hands: "two hands with FIVE fingers each",
      face: "two eyes; cute stylization welcome",
    },
    proportion_rules: ["one body; two wings; five fingers per hand"],
    common_ai_failure_modes: [
      "one wing only",
      "four arms",
      "wrong finger count",
    ],
    fantasy: true,
  }),
  // ── MYTHICAL / DIVINE BEINGS (owner law anatomy_deformity_only_v2) ─
  // Judged by canonical imaginative form. Multi-heads/arms/tails/wings
  // are CANONICAL for these — never a deformity.
  s({
    species_key: "phoenix",
    aliases: ["phoenix", "firebird"],
    body_parts: {
      body: "one bird body, one head, two legs",
      wings: "TWO large flaming/feathered wings",
      tail: "one long ornate tail plume (may be split into flame-like streamers)",
      head: "one head with two eyes and a beak",
    },
    proportion_rules: ["one body, one head, two wings, two legs — flames/plumage may be elaborate"],
    common_ai_failure_modes: ["extra heads on a phoenix (that would be a different creature)", "one wing only"],
    fantasy: true,
  }),
  s({
    species_key: "naga",
    aliases: ["naga", "nak", "serpent deity"],
    body_parts: {
      head: "one or multiple hooded serpent heads (1, 3, 5, 7, or 9 heads are ALL canonical)",
      body: "one long serpent body, coiled or extended",
      hood: "cobra-like hood behind each head",
    },
    proportion_rules: [
      "multi-headed forms are CANONICAL — do not flag as deformity",
      "one continuous serpent body per naga",
    ],
    common_ai_failure_modes: ["severed or floating heads", "broken body segments"],
    fantasy: true,
  }),
  s({
    species_key: "garuda",
    aliases: ["garuda", "krut"],
    body_parts: {
      upper_body: "human-like torso with two arms",
      wings: "TWO large bird wings",
      head: "eagle/bird head with beak (or human head with bird features)",
      lower_body: "bird legs with talons, feathered tail",
    },
    proportion_rules: ["hybrid human-bird form is canonical"],
    common_ai_failure_modes: ["extra arms unless invoked as a specific canonical variant", "one wing only"],
    fantasy: true,
  }),
  s({
    species_key: "kinnari",
    aliases: ["kinnari", "kinnara", "kinnaree"],
    body_parts: {
      upper_body: "human upper body (head, two arms with five fingers each)",
      lower_body: "bird lower body with legs, feathered tail",
      wings: "TWO wings",
    },
    proportion_rules: ["half-human upper + half-bird lower is canonical"],
    common_ai_failure_modes: ["one wing only", "extra arms"],
    fantasy: true,
  }),
  s({
    species_key: "erawan",
    aliases: ["erawan", "airavata", "three-headed elephant", "multi-headed elephant"],
    body_parts: {
      heads: "MULTIPLE elephant heads (1, 3, 5, 7, 9, up to 33 are all canonical)",
      body: "one elephant body",
      legs: "four legs total (canonical — extra legs would be a deformity)",
      trunk: "one trunk per head, two tusks per head",
    },
    proportion_rules: ["many heads on one body is canonical — never a defect"],
    common_ai_failure_modes: ["extra legs beyond four", "severed heads floating off the body"],
    fantasy: true,
  }),
  s({
    species_key: "nine_tailed_fox",
    aliases: ["nine-tailed fox", "nine tailed fox", "kitsune", "kumiho", "huli jing"],
    body_parts: {
      body: "one fox body with four legs",
      head: "one head with two eyes and two ears",
      tails: "MULTIPLE fluffy tails (1 through 9 are ALL canonical — nine tails is the classic form)",
    },
    proportion_rules: ["4 legs; tail count 1-9 is canonical"],
    common_ai_failure_modes: ["five legs on a fox body", "floating disembodied tails"],
    fantasy: true,
  }),
  s({
    species_key: "kirin",
    aliases: ["kirin", "qilin"],
    body_parts: {
      body: "one deer/horse-like body with four legs and one tail",
      horn: "one or two horns (canonical variants exist for both)",
      scales: "dragon-like scales optional",
    },
    proportion_rules: ["four legs; 1-2 horns"],
    common_ai_failure_modes: ["five legs", "extra tails"],
    fantasy: true,
  }),
  s({
    species_key: "deity",
    aliases: [
      "deity","god","goddess","divine being","hindu deity","buddhist deity",
      "multi-armed deity","four-armed deity","six-armed deity","eight-armed deity",
      "shiva","vishnu","ganesha","durga","kali","avalokiteshvara",
    ],
    body_parts: {
      head: "ONE or MULTIPLE heads (1, 3, 4, 5, 10, or 11 heads are all canonical for various deities)",
      arms: "MULTIPLE arms in iconographic multiples (2, 4, 6, 8, 10, 1000 are ALL canonical) — each arm ends in ONE hand with FIVE fingers",
      body: "one central torso and (usually) two legs",
      attributes: "may hold canonical attributes (lotus, discus, trident, mudra)",
    },
    proportion_rules: [
      "multi-armed and multi-headed forms are CANONICAL iconography — never a deformity",
      "each hand still has five fingers; each arm is intact and attached to a shoulder",
    ],
    common_ai_failure_modes: [
      "hands with 6+ fingers or fused fingers",
      "severed or floating arms",
      "broken / crushed body",
    ],
    fantasy: true,
  }),
  s({
    species_key: "human",
    aliases: ["human", "child", "boy", "girl", "person", "kid", "baby", "toddler"],
    body_parts: {
      head: "one head with two eyes, one nose, one mouth, two ears",
      arms: "TWO arms, each ending in ONE hand with FIVE fingers",
      legs: "TWO legs, each ending in ONE foot with FIVE toes",
      torso: "one torso",
    },
    proportion_rules: [
      "exactly 2 arms + 2 legs; 5 fingers per hand; 5 toes per foot",
      "cartoon-stylized proportions welcome (big head, short body, chibi) — that is NOT deformity",
    ],
    common_ai_failure_modes: [
      "third arm on a human",
      "6+ fingers on one hand",
      "fused fingers",
      "extra leg / missing leg",
      "severed / floating limb",
    ],
    fantasy: false,
  }),
];

const GENERIC_ANATOMY: SpeciesAnatomy = {
  species_key: "__generic__",
  aliases: [],
  body_parts: {
    body: "coherent single body appropriate for the subject",
    limbs: "correct number and placement of limbs/fins/wings for the species",
    face: "coherent face with the correct number of eyes/mouth/nose/ears for the species",
  },
  proportion_rules: ["realistic proportions for the species (cartoon-stylized allowed)"],
  common_ai_failure_modes: ["extra or missing limbs", "fused features", "grotesque proportions"],
};

const NORM = (str: string) => str.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export function getSpeciesAnatomy(subject: string): SpeciesAnatomy {
  const q = NORM(subject);
  for (const spec of SPECIES_ANATOMY) {
    for (const alias of [spec.species_key, ...spec.aliases]) {
      if (q === NORM(alias) || q.includes(NORM(alias))) return spec;
    }
  }
  return GENERIC_ANATOMY;
}

export function hasSpeciesAnatomy(subject: string): boolean {
  return getSpeciesAnatomy(subject).species_key !== "__generic__";
}

/** Positive anatomical clause injected into buildInteriorPrompt. */
export function speciesAnatomyPromptClause(subject: string): string {
  const spec = getSpeciesAnatomy(subject);
  if (spec.species_key === "__generic__") return "";
  const parts = Object.entries(spec.body_parts).map(([k, v]) => `${k}: ${v}`);
  return (
    `Anatomical spec for ${spec.species_key} — MUST match exactly: ${parts.join("; ")}. ` +
    `Proportion rules: ${spec.proportion_rules.join("; ")}. ` +
    `Avoid these known AI failure modes: ${spec.common_ai_failure_modes.join("; ")}.`
  );
}

/** Repair clause that names the exact failure mode class the retry must fix. */
export function speciesAnatomyRepairClause(subject: string, defects: string[]): string {
  const spec = getSpeciesAnatomy(subject);
  const focused = defects.length
    ? `Fix specifically: ${defects.slice(0, 6).join("; ")}`
    : `Fix any of these classes: ${spec.common_ai_failure_modes.join("; ")}`;
  if (spec.species_key === "__generic__") return focused;
  return `${focused}. Re-check ${spec.species_key} spec: ` +
    Object.entries(spec.body_parts).map(([k, v]) => `${k}=${v}`).join(" | ");
}

/** Compact JSON checklist consumed by the anatomy vision verifier. */
export function speciesAnatomyChecklistJson(subject: string): {
  species_key: string;
  body_parts: Record<string, string>;
  proportion_rules: string[];
  common_ai_failure_modes: string[];
} {
  const spec = getSpeciesAnatomy(subject);
  return {
    species_key: spec.species_key,
    body_parts: spec.body_parts,
    proportion_rules: spec.proportion_rules,
    common_ai_failure_modes: spec.common_ai_failure_modes,
  };
}
