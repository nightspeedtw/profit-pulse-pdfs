// Category-aware Thumbnail Style System.
// Central source of truth for cover / thumbnail visual direction, listing-copy
// tone, and category-specific QC thresholds. Used by generate-cover and
// generate-selling-copy so every ebook — from serious finance to cheerful
// children's story — gets a coherent premium look on the internal store.

export type CategoryTone =
  | "serious"
  | "cheerful"
  | "calm"
  | "premium"
  | "playful"
  | "technical"
  | "dramatic";

export type MockupStyle =
  | "photoreal_hardcover"          // finance, business, executive
  | "premium_paperback"            // wellness, self-help
  | "illustrated_storybook"        // children
  | "clean_flat_digital"           // planners, workbooks, beginner guides
  | "editorial_magazine";          // fiction, creative

export interface StyleProfile {
  slug: string;
  display_name: string;
  badge_label: string;             // "EBOOK", "KIDS STORY", "PLANNER"…
  tone: CategoryTone;
  palette: {
    background: string;
    text: string;
    accent: string;
    supporting?: string[];
  };
  typography_style: string;        // human description used inside the AI prompt
  accent_key: string;              // maps into cover.ts ACCENT_BY_KEY
  visual_metaphors: string[];      // suggested hero motifs
  mockup_style: MockupStyle;
  prompt_rules: string;            // paragraph appended to the background prompt
  forbidden: string[];             // things the AI must NOT do
  copy_tone: string;               // guidance for selling-copy generation
  disclaimers: string[];           // append to long_description when applicable
  qc: {
    title_readability_min: number;
    click_appeal_min: number;
    mood_match_min: number;
    anti_ai_min: number;
  };
  price_band: { min: number; max: number };
}

const DEFAULT_QC = {
  title_readability_min: 90,
  click_appeal_min: 85,
  mood_match_min: 85,
  anti_ai_min: 90,
};

