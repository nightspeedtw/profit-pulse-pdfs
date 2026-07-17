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

  // ── LAND MAMMALS · QUADRUPEDS ──────────────────────────────────────
  // Owner mandate (2026-07-17, chimera/extra-limb defect): every real
  // quadruped must state EXACTLY FOUR LEGS, no fusion, no duplication,
  // ONE head, ONE tail. This is the single most common AI failure class
  // ("5-legged puppy", "two-headed bear", fused-hip fox).
  s({
    species_key: "dog",
    aliases: ["dog", "dogs", "puppy", "puppies", "pup", "doggo"],
    body_parts: {
      body: "one canine body",
      head: "ONE head with TWO eyes, TWO ears, ONE nose, ONE mouth",
      legs: "EXACTLY FOUR legs (front-left, front-right, back-left, back-right), NO fifth leg, NO fused hips, NO duplicated leg",
      paws: "one paw per leg, four paws total",
      tail: "EXACTLY ONE tail",
    },
    proportion_rules: ["4 legs, 1 head, 1 tail — never 3, never 5, never fused"],
    common_ai_failure_modes: [
      "five or six legs on a dog",
      "extra head or two-headed dog",
      "two tails",
      "duplicated / fused front leg",
      "extra paw floating from body",
    ],
  }),
  s({
    species_key: "cat",
    aliases: ["cat", "cats", "kitten", "kittens", "kitty", "black cat"],
    body_parts: {
      body: "one feline body",
      head: "ONE head with TWO eyes, TWO pointed ears, ONE nose, ONE mouth with whiskers",
      legs: "EXACTLY FOUR legs, NO fifth leg, NO fused hips",
      paws: "one paw per leg, four paws total",
      tail: "EXACTLY ONE tail",
    },
    proportion_rules: ["4 legs, 1 head, 1 tail"],
    common_ai_failure_modes: ["5+ legs", "extra head", "two tails", "fused legs"],
  }),
  s({
    species_key: "rabbit",
    aliases: ["rabbit", "rabbits", "bunny", "bunnies", "hare"],
    body_parts: {
      body: "one rabbit body",
      head: "ONE head with TWO eyes, TWO long ears, ONE nose",
      legs: "EXACTLY FOUR legs (2 short front, 2 large hind)",
      tail: "EXACTLY ONE small round tail",
    },
    proportion_rules: ["4 legs, 2 ears, 1 tail — hind legs larger than front"],
    common_ai_failure_modes: ["5+ legs", "one ear only", "three ears", "extra tail"],
  }),
  s({
    species_key: "bear",
    aliases: ["bear", "bears", "teddy bear", "cub", "polar bear", "grizzly"],
    body_parts: {
      body: "one bear body",
      head: "ONE head with TWO eyes, TWO round ears, ONE nose",
      legs: "EXACTLY FOUR legs",
      paws: "one paw per leg, four paws total",
      tail: "one very small tail (or none visible)",
    },
    proportion_rules: ["4 legs, 1 head, 2 ears"],
    common_ai_failure_modes: ["5+ legs", "extra head", "duplicated paws"],
  }),
  s({
    species_key: "fox",
    aliases: ["fox", "foxes"],
    body_parts: {
      body: "one fox body",
      head: "ONE head with TWO eyes, TWO pointed ears, ONE pointed snout",
      legs: "EXACTLY FOUR legs",
      tail: "EXACTLY ONE bushy tail",
    },
    proportion_rules: ["4 legs, 1 head, 1 tail (single bushy)"],
    common_ai_failure_modes: [
      "5+ legs",
      "multiple tails (that would be a nine-tailed fox, not a real fox)",
      "extra ears",
    ],
  }),
  s({
    species_key: "squirrel",
    aliases: ["squirrel", "squirrels", "chipmunk"],
    body_parts: {
      body: "one squirrel body",
      head: "ONE head with TWO eyes, TWO round ears",
      legs: "EXACTLY FOUR legs",
      tail: "ONE large bushy tail curled behind",
    },
    proportion_rules: ["4 legs, 1 tail"],
    common_ai_failure_modes: ["5+ legs", "two tails", "extra head"],
  }),
  s({
    species_key: "deer",
    aliases: ["deer", "fawn", "doe", "stag", "reindeer"],
    body_parts: {
      body: "one deer body",
      head: "ONE head with TWO eyes, TWO ears, optional antlers (0 or 2 symmetric)",
      legs: "EXACTLY FOUR long thin legs",
      tail: "ONE small tail",
    },
    proportion_rules: ["4 legs, symmetric antlers if present"],
    common_ai_failure_modes: ["5+ legs", "single antler", "asymmetric antlers"],
  }),
  s({
    species_key: "raccoon",
    aliases: ["raccoon"],
    body_parts: {
      body: "one raccoon body with masked face",
      head: "ONE head with TWO eyes (with black mask), TWO ears",
      legs: "EXACTLY FOUR legs",
      tail: "ONE ringed tail",
    },
    proportion_rules: ["4 legs, 1 ringed tail"],
    common_ai_failure_modes: ["5+ legs", "two tails"],
  }),
  s({
    species_key: "hedgehog",
    aliases: ["hedgehog"],
    body_parts: {
      body: "one round body covered in spines on the back",
      head: "ONE head with TWO eyes, TWO small ears, ONE snout",
      legs: "EXACTLY FOUR short legs",
      tail: "very small tail (or none)",
    },
    proportion_rules: ["4 legs"],
    common_ai_failure_modes: ["5+ legs", "spines on the belly"],
  }),
  s({
    species_key: "owl",
    aliases: ["owl", "owls", "owlet"],
    body_parts: {
      body: "one round bird body with feathers",
      head: "ONE head with TWO large forward-facing eyes, TWO ear tufts (or none)",
      wings: "EXACTLY TWO wings, one per side",
      legs: "EXACTLY TWO legs ending in talons",
      tail: "one short tail",
      beak: "one small hooked beak",
    },
    proportion_rules: ["2 wings, 2 legs, 1 head — no arms, no extra wings"],
    common_ai_failure_modes: ["one wing only", "four wings", "three legs", "two heads"],
  }),

  // ── FARM ANIMALS ───────────────────────────────────────────────────
  s({
    species_key: "cow",
    aliases: ["cow", "cows", "calf", "bull", "cattle"],
    body_parts: {
      body: "one cow body",
      head: "ONE head with TWO eyes, TWO ears, TWO horns (or none for hornless breeds)",
      legs: "EXACTLY FOUR legs ending in hooves",
      tail: "ONE tail with tuft at the end",
      udder: "one udder on the belly (adult female only)",
    },
    proportion_rules: ["4 legs, 1 head, 1 tail; horns 0 or 2 symmetric"],
    common_ai_failure_modes: ["5+ legs", "single horn", "asymmetric horns", "two heads"],
  }),
  s({
    species_key: "pig",
    aliases: ["pig", "pigs", "piglet", "hog"],
    body_parts: {
      body: "one round pig body",
      head: "ONE head with TWO eyes, TWO floppy ears, ONE flat snout",
      legs: "EXACTLY FOUR legs with cloven hooves",
      tail: "ONE curly tail",
    },
    proportion_rules: ["4 legs, 1 curly tail"],
    common_ai_failure_modes: ["5+ legs", "two snouts", "two tails"],
  }),
  s({
    species_key: "sheep",
    aliases: ["sheep", "lamb", "ewe", "ram"],
    body_parts: {
      body: "one wooly body",
      head: "ONE head with TWO eyes, TWO ears, optional curled horns (0 or 2)",
      legs: "EXACTLY FOUR legs",
      tail: "ONE short tail",
    },
    proportion_rules: ["4 legs; horns 0 or 2"],
    common_ai_failure_modes: ["5+ legs", "single horn"],
  }),
  s({
    species_key: "goat",
    aliases: ["goat", "goats", "kid goat"],
    body_parts: {
      body: "one goat body",
      head: "ONE head with TWO eyes, TWO ears, TWO horns (or none)",
      legs: "EXACTLY FOUR legs ending in cloven hooves",
      tail: "ONE short upright tail",
    },
    proportion_rules: ["4 legs; horns 0 or 2 symmetric"],
    common_ai_failure_modes: ["5+ legs", "single horn"],
  }),
  s({
    species_key: "chicken",
    aliases: ["chicken", "hen", "rooster", "chick", "poultry"],
    body_parts: {
      body: "one round bird body with feathers",
      head: "ONE head with TWO eyes, ONE beak, ONE red comb on top, ONE wattle under beak (or none for chicks)",
      wings: "EXACTLY TWO wings",
      legs: "EXACTLY TWO legs ending in three-toed feet",
      tail: "one tail of curved feathers (larger on roosters)",
    },
    proportion_rules: ["2 legs, 2 wings — never 4 legs, never 3 wings"],
    common_ai_failure_modes: [
      "four legs on a chicken",
      "one wing only",
      "two beaks",
      "two heads",
    ],
  }),
  s({
    species_key: "duck",
    aliases: ["duck", "ducks", "duckling"],
    body_parts: {
      body: "one duck body",
      head: "ONE head with TWO eyes, ONE flat beak",
      wings: "EXACTLY TWO wings",
      legs: "EXACTLY TWO webbed feet",
      tail: "one small tail",
    },
    proportion_rules: ["2 wings, 2 legs — bird body plan"],
    common_ai_failure_modes: ["4 legs on a duck", "one wing", "two heads"],
  }),
  s({
    species_key: "horse",
    aliases: ["horse", "horses", "pony", "foal", "colt", "mare", "stallion"],
    body_parts: {
      body: "one horse body",
      head: "ONE head with TWO eyes, TWO ears, ONE nose",
      legs: "EXACTLY FOUR legs ending in ONE hoof each",
      mane: "one flowing mane",
      tail: "EXACTLY ONE flowing tail",
    },
    proportion_rules: ["4 legs, 1 head, 1 tail — never 3 or 5 legs"],
    common_ai_failure_modes: ["5+ legs", "extra head", "two tails"],
  }),
  s({
    species_key: "donkey",
    aliases: ["donkey", "burro", "mule"],
    body_parts: {
      body: "one donkey body",
      head: "ONE head with TWO eyes, TWO long ears",
      legs: "EXACTLY FOUR legs",
      tail: "one tail with tuft",
    },
    proportion_rules: ["4 legs, 2 long ears"],
    common_ai_failure_modes: ["5+ legs", "one ear only"],
  }),

  // ── WILD SAFARI ────────────────────────────────────────────────────
  s({
    species_key: "elephant",
    aliases: ["elephant", "elephants", "baby elephant"],
    body_parts: {
      body: "one large elephant body",
      head: "ONE head with TWO eyes, TWO large ears, ONE trunk, TWO tusks (or none for young/female)",
      legs: "EXACTLY FOUR thick legs — never more, never fused",
      tail: "ONE tail with tuft",
      trunk: "EXACTLY ONE trunk from the front of the head",
    },
    proportion_rules: ["4 legs, 1 trunk, 1 head — multi-headed variants are the erawan fantasy creature, not a real elephant"],
    common_ai_failure_modes: [
      "5+ legs",
      "two trunks",
      "extra head on a real elephant (that would be erawan/airavata)",
      "single tusk with visible asymmetry",
    ],
  }),
  s({
    species_key: "lion",
    aliases: ["lion", "lions", "lioness", "lion cub"],
    body_parts: {
      body: "one feline body",
      head: "ONE head with TWO eyes, TWO round ears; adult males have a mane surrounding the head",
      legs: "EXACTLY FOUR legs",
      tail: "ONE tail with tuft at end",
    },
    proportion_rules: ["4 legs, 1 head, 1 tail"],
    common_ai_failure_modes: ["5+ legs", "extra tails", "two heads"],
  }),
  s({
    species_key: "tiger",
    aliases: ["tiger", "tigers", "tiger cub"],
    body_parts: {
      body: "one striped feline body",
      head: "ONE head with TWO eyes, TWO round ears",
      legs: "EXACTLY FOUR legs",
      tail: "ONE striped tail",
    },
    proportion_rules: ["4 legs, symmetric stripe pattern"],
    common_ai_failure_modes: ["5+ legs", "extra tails"],
  }),
  s({
    species_key: "giraffe",
    aliases: ["giraffe", "giraffes"],
    body_parts: {
      body: "one long-necked body with patchwork spots",
      head: "ONE head with TWO eyes, TWO ears, TWO short horn-like ossicones",
      neck: "ONE long neck",
      legs: "EXACTLY FOUR long legs",
      tail: "ONE tail with tuft",
    },
    proportion_rules: ["4 legs, 1 neck, 2 ossicones"],
    common_ai_failure_modes: ["5+ legs", "two necks", "one ossicone"],
  }),
  s({
    species_key: "zebra",
    aliases: ["zebra", "zebras"],
    body_parts: {
      body: "one horse-like body with black-and-white stripes",
      head: "ONE head with TWO eyes, TWO ears, ONE mane along the neck",
      legs: "EXACTLY FOUR legs ending in ONE hoof each",
      tail: "ONE tail",
    },
    proportion_rules: ["4 legs, stripes cover body symmetrically"],
    common_ai_failure_modes: ["5+ legs", "two tails"],
  }),
  s({
    species_key: "monkey",
    aliases: ["monkey", "monkeys", "chimp", "gorilla", "ape"],
    body_parts: {
      body: "one primate body",
      head: "ONE head with TWO eyes, TWO ears",
      arms: "EXACTLY TWO arms, each ending in ONE hand with FIVE fingers",
      legs: "EXACTLY TWO legs, each ending in ONE foot",
      tail: "ONE tail (monkeys) or NO tail (apes/gorillas)",
    },
    proportion_rules: ["2 arms + 2 legs; 5 fingers per hand"],
    common_ai_failure_modes: ["extra limbs", "6+ fingers", "two tails"],
  }),

  // ── DINOSAURS ──────────────────────────────────────────────────────
  // Realistic dinosaurs — no chimera legs, no duplicated heads. Fantasy
  // dragon is a separate entry above.
  s({
    species_key: "dinosaur",
    aliases: ["dinosaur", "dinosaurs", "dino", "baby dino", "baby dinos"],
    body_parts: {
      body: "one dinosaur body",
      head: "ONE head with TWO eyes",
      limbs: "correct limb count for the species (bipeds: 2 legs + 2 small arms; quadrupeds: 4 legs) — NEVER 5 legs, NEVER duplicated limb",
      tail: "EXACTLY ONE tail",
    },
    proportion_rules: ["one head, one tail, species-appropriate limb count"],
    common_ai_failure_modes: ["5+ legs", "two heads", "two tails", "fused limbs"],
  }),
  s({
    species_key: "t-rex",
    aliases: ["t-rex", "trex", "tyrannosaurus", "tyrannosaurus rex"],
    body_parts: {
      body: "one bipedal dinosaur body, large head, thick tail",
      head: "ONE large head with TWO eyes, ONE mouth of teeth",
      arms: "EXACTLY TWO small forelimbs, each with TWO or THREE fingers",
      legs: "EXACTLY TWO powerful hind legs",
      tail: "EXACTLY ONE thick tail for balance",
    },
    proportion_rules: ["biped: 2 legs, 2 small arms, 1 head, 1 tail"],
    common_ai_failure_modes: ["four legs on a t-rex", "two heads", "arms as large as legs"],
  }),
  s({
    species_key: "triceratops",
    aliases: ["triceratops"],
    body_parts: {
      body: "one quadruped dinosaur body with bony frill behind the head",
      head: "ONE head with TWO eyes, ONE beak, THREE horns (two long above eyes + one short on nose), ONE bony frill",
      legs: "EXACTLY FOUR legs",
      tail: "EXACTLY ONE tail",
    },
    proportion_rules: ["4 legs, 3 horns, 1 frill, 1 tail"],
    common_ai_failure_modes: ["5+ legs", "wrong horn count (2 or 4)", "two frills"],
  }),
  s({
    species_key: "brachiosaurus",
    aliases: ["brachiosaurus", "long-neck dinosaur", "sauropod"],
    body_parts: {
      body: "one large quadruped body with long neck and long tail",
      head: "ONE small head at the end of the long neck, TWO eyes",
      neck: "ONE long neck",
      legs: "EXACTLY FOUR pillar-like legs",
      tail: "EXACTLY ONE long tail",
    },
    proportion_rules: ["4 legs, 1 neck, 1 head, 1 tail"],
    common_ai_failure_modes: ["5+ legs", "two heads on the neck", "two necks"],
  }),
  s({
    species_key: "stegosaurus",
    aliases: ["stegosaurus"],
    body_parts: {
      body: "one quadruped body with two rows of bony plates along the back",
      head: "ONE small head with TWO eyes",
      legs: "EXACTLY FOUR legs (hind legs taller than front)",
      tail: "EXACTLY ONE tail ending in FOUR bony spikes (thagomizer)",
      plates: "two symmetric rows of upright plates along the spine",
    },
    proportion_rules: ["4 legs, 1 tail with 4 tail-spikes, symmetric back plates"],
    common_ai_failure_modes: ["5+ legs", "asymmetric plates", "wrong spike count"],
  }),

  // ── ADDITIONAL MARINE (round_1 coverage gap) ───────────────────────
  s({
    species_key: "seal",
    aliases: ["seal", "sea lion"],
    body_parts: {
      body: "one streamlined body",
      flippers: "EXACTLY FOUR flippers (2 front, 2 hind) — never legs with paws",
      head: "ONE head with TWO eyes, ONE nose, whiskers",
      tail: "hind flippers form the tail",
    },
    proportion_rules: ["4 flippers, no walking legs"],
    common_ai_failure_modes: ["dog-like legs with paws", "extra flippers"],
  }),
  s({
    species_key: "squid",
    aliases: ["squid"],
    body_parts: {
      head: "one elongated mantle (head)",
      arms: "EIGHT arms + TWO longer tentacles = TEN appendages total",
      eyes: "TWO large eyes",
      fins: "TWO fins on either side of the mantle",
    },
    proportion_rules: ["10 appendages (8 arms + 2 tentacles)"],
    common_ai_failure_modes: ["wrong arm count", "octopus-only 8-arm form"],
  }),
  s({
    species_key: "lobster",
    aliases: ["lobster"],
    body_parts: {
      body: "one segmented body with tail",
      claws: "TWO front claws",
      legs: "EIGHT walking legs",
      antennae: "TWO long antennae",
      eyes: "TWO stalked eyes",
    },
    proportion_rules: ["10 appendages total (2 claws + 8 legs)"],
    common_ai_failure_modes: ["wrong leg count", "extra claws"],
  }),
  s({
    species_key: "manta_ray",
    aliases: ["manta ray", "manta", "stingray", "ray fish"],
    body_parts: {
      body: "one flat diamond-shaped body",
      wings: "TWO large pectoral fin-wings (one per side)",
      tail: "ONE long thin tail",
      head: "one head with two cephalic lobes at the front",
    },
    proportion_rules: ["2 fin-wings, 1 tail — never 4 wings, never 2 tails"],
    common_ai_failure_modes: ["extra tail", "asymmetric wings"],
  }),
  s({
    species_key: "pufferfish",
    aliases: ["pufferfish", "puffer fish", "blowfish"],
    body_parts: {
      body: "one round spiky body",
      dorsal_fin: "one small dorsal fin",
      pectoral_fins: "TWO paired pectoral fins",
      tail_fin: "one tail fin",
      eye: "one large eye on each side",
      mouth: "small mouth at the front",
    },
    proportion_rules: ["spherical body is CANONICAL — not a defect"],
    common_ai_failure_modes: ["extra fins", "duck bill mouth"],
  }),
];

