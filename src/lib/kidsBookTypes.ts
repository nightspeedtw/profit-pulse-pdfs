// Kids main book types + subcategories (owner spec 2026-07-20).
// Purely display + filtering; matching against real product records is done
// deterministically via `bookMatchesType` below — no fabricated products,
// no fake counts. Subcategory metadata is not yet stored on products, so
// selecting a subcategory narrows to its parent main type until the
// products table carries the sub-slug (safe fallback, no lies).

export type KidsTypeSlug =
  | "coloring-books"
  | "storybooks"
  | "activity-puzzle-books"
  | "learning-workbooks"
  | "comics-graphic-novels";

export interface KidsSubcategory {
  slug: string;
  label: string;
  th?: string;
}

export interface KidsMainType {
  slug: KidsTypeSlug;
  label: string;
  th: string;
  href: string;      // canonical landing page (may not exist yet — Kids page filter deep-links via ?type= for these)
  emoji: string;     // small original glyph (not an image asset)
  accent: string;    // tailwind bg tint class
  subcategories: KidsSubcategory[];
}

export const KIDS_MAIN_TYPES: KidsMainType[] = [
  {
    slug: "coloring-books",
    label: "Coloring Books",
    th: "หนังสือระบายสี",
    href: "/kids?type=coloring-books",
    emoji: "🎨",
    accent: "from-amber-100 to-orange-100",
    subcategories: [
      { slug: "bold-easy-coloring",    label: "Bold & Easy Coloring", th: "เส้นหนา ระบายง่าย" },
      { slug: "toddler-coloring",      label: "Toddler Coloring",     th: "สำหรับเด็กเล็ก" },
      { slug: "educational-coloring",  label: "Educational Coloring", th: "ระบายสีพร้อมเรียนรู้" },
      { slug: "story-coloring",        label: "Story Coloring Books", th: "ระบายสีแบบมีเรื่องราว" },
      { slug: "color-by-number",       label: "Color by Number",      th: "ระบายสีตามตัวเลข" },
      { slug: "color-by-letter",       label: "Color by Letter",      th: "ระบายสีตามตัวอักษร" },
      { slug: "dot-marker",            label: "Dot Marker Books",     th: "หนังสือแต้มสี" },
      { slug: "personalized-coloring", label: "Personalized Coloring",th: "ใส่ชื่อหรือรูปเด็ก" },
      { slug: "holiday-coloring",      label: "Holiday Coloring",     th: "เทศกาลและวันสำคัญ" },
      { slug: "giant-coloring",        label: "Giant Coloring Books", th: "ภาพใหญ่ รายละเอียดน้อย" },
    ],
  },
  {
    slug: "storybooks",
    label: "Storybooks",
    th: "หนังสือนิทาน",
    href: "/kids?type=storybooks",
    emoji: "📖",
    accent: "from-violet-100 to-indigo-100",
    subcategories: [
      { slug: "picture-books",        label: "Picture Books",             th: "นิทานภาพ" },
      { slug: "illustrated-story",    label: "Illustrated Storybooks",    th: "เรื่องราวพร้อมภาพประกอบ" },
      { slug: "bedtime-stories",      label: "Bedtime Stories",           th: "นิทานก่อนนอน" },
      { slug: "moral-stories",        label: "Moral Stories",             th: "นิทานสอนใจ" },
      { slug: "adventure-stories",    label: "Adventure Stories",         th: "ผจญภัย" },
      { slug: "fantasy-magic",        label: "Fantasy & Magic",           th: "แฟนตาซีและเวทมนตร์" },
      { slug: "fairy-tales",          label: "Fairy Tales",               th: "เทพนิยาย" },
      { slug: "animal-stories",       label: "Animal Stories",            th: "เรื่องราวสัตว์" },
      { slug: "family-friendship",    label: "Family & Friendship",       th: "ครอบครัวและมิตรภาพ" },
      { slug: "folktales-legends",    label: "Folktales & Legends",       th: "นิทานพื้นบ้านและตำนาน" },
      { slug: "short-story-coll",     label: "Short Story Collections",   th: "รวมเรื่องสั้น" },
      { slug: "read-aloud",           label: "Read-Aloud Books",          th: "หนังสือสำหรับผู้ปกครองอ่านให้ฟัง" },
    ],
  },
  {
    slug: "activity-puzzle-books",
    label: "Activity & Puzzle Books",
    th: "หนังสือกิจกรรมและปริศนา",
    href: "/kids?type=activity-puzzle-books",
    emoji: "🧩",
    accent: "from-emerald-100 to-teal-100",
    subcategories: [
      { slug: "mixed-activity",    label: "Mixed Activity Books",   th: "รวมกิจกรรม" },
      { slug: "mazes",             label: "Mazes",                  th: "เขาวงกต" },
      { slug: "dot-to-dot",        label: "Dot-to-Dot",             th: "ลากเส้นต่อจุด" },
      { slug: "i-spy",             label: "I Spy",                  th: "ค้นหาสิ่งของ" },
      { slug: "search-and-find",   label: "Search and Find",        th: "ค้นหาภาพ" },
      { slug: "spot-difference",   label: "Spot the Difference",    th: "หาจุดแตกต่าง" },
      { slug: "matching-games",    label: "Matching Games",         th: "จับคู่" },
      { slug: "word-search",       label: "Word Search",            th: "ค้นหาคำศัพท์" },
      { slug: "crosswords",        label: "Crosswords",             th: "ปริศนาอักษรไขว้" },
      { slug: "sudoku-kids",       label: "Sudoku for Kids",        th: "ซูโดกุเด็ก" },
      { slug: "logic-puzzles",     label: "Logic Puzzles",          th: "เกมตรรกะ" },
      { slug: "brain-games",       label: "Brain Games",            th: "เกมฝึกสมอง" },
      { slug: "cut-paste",         label: "Cut and Paste",          th: "ตัดและแปะ" },
      { slug: "travel-activity",   label: "Travel Activity Books",  th: "กิจกรรมระหว่างเดินทาง" },
      { slug: "party-activity",    label: "Party Activity Books",   th: "กิจกรรมงานวันเกิดและงานเลี้ยง" },
    ],
  },
  {
    slug: "learning-workbooks",
    label: "Learning & Workbooks",
    th: "หนังสือเรียนรู้และแบบฝึกหัด",
    href: "/kids?type=learning-workbooks",
    emoji: "✏️",
    accent: "from-sky-100 to-cyan-100",
    subcategories: [
      { slug: "alphabet-abc",        label: "Alphabet & ABC",              th: "ตัวอักษร" },
      { slug: "phonics",             label: "Phonics",                     th: "โฟนิกส์" },
      { slug: "sight-words",         label: "Sight Words",                 th: "คำศัพท์พื้นฐาน" },
      { slug: "tracing",             label: "Tracing",                     th: "ฝึกลากเส้น" },
      { slug: "handwriting",         label: "Handwriting",                 th: "ฝึกเขียน" },
      { slug: "name-tracing",        label: "Name Tracing",                th: "ฝึกเขียนชื่อตัวเอง" },
      { slug: "numbers-counting",    label: "Numbers & Counting",          th: "ตัวเลขและการนับ" },
      { slug: "addition-subtraction",label: "Addition & Subtraction",      th: "บวกและลบ" },
      { slug: "math-workbooks",      label: "Math Workbooks",              th: "คณิตศาสตร์" },
      { slug: "reading-comprehension",label: "Reading Comprehension",      th: "การอ่านจับใจความ" },
      { slug: "vocabulary",          label: "Vocabulary",                  th: "คำศัพท์" },
      { slug: "grammar",             label: "Grammar",                     th: "ไวยากรณ์" },
      { slug: "science-steam",       label: "Science & STEAM",             th: "วิทยาศาสตร์และ STEAM" },
      { slug: "school-readiness",    label: "School Readiness",            th: "เตรียมความพร้อมเข้าเรียน" },
      { slug: "preschool-workbooks", label: "Preschool Workbooks",         th: "ระดับอนุบาล" },
      { slug: "kindergarten-workbooks",label: "Kindergarten Workbooks",    th: "ระดับ Kindergarten" },
      { slug: "homeschool",          label: "Homeschool Resources",        th: "โฮมสคูล" },
      { slug: "bilingual",           label: "Bilingual & Language Learning",th: "สองภาษาและภาษาต่างประเทศ" },
    ],
  },
  {
    slug: "comics-graphic-novels",
    label: "Comics & Graphic Novels",
    th: "การ์ตูนและนิยายภาพ",
    href: "/kids?type=comics-graphic-novels",
    emoji: "💥",
    accent: "from-rose-100 to-pink-100",
    subcategories: [
      { slug: "kids-comics",         label: "Kids Comics" },
      { slug: "graphic-novels",      label: "Graphic Novels" },
      { slug: "educational-comics",  label: "Educational Comics" },
      { slug: "adventure-comics",    label: "Adventure Comics" },
      { slug: "fantasy-comics",      label: "Fantasy Comics" },
      { slug: "humorous-comics",     label: "Humorous Comics" },
      { slug: "mystery-comics",      label: "Mystery Comics" },
      { slug: "superhero-comics",    label: "Superhero Comics" },
      { slug: "manga-kids",          label: "Manga-Style for Kids" },
      { slug: "nonfiction-graphic",  label: "Nonfiction Graphic Novels" },
      { slug: "biography-comics",    label: "Biography Comics" },
      { slug: "science-history-comics",label: "Science & History Comics" },
    ],
  },
];

