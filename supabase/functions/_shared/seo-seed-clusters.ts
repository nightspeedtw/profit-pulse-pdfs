// Curated seed clusters for the SEO/AEO/GEO autopilot.
// ~60 high-quality entries. Idempotent — deduped by `cluster_key`.
// Keep spelling correct (Etsy, not Esty).
// @ts-nocheck

export type SeedCluster = {
  cluster_key: string;
  cluster_name: string;
  search_intent:
    | "transactional"
    | "commercial"
    | "informational"
    | "navigational"
    | "seasonal"
    | "competitor_comparison";
  priority: number;
  target_page_type:
    | "category"
    | "product"
    | "blog"
    | "guide"
    | "comparison"
    | "seasonal"
    | "programmatic";
  primary_keyword: string;
  secondary_keywords: string[];
  competitor_keywords?: string[];
  negative_keywords?: string[];
  min_word_count?: number;
  max_word_count?: number;
  recommended_images?: number;
  aeo_questions?: string[];
  geo_evidence_points?: string[];
};

const AEO_CORE = [
  "What is a printable coloring book?",
  "Are printable coloring pages age-appropriate?",
  "How do I print PDF coloring pages at home?",
  "Can I use these coloring pages in a classroom?",
];
const GEO_CORE = [
  "Format: instant-download PDF, US Letter and A4",
  "Age range shown on every product page",
  "Curated by SecretPDF Kids — reviewed for safety and readability",
];

function c(x: SeedCluster): SeedCluster {
  return {
    min_word_count: 700,
    max_word_count: 1400,
    recommended_images: 5,
    aeo_questions: AEO_CORE,
    geo_evidence_points: GEO_CORE,
    competitor_keywords: [],
    negative_keywords: ["gun", "weapon", "violence", "adult", "nsfw"],
    ...x,
  };
}