// Non-anatomical subject hints — pattern / object / plant / scene nouns
// that legitimately have no species contract and should be exempt from
// the species-coverage gate. Extend when the concept generator emits new
// non-creature subjects.
export const NON_ANATOMY_SUBJECT_HINTS: string[] = [
  // patterns / art
  "mandala", "zentangle", "pattern", "geometric", "symmetric design", "shape",
  // botanical
  "flower", "bouquet", "leaf", "leaves", "wreath", "botanical", "garden",
  "tree", "trees", "florals", "meadow",
  // objects / props / decor
  "teacup", "tea set", "bookshelf", "spell book", "magic wand", "wand",
  "seashell", "coral", "candle", "lantern", "accessory", "accessories",
  "skull", "moon", "star", "rainbow",
  // scenes / places
  "castle", "castles", "cottage", "cottages", "barn", "barns", "kitchen",
  "reading nook", "cafe corner", "cozy indoor scene", "seasonal comfort",
  "enchanted forest", "coral castle", "savanna", "holiday scene",
  "halloween", "christmas", "easter", "valentine",
  // stylized abstractions
  "big-eyed character", "chunky animal", "large single object", "simple shape",
];

/** true when a subject is a known non-creature scene/object/pattern. */
export function isNonAnatomySubject(subject: string): boolean {
  const q = NORM(subject);
  return NON_ANATOMY_SUBJECT_HINTS.some((h) => q === NORM(h) || q.includes(NORM(h)));
}

/**
 * Coverage gate (owner mandate 2026-07-17): a coloring category may not
 * be enabled for autopilot production if any of its generated subjects is
 * creature-like AND has no matching `species_anatomy` entry. Returns the
 * list of uncovered subjects so the caller can block the run with a
 * precise `species_contract_missing` blocker.
 */
export function assertSpeciesCoverage(subjects: string[]): {
  ok: boolean;
  missing: { subject: string; reason: "no_species_contract" }[];
} {
  const missing: { subject: string; reason: "no_species_contract" }[] = [];
  const seen = new Set<string>();
  for (const raw of subjects) {
    const s = NORM(raw ?? "");
    if (!s || seen.has(s)) continue;
    seen.add(s);
    if (hasSpeciesAnatomy(s)) continue;
    if (isNonAnatomySubject(s)) continue;
    missing.push({ subject: raw, reason: "no_species_contract" });
  }
  return { ok: missing.length === 0, missing };
}


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