/** Map a stored product `book_type` value into a KidsTypeSlug. */
export function resolveBookTypeSlug(bookType: string | null | undefined): KidsTypeSlug | null {
  if (!bookType) return null;
  const t = bookType.toLowerCase();
  if (t === "coloring_book" || t === "coloring") return "coloring-books";
  if (t === "picture_book" || t === "illustrated_storybook" || t === "storybook") return "storybooks";
  if (t === "activity_book" || t === "puzzle_book") return "activity-puzzle-books";
  if (t === "workbook" || t === "learning_book") return "learning-workbooks";
  if (t === "comic" || t === "graphic_novel") return "comics-graphic-novels";
  return null;
}

/** Filter matcher. subcategory is currently a UI narrower (no product metadata yet). */
export function bookMatchesType(
  book: { book_type?: string | null },
  typeSlug: KidsTypeSlug | null,
  _subcategorySlug: string | null,
): boolean {
  if (!typeSlug) return true;
  return resolveBookTypeSlug(book.book_type) === typeSlug;
}

export function findMainType(slug: string | null | undefined): KidsMainType | null {
  if (!slug) return null;
  return KIDS_MAIN_TYPES.find((t) => t.slug === slug) ?? null;
}

export function findSubcategory(main: KidsMainType | null, subSlug: string | null | undefined): KidsSubcategory | null {
  if (!main || !subSlug) return null;
  return main.subcategories.find((s) => s.slug === subSlug) ?? null;
}