export const SEED_CLUSTERS: SeedCluster[] = [
  // ============ CORE GENERIC / BUYER ============
  c({ cluster_key: "core-kids-coloring-book", cluster_name: "Kids Coloring Book (hub)",
      search_intent: "transactional", priority: 100, target_page_type: "category",
      primary_keyword: "kids coloring book",
      secondary_keywords: ["printable coloring book", "coloring pages for kids", "PDF coloring book for kids"] }),
  c({ cluster_key: "core-printable-coloring-book", cluster_name: "Printable Coloring Book",
      search_intent: "transactional", priority: 95, target_page_type: "category",
      primary_keyword: "printable coloring book",
      secondary_keywords: ["kids coloring pages printable PDF", "instant download coloring book"] }),
  c({ cluster_key: "core-coloring-pages-for-kids", cluster_name: "Coloring Pages for Kids",
      search_intent: "commercial", priority: 92, target_page_type: "guide",
      primary_keyword: "coloring pages for kids",
      secondary_keywords: ["easy coloring pages for kids", "cute coloring book for kids"] }),
  c({ cluster_key: "core-kids-pages-pdf", cluster_name: "Kids Coloring Pages PDF",
      search_intent: "transactional", priority: 90, target_page_type: "programmatic",
      primary_keyword: "kids coloring pages printable PDF",
      secondary_keywords: ["digital coloring book", "PDF coloring book for kids"] }),
  c({ cluster_key: "core-toddler-coloring-book", cluster_name: "Toddler Coloring Book",
      search_intent: "transactional", priority: 85, target_page_type: "category",
      primary_keyword: "toddler coloring book printable",
      secondary_keywords: ["coloring book for 2 year olds", "big shape coloring pages"] }),
  c({ cluster_key: "core-preschool-coloring-book", cluster_name: "Preschool Coloring Book",
      search_intent: "transactional", priority: 85, target_page_type: "category",
      primary_keyword: "preschool coloring book",
      secondary_keywords: ["preschool printables", "coloring for 3-5 year olds"] }),
  c({ cluster_key: "core-kindergarten-coloring", cluster_name: "Kindergarten Coloring Pages",
      search_intent: "commercial", priority: 80, target_page_type: "programmatic",
      primary_keyword: "kindergarten coloring pages",
      secondary_keywords: ["classroom coloring pages", "kindergarten worksheets"] }),
  c({ cluster_key: "core-easy-coloring", cluster_name: "Easy Coloring Pages",
      search_intent: "informational", priority: 75, target_page_type: "guide",
      primary_keyword: "easy coloring pages for kids",
      secondary_keywords: ["simple coloring book for beginners"] }),
  c({ cluster_key: "core-cute-coloring", cluster_name: "Cute Coloring Book",
      search_intent: "commercial", priority: 75, target_page_type: "category",
      primary_keyword: "cute coloring book for kids",
      secondary_keywords: ["kawaii coloring pages kids"] }),
  c({ cluster_key: "core-instant-download", cluster_name: "Instant Download Coloring Book",
      search_intent: "transactional", priority: 90, target_page_type: "programmatic",
      primary_keyword: "instant download coloring book",
      secondary_keywords: ["digital coloring book", "PDF coloring book for kids"] }),
  c({ cluster_key: "core-pdf-coloring", cluster_name: "PDF Coloring Book for Kids",
      search_intent: "transactional", priority: 90, target_page_type: "programmatic",
      primary_keyword: "PDF coloring book for kids",
      secondary_keywords: ["printable coloring book", "instant download coloring book"] }),
  c({ cluster_key: "core-digital-coloring-book", cluster_name: "Digital Coloring Book",
      search_intent: "commercial", priority: 80, target_page_type: "guide",
      primary_keyword: "digital coloring book",
      secondary_keywords: ["digital download coloring book"] }),

  // ============ ETSY / MARKETPLACE (comparison, honest) ============
  c({ cluster_key: "etsy-coloring-book", cluster_name: "Etsy Coloring Book (comparison)",
      search_intent: "competitor_comparison", priority: 88, target_page_type: "comparison",
      primary_keyword: "Etsy coloring book",
      secondary_keywords: ["Etsy printable coloring pages"],
      competitor_keywords: ["Etsy"],
      min_word_count: 900, max_word_count: 1400 }),
  c({ cluster_key: "etsy-printable-pages", cluster_name: "Etsy Printable Coloring Pages",
      search_intent: "competitor_comparison", priority: 85, target_page_type: "comparison",
      primary_keyword: "Etsy printable coloring pages",
      secondary_keywords: ["printable coloring pages marketplace"],
      competitor_keywords: ["Etsy"], min_word_count: 900, max_word_count: 1400 }),
  c({ cluster_key: "etsy-kids-printable", cluster_name: "Etsy Kids Coloring Book Printable",
      search_intent: "competitor_comparison", priority: 82, target_page_type: "comparison",
      primary_keyword: "Etsy kids coloring book printable",
      secondary_keywords: ["kids printable coloring pages Etsy"],
      competitor_keywords: ["Etsy"], min_word_count: 900, max_word_count: 1400 }),
  c({ cluster_key: "etsy-digital-download", cluster_name: "Etsy Digital Download Coloring Book",
      search_intent: "competitor_comparison", priority: 80, target_page_type: "comparison",
      primary_keyword: "Etsy digital download coloring book",
      competitor_keywords: ["Etsy"], min_word_count: 900, max_word_count: 1400 }),
  c({ cluster_key: "etsy-best-selling", cluster_name: "Best Selling Kids Coloring Book on Etsy",
      search_intent: "competitor_comparison", priority: 78, target_page_type: "comparison",
      primary_keyword: "best selling kids coloring book Etsy",
      competitor_keywords: ["Etsy"], min_word_count: 900, max_word_count: 1400 }),
  c({ cluster_key: "etsy-alternative", cluster_name: "Printable Coloring Book Etsy Alternative",
      search_intent: "competitor_comparison", priority: 85, target_page_type: "comparison",
      primary_keyword: "printable coloring book Etsy alternative",
      secondary_keywords: ["Etsy alternative for printables"],
      competitor_keywords: ["Etsy"], min_word_count: 1000, max_word_count: 1500 }),
  c({ cluster_key: "etsy-bundle-alternative", cluster_name: "Coloring Book Bundle Etsy Alternative",
      search_intent: "competitor_comparison", priority: 80, target_page_type: "comparison",
      primary_keyword: "coloring book bundle Etsy alternative",
      competitor_keywords: ["Etsy"], min_word_count: 1000, max_word_count: 1500 }),

  // ============ THEMES ============
  ...[
    ["theme-animals", "Animal Coloring Book", "animal coloring book for kids"],
    ["theme-ocean", "Ocean Animals Coloring Book", "ocean animals coloring book"],
    ["theme-dinosaur", "Dinosaur Coloring Book", "dinosaur coloring book for kids"],
    ["theme-unicorn", "Unicorn Coloring Book", "unicorn coloring book printable"],
    ["theme-dragon", "Dragon Coloring Pages", "dragon coloring pages for kids"],
    ["theme-cars", "Cars Coloring Book", "cars coloring book for kids"],
    ["theme-construction", "Construction Coloring Pages", "construction coloring pages"],
    ["theme-space", "Space Coloring Book", "space coloring book for kids"],
    ["theme-mermaid", "Mermaid Coloring Book", "mermaid coloring book printable"],
    ["theme-fairy", "Fairy Coloring Book", "fairy coloring book for kids"],
    ["theme-farm", "Farm Animals Coloring Book", "farm animals coloring book"],
    ["theme-jungle", "Jungle Animals Coloring Pages", "jungle animals coloring pages"],
    ["theme-monsters", "Cute Monsters Coloring Book", "cute monsters coloring book"],
    ["theme-princess", "Princess Coloring Pages", "princess coloring pages printable"],
    ["theme-superhero", "Superhero Coloring Pages", "superhero coloring pages for kids"],
  ].map(([key, name, kw]) =>
    c({ cluster_key: key, cluster_name: name, search_intent: "commercial", priority: 72,
        target_page_type: "category", primary_keyword: kw,
        secondary_keywords: ["printable coloring book", "PDF coloring book for kids"] })),

  // ============ SEASONAL ============
  ...[
    ["season-christmas", "Christmas Coloring Book", "Christmas coloring book for kids"],
    ["season-halloween", "Halloween Coloring Pages", "Halloween coloring pages for kids"],
    ["season-easter", "Easter Coloring Book", "Easter coloring book printable"],
    ["season-valentine", "Valentine Coloring Pages", "Valentine coloring pages for kids"],
    ["season-thanksgiving", "Thanksgiving Coloring Pages", "Thanksgiving coloring pages"],
    ["season-summer", "Summer Activity Coloring Pages", "summer activity coloring pages"],
    ["season-back-to-school", "Back to School Coloring Pages", "back to school coloring pages"],
    ["season-birthday", "Birthday Party Coloring Pages", "birthday party coloring pages printable"],
  ].map(([key, name, kw]) =>
    c({ cluster_key: key, cluster_name: name, search_intent: "seasonal", priority: 70,
        target_page_type: "seasonal", primary_keyword: kw,
        secondary_keywords: ["printable coloring pages", "instant download"] })),

  // ============ EDUCATIONAL / AEO ============
  ...[
    ["edu-alphabet", "Alphabet Coloring Pages", "alphabet coloring pages"],
    ["edu-numbers", "Number Coloring Pages", "number coloring pages"],
    ["edu-shapes", "Shapes Coloring Pages", "shapes coloring pages"],
    ["edu-fine-motor", "Fine Motor Skills Activities", "fine motor skills coloring activities"],
    ["edu-quiet-time", "Quiet Time Activities", "quiet time activities for kids"],
    ["edu-screen-free", "Screen-Free Activities", "screen free activities for kids"],
    ["edu-classroom", "Classroom Coloring Pages", "classroom coloring pages"],
    ["edu-homeschool", "Homeschool Coloring Pages", "homeschool coloring pages"],
    ["edu-travel", "Travel Activity Book", "travel activity book for kids"],
    ["edu-rainy-day", "Rainy Day Activities", "rainy day activities for kids"],
  ].map(([key, name, kw]) =>
    c({ cluster_key: key, cluster_name: name, search_intent: "informational", priority: 65,
        target_page_type: "guide", primary_keyword: kw,
        secondary_keywords: ["kids activity pages", "printable activities"],
        min_word_count: 1200, max_word_count: 1800, recommended_images: 6 })),

  // ============ COMMERCIAL BUNDLES ============
  ...[
    ["bundle-kids", "Coloring Book Bundle for Kids", "coloring book bundle for kids"],
    ["bundle-pages", "Printable Coloring Pages Bundle", "printable coloring pages bundle"],
    ["bundle-100", "100 Coloring Pages PDF", "100 coloring pages PDF"],
    ["bundle-50", "50 Coloring Pages Printable", "50 coloring pages printable"],
    ["bundle-activity", "Kids Activity Book PDF", "kids activity book PDF"],
    ["bundle-printable-activity", "Printable Activity Book", "printable activity book for kids"],
  ].map(([key, name, kw]) =>
    c({ cluster_key: key, cluster_name: name, search_intent: "transactional", priority: 82,
        target_page_type: "programmatic", primary_keyword: kw,
        secondary_keywords: ["bundle", "value pack", "PDF download"] })),

  // ============ FAMILY-SAFE OVERLAP ============
  ...[
    ["family-adults-kids", "Cute Coloring Pages Adults and Kids", "cute coloring pages adults and kids"],
    ["family-cozy", "Cozy Coloring Pages", "cozy coloring pages printable"],
    ["family-activity-pdf", "Family Coloring Activity PDF", "family coloring activity PDF"],
  ].map(([key, name, kw]) =>
    c({ cluster_key: key, cluster_name: name, search_intent: "commercial", priority: 60,
        target_page_type: "guide", primary_keyword: kw,
        secondary_keywords: ["family friendly coloring", "all-ages coloring"] })),
];