export const STYLE_PROFILES: Record<string, StyleProfile> = {
  finance: {
    slug: "finance",
    display_name: "Finance / Debt / Wealth",
    badge_label: "FINANCE GUIDE",
    tone: "serious",
    palette: {
      background: "#0b0b0b",
      text: "#f4f2ee",
      accent: "#f5c518",
      supporting: ["#1c1c1c", "#c9a227"],
    },
    accent_key: "gold",
    typography_style:
      "Huge condensed heavy uppercase sans display; single accent word in gold; hairline subtitle in ivory.",
    visual_metaphors: [
      "dark staircase to a lit exit doorway",
      "payoff ladder", "debt-exit gate", "financial fortress",
      "locked/unlocked chain over a horizon", "clean architectural blueprint of a plan",
    ],
    mockup_style: "photoreal_hardcover",
    prompt_rules:
      "Dark editorial nonfiction, cinematic side-lighting, matte finish, controlled negative space, single strong metaphor of control/momentum/clarity/freedom. NO cash rain, NO fake luxury, NO stock coins.",
    forbidden: [
      "childish colors", "cartoon money", "guaranteed-wealth claims",
      "stock photo of a handshake", "over-glossy 3D coins",
    ],
    copy_tone:
      "Serious, confident, calm authority. Speak to control, momentum and clarity — never promise guaranteed income.",
    disclaimers: [
      "ข้อมูลเพื่อการศึกษา ไม่ใช่คำแนะนำการลงทุน ปรึกษาผู้เชี่ยวชาญก่อนตัดสินใจทางการเงิน",
    ],
    qc: DEFAULT_QC,
    price_band: { min: 19, max: 39 },
  },

  children_illustrated: {
    slug: "children_illustrated",
    display_name: "Children's Illustrated Story",
    badge_label: "KIDS STORY",
    tone: "cheerful",
    palette: {
      background: "#fff8ec",
      text: "#2b1f4a",
      accent: "#ff6f61",
      supporting: ["#ffd166", "#06d6a0", "#4cc9f0"],
    },
    accent_key: "magenta",
    typography_style:
      "Playful rounded sans, generous weight, hand-drawn feel; friendly title, warm colored highlight word.",
    visual_metaphors: [
      "friendly animal hero on a small adventure", "cozy storybook scene",
      "magical treehouse", "gentle forest with soft sunlight",
      "child looking up at stars", "expressive picture-book character",
    ],
    mockup_style: "illustrated_storybook",
    prompt_rules:
      "Storybook illustration, warm gouache/watercolor feel, gentle depth, expressive characters, age-appropriate, soft magical lighting. Cheerful and safe.",
    forbidden: [
      "scary imagery", "violence", "photorealistic humans", "grotesque monsters",
      "guns", "sexualized characters", "text baked into the illustration",
    ],
    copy_tone:
      "Warm and inviting for parents; sell the imagination, illustrations, and emotional value of story time. No fear-based hooks.",
    disclaimers: [
      "เนื้อหาเหมาะสำหรับเด็ก โปรดอ่านและเลือกให้เหมาะกับช่วงวัยของลูก",
    ],
    qc: { ...DEFAULT_QC, click_appeal_min: 82 },
    price_band: { min: 7, max: 19 },
  },

  business_career: {
    slug: "business_career",
    display_name: "Business / Career / Productivity",
    badge_label: "BUSINESS GUIDE",
    tone: "technical",
    palette: {
      background: "#0f1720",
      text: "#f4f6f8",
      accent: "#22d3ee",
      supporting: ["#1e293b", "#38bdf8"],
    },
    accent_key: "cyan",
    typography_style:
      "Modern geometric sans, tight tracking, structured hierarchy; accent word in electric cyan.",
    visual_metaphors: [
      "workflow engine", "command console", "precision blueprint",
      "ladder or staircase of steps", "map with a clear path", "systems diagram",
    ],
    mockup_style: "photoreal_hardcover",
    prompt_rules:
      "Editorial, sharp, structured, workplace-modern. Clean geometric shapes, precise light, no clutter, no stock office photo.",
    forbidden: [
      "stock office handshake", "corporate suit stock", "cheesy arrows",
      "fake awards", "generic laptop-on-desk",
    ],
    copy_tone:
      "Practical, focused, systems-oriented. Speak to results, structure, and clarity for busy operators.",
    disclaimers: [],
    qc: DEFAULT_QC,
    price_band: { min: 19, max: 49 },
  },

  wellness_selfhelp: {
    slug: "wellness_selfhelp",
    display_name: "Wellness / Self-help",
    badge_label: "WELLNESS",
    tone: "calm",
    palette: {
      background: "#f2ede4",
      text: "#1a1a1a",
      accent: "#10b981",
      supporting: ["#a7d7c5", "#dcd0b4"],
    },
    accent_key: "emerald",
    typography_style:
      "Soft modern serif for title, calm lowercase subtitle; generous whitespace, breathable rhythm.",
    visual_metaphors: [
      "sunrise threshold", "calm architecture", "still water", "open horizon",
      "single plant sprouting", "morning light through a window",
    ],
    mockup_style: "premium_paperback",
    prompt_rules:
      "Calm, premium, human-friendly, natural materials, soft directional light, restrained composition.",
    forbidden: [
      "overly clinical stock", "diet-shame imagery", "before/after body shots",
      "guaranteed cures",
    ],
    copy_tone:
      "Gentle, reassuring, empowering. Never shame the reader; never promise medical outcomes.",
    disclaimers: [
      "ข้อมูลเพื่อการศึกษาทั่วไป ไม่ใช่คำแนะนำทางการแพทย์ ปรึกษาผู้เชี่ยวชาญด้านสุขภาพก่อนเริ่มโปรแกรมใดๆ",
    ],
    qc: DEFAULT_QC,
    price_band: { min: 15, max: 29 },
  },

  education_workbook: {
    slug: "education_workbook",
    display_name: "Educational Workbook",
    badge_label: "WORKBOOK",
    tone: "premium",
    palette: {
      background: "#ffffff",
      text: "#111827",
      accent: "#2563eb",
      supporting: ["#f3f4f6", "#93c5fd"],
    },
    accent_key: "cyan",
    typography_style:
      "Clean editorial sans; structured grid, numbered chapters, badge in accent.",
    visual_metaphors: [
      "grid of exercises", "notebook page", "clean line diagram",
      "step-by-step ladder", "worksheet stack",
    ],
    mockup_style: "clean_flat_digital",
    prompt_rules:
      "Clean flat editorial layout, textbook-quality restraint, generous whitespace, no photorealistic figures.",
    forbidden: ["stock student photo", "clip-art", "childish colors unless topic is for kids"],
    copy_tone:
      "Clear, practical, teacher-like. Sell the exercises, structure, and outcome.",
    disclaimers: [],
    qc: DEFAULT_QC,
    price_band: { min: 12, max: 29 },
  },

  parenting_family: {
    slug: "parenting_family",
    display_name: "Parenting / Family",
    badge_label: "PARENTING",
    tone: "calm",
    palette: {
      background: "#fdf6ec",
      text: "#3a2e1f",
      accent: "#e07a5f",
      supporting: ["#f2cc8f", "#81b29a"],
    },
    accent_key: "amber",
    typography_style:
      "Warm humanist serif for title, friendly sans subtitle.",
    visual_metaphors: [
      "parent and child moment", "cozy home scene", "hands cupping seedling",
      "family walking together",
    ],
    mockup_style: "premium_paperback",
    prompt_rules:
      "Warm, human, restrained; natural light; no stock family cliché, no perfect-mom-with-kids stock.",
    forbidden: ["stock family cliché", "shaming imagery", "medical claims"],
    copy_tone:
      "Warm, non-judgmental, practical. Respect that every family is different.",
    disclaimers: [
      "เนื้อหาเพื่อการศึกษา ไม่ใช่คำแนะนำทางการแพทย์หรือจิตวิทยา",
    ],
    qc: DEFAULT_QC,
    price_band: { min: 15, max: 29 },
  },

  creative_hobby: {
    slug: "creative_hobby",
    display_name: "Creative Hobby",
    badge_label: "GUIDE",
    tone: "playful",
    palette: {
      background: "#1a1625",
      text: "#faf5ff",
      accent: "#a78bfa",
      supporting: ["#f472b6", "#facc15"],
    },
    accent_key: "violet",
    typography_style:
      "Expressive display type, playful accent word.",
    visual_metaphors: [
      "artist's tools laid out", "creative studio still life", "sketchbook and brush",
    ],
    mockup_style: "editorial_magazine",
    prompt_rules:
      "Vibrant editorial still life, hand-crafted feel, tactile textures.",
    forbidden: ["stock hobby clipart"],
    copy_tone:
      "Fun, inviting, permission-giving. Sell the joy and the creative outcome.",
    disclaimers: [],
    qc: DEFAULT_QC,
    price_band: { min: 12, max: 25 },
  },

  beginner_guide: {
    slug: "beginner_guide",
    display_name: "Beginner Guide / Mini Toolkit",
    badge_label: "STARTER GUIDE",
    tone: "premium",
    palette: {
      background: "#0f172a",
      text: "#f8fafc",
      accent: "#facc15",
      supporting: ["#1e293b", "#fde68a"],
    },
    accent_key: "amber",
    typography_style:
      "Bold sans, oversized numeral or badge, accent word highlight.",
    visual_metaphors: [
      "map of the terrain", "compass", "first-step marker", "starter kit still life",
    ],
    mockup_style: "photoreal_hardcover",
    prompt_rules:
      "Premium starter-kit feel, restrained, one bold hero object.",
    forbidden: [],
    copy_tone:
      "Reassuring, low-friction; make the beginner feel it's easy to start.",
    disclaimers: [],
    qc: DEFAULT_QC,
    price_band: { min: 9, max: 17 },
  },

  fiction_short: {
    slug: "fiction_short",
    display_name: "Short Fiction / Illustrated Story",
    badge_label: "STORY",
    tone: "dramatic",
    palette: {
      background: "#111",
      text: "#f5f5dc",
      accent: "#ef4444",
      supporting: ["#1a1a1a", "#facc15"],
    },
    accent_key: "crimson",
    typography_style:
      "Cinematic serif, dramatic scale, single accent word.",
    visual_metaphors: [
      "silhouette on a horizon", "single figure walking into light",
      "atmospheric scene from the story",
    ],
    mockup_style: "editorial_magazine",
    prompt_rules:
      "Cinematic mood, painterly, evocative single scene.",
    forbidden: ["stock people", "generic AI fantasy"],
    copy_tone:
      "Evocative and character-driven; sell mood, plot promise, and characters.",
    disclaimers: [],
    qc: DEFAULT_QC,
    price_band: { min: 7, max: 15 },
  },
};

const CATEGORY_KEYWORD_MAP: Array<[RegExp, string]> = [
  [/child|kid|story|storybook|nursery|bedtime|nanny/i, "children_illustrated"],
  [/finance|debt|money|wealth|budget|invest|cash/i, "finance"],
  [/business|market|productivity|ai|career|exec|manag|entrepren/i, "business_career"],
  [/health|burnout|wellness|energy|sleep|calm|mindful|meditat|self[-\s]?help|self[-\s]?improv/i, "wellness_selfhelp"],
  [/parent|family|mom|dad|toddler|teen/i, "parenting_family"],
  [/craft|art|paint|draw|hobby|photo|music/i, "creative_hobby"],
  [/beginner|starter|101|intro|basic/i, "beginner_guide"],
  [/fiction|novel|story|tale|adventure/i, "fiction_short"],
  [/workbook|worksheet|planner|template|toolkit|education|course/i, "education_workbook"],
];

export function resolveStyleProfile(input: {
  category_slug?: string | null;
  category_name?: string | null;
  title?: string | null;
  subtitle?: string | null;
}): StyleProfile {
  const slug = (input.category_slug ?? "").toLowerCase().trim();
  if (slug && STYLE_PROFILES[slug]) return STYLE_PROFILES[slug];
  const haystack = [input.category_name, input.title, input.subtitle]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  for (const [rx, key] of CATEGORY_KEYWORD_MAP) {
    if (rx.test(haystack)) return STYLE_PROFILES[key];
  }
  return STYLE_PROFILES.finance;
}

export function stylePromptClause(p: StyleProfile): string {
  return `\n\n=== CATEGORY STYLE (${p.display_name}) ===\nTone: ${p.tone}. Mockup style: ${p.mockup_style}.\nPalette (bg/text/accent): ${p.palette.background} / ${p.palette.text} / ${p.palette.accent}.\nTypography style: ${p.typography_style}\nSuggested visual metaphors: ${p.visual_metaphors.join("; ")}.\nRules: ${p.prompt_rules}\nFORBIDDEN: ${p.forbidden.join("; ") || "none"}.\n=== END STYLE ===`;
}
