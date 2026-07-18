// Owner law 2026-07-18: every coloring book must ship with a complete,
// conversion-ready sales page. This helper derives the full copy pack from
// the four inputs we always have at publish time (title, category, ages,
// page_count) so the storefront renders a rich, differentiated product page
// with zero manual copywriting per book.
//
// Persisted at publish time under `storefront_meta.conversion_copy`, and
// re-derived on-the-fly by `list-storefront` for older books so retroactive
// upgrades don't require a backfill migration.

import { bandProfileForAges, resolveBandProfileForDbBand, type AgeBandProfile, type MarketingTone } from "./age-bands.ts";

export interface ColoringSalesCopyInput {
  title: string;
  category_name: string | null;
  age_min: number | null;
  age_max: number | null;
  page_count: number;
  /** Optional DB age band ("2_3","3_5","4_6","6_8","8_12","13_17") — when
   * present, marketing tone is derived from AGE_BAND_PROFILE. */
  db_band?: string | null;
}

export interface ColoringSalesCopy {
  selling_hook: string;
  short_hook: string;
  product_description: string;
  shopping_card_description: string;
  benefit_bullets: string[];
  what_you_get: string[];
  who_it_is_for: string;
  who_its_not_for: string;
  digital_delivery_note: string;
  license_note: string;
  value_cards: {
    whats_inside: string[];
    why_kids_love_it: string[];
    perfect_for: string[];
  };
  trim_size: string;
  format_label: string;
}

function ageBand(min: number | null, max: number | null): string {
  if (min && max) return `${min}-${max}`;
  if (min) return `${min}+`;
  if (max) return `up to ${max}`;
  return "4-8";
}

function categoryReadable(name: string | null): string {
  if (!name) return "coloring";
  return name.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface TonePack {
  short_hook_intro: string;
  product_hook: string;
  bullet_prefix: string;
  who_for: string;
  who_not: string;
  perfect_for: string[];
  why_love_label: string;
  why_love: string[];
  tagline: string;
}

function tonePackFor(profile: AgeBandProfile | null, ages: string, cat: string, pages: number): TonePack {
  const tone: MarketingTone = profile?.marketing_tone ?? "parent_reassuring_preschool";
  switch (tone) {
    case "parent_reassuring_toddler":
      return {
        short_hook_intro: `A first coloring book made for tiny hands ages ${ages}.`,
        product_hook: `Board-book-simple pages: one huge friendly ${cat.toLowerCase()} subject per sheet, extra-thick outlines, ZERO tiny detail. Built for toddlers who are still learning to hold a crayon.`,
        bullet_prefix: `Extra-thick outlines`,
        who_for: `Parents and grandparents looking for a genuine toddler-first coloring book (ages ${ages}) with huge shapes, no small detail, and pages a two-year-old can actually finish.`,
        who_not: `Not for preschool or older kids — the pages are intentionally oversized and simple.`,
        perfect_for: [`First crayon practice`, `Quiet-time at home`, `Restaurant high-chair time`, `Waiting-room bag`, `Grandparent visits`],
        why_love_label: `Why toddlers love it`,
        why_love: [`Huge shapes they can actually color inside`, `Chunky friendly characters`, `Nothing tiny to frustrate them`, `Finished pages look like a win`],
        tagline: `A real toddler coloring book — not a scaled-down kids' book.`,
      };
    case "kid_adventure":
      return {
        short_hook_intro: `Action-packed ${cat.toLowerCase()} coloring adventures for kids ages ${ages}.`,
        product_hook: `Dynamic scenes, hero poses, and full-page adventures — a coloring book that reads like a middle-grade quest. ${pages} pages of ${cat.toLowerCase()} action.`,
        bullet_prefix: `Dynamic action scenes`,
        who_for: `Kids ages ${ages} who are done with baby coloring books and want ${cat.toLowerCase()} adventures they can actually get lost in.`,
        who_not: `Not for toddlers — the scenes are detailed and the poses are dynamic.`,
        perfect_for: [`After-school wind-down`, `Road trips`, `Rainy weekends`, `Gift for the ${cat.toLowerCase()} kid`, `Screen-free time`],
        why_love_label: `Why kids love it`,
        why_love: [`Action poses, not baby mascots`, `Full-scene backgrounds`, `${cat} they're actually into`, `Pages that feel grown-up enough`],
        tagline: `Adventure coloring for kids 6-8 who outgrew the baby books.`,
      };
    case "tween_not_for_little_kids":
      return {
        short_hook_intro: `NOT for little kids. A tween-first coloring book for ages ${ages}.`,
        product_hook: `Semi-stylized, manga-lite line art with real detail and 'stress-relief' patterned scenes — the coloring book tweens actually want on their shelf. ${pages} pages of ${cat.toLowerCase()} that reads more graphic novel than kiddie mascot.`,
        bullet_prefix: `Semi-stylized graphic-novel line art`,
        who_for: `Tweens ages ${ages} who rejected the last three coloring books you bought because they were 'too babyish'. Kawaii-cool, gaming-adjacent, aesthetic ${cat.toLowerCase()}.`,
        who_not: `Not for toddlers or young kids — the line work is intentionally fine and the aesthetic is tween-first.`,
        perfect_for: [`Phone-break stress relief`, `Sleepover activity`, `Long-flight quiet`, `Journaling companion`, `Gift for the 'I don't do baby stuff' tween`],
        why_love_label: `Why tweens love it`,
        why_love: [`Doesn't read as babyish`, `Manga-lite proportions, not chibi mascots`, `Real patterns to lose yourself in`, `Actually looks good finished`],
        tagline: `Finally a coloring book that isn't baby-coded.`,
      };
    case "teen_mindful_aesthetic":
      return {
        short_hook_intro: `Intricate aesthetic ${cat.toLowerCase()} coloring for teens ages ${ages}.`,
        product_hook: `Adult-coloring-adjacent sophistication with teen-trendy motifs — cottagecore, gothic-cozy, geometric, botanical, mindful mandalas. ${pages} pages of fine-line detail built for calm-down time.`,
        bullet_prefix: `Fine intricate line work`,
        who_for: `Teens ages ${ages} who want the grown-up adult-coloring experience with a teen-trendy aesthetic — cottagecore, gothic-cozy, mandala, botanical.`,
        who_not: `Not for kids — the line work is intricate and the pacing is meditative.`,
        perfect_for: [`Mindfulness / calm-down time`, `Study break`, `Journaling companion`, `Gift for the aesthetic-obsessed teen`, `Phone detox`],
        why_love_label: `Why teens love it`,
        why_love: [`Actually intricate, not baby-simple`, `Trendy aesthetics baked in`, `Meditative pacing`, `Reads like a self-care title`],
        tagline: `The grown-up coloring book — with teen taste.`,
      };
    case "parent_reassuring_preschool":
    default:
      return {
        short_hook_intro: `A printable ${cat.toLowerCase()} coloring book made for ages ${ages}.`,
        product_hook: `Thick, confident outlines so small hands stay inside the lines and finished pages look proud on the fridge.`,
        bullet_prefix: `Bold, kid-safe outlines`,
        who_for: `Parents, grandparents, teachers and caregivers looking for a screen-free, printable ${cat.toLowerCase()} activity for kids ages ${ages}.`,
        who_not: `Not intended for very young toddlers, and not sized for adult intricate detail coloring. This is a bold-line kids' book.`,
        perfect_for: [`Screen-free time`, `Rainy days & long car rides`, `Restaurants & waiting rooms`, `Birthday party favors`, `Homeschool quiet time`],
        why_love_label: `Why kids love it`,
        why_love: [`Bold outlines that feel achievable`, `${cat} they actually want to color`, `Finished pages look great on the fridge`, `Big enough to color with crayons or markers`],
        tagline: `Bold-line coloring book kids actually finish.`,
      };
  }
}

export function buildColoringSalesCopy(input: ColoringSalesCopyInput): ColoringSalesCopy {
  const cat = categoryReadable(input.category_name);
  const ages = ageBand(input.age_min, input.age_max);
  const bandProfile = resolveBandProfileForDbBand(input.db_band ?? null)
    ?? (input.age_min != null && input.age_max != null ? bandProfileForAges(input.age_min, input.age_max) : null);
  const pages = input.page_count || bandProfile?.page_count_default || 32;
  const trim = "8.5 × 11 in (US Letter)";
  const t = tonePackFor(bandProfile, ages, cat, pages);

  return {
    selling_hook: `${pages} big ${cat.toLowerCase()} coloring pages · ages ${ages}`,
    short_hook: `A printable ${cat} coloring book with ${pages} bold, kid-safe pages designed for ages ${ages}. Print once at home, color forever.`,
    product_description:
      `A printable ${cat.toLowerCase()} coloring book made for ages ${ages}. ` +
      `Every page is drawn with thick, confident outlines so small hands stay ` +
      `inside the lines and finished pages look proud on the fridge. ` +
      `Delivered as a single high-resolution PDF sized ${trim} — print the whole ` +
      `book, or just the page your kid is asking for right now.\n\n` +
      `Great for rainy afternoons, restaurant waits, travel bags, sibling quiet ` +
      `time and screen-free evenings. One purchase, unlimited household prints, ` +
      `no subscription and no shipping.`,
    shopping_card_description:
      `${pages}-page printable ${cat.toLowerCase()} coloring book for ages ${ages}. Instant PDF, print at home.`,
    benefit_bullets: [
      `${pages} unique ${cat.toLowerCase()} coloring pages`,
      `Bold, kid-safe outlines — easy to stay inside the lines`,
      `Print-ready PDF at ${trim}`,
      `One page per sheet, no bleed-through`,
      `Instant download — start coloring in 60 seconds`,
      `Unlimited reprints for your household`,
    ],
    what_you_get: [
      `${pages}-page ${cat.toLowerCase()} coloring book (PDF)`,
      `Full-color cover artwork`,
      `${trim} print size (fits standard US Letter paper)`,
      `Instant download link after purchase`,
      `Personal & household use license`,
    ],
    who_it_is_for:
      `Parents, grandparents, teachers and caregivers looking for a screen-free, ` +
      `printable ${cat.toLowerCase()} coloring activity for kids ages ${ages}. ` +
      `Perfect for road trips, waiting rooms, birthday goody bags, classroom quiet ` +
      `time and rainy weekends.`,
    who_its_not_for:
      `Not intended for very young toddlers under age ${Math.max(2, (input.age_min ?? 4) - 1)}, ` +
      `and not sized for adult intricate detail coloring. This is a bold-line kids' book.`,
    digital_delivery_note:
      `Instant download. You'll receive a single PDF file — no shipping, no waiting, no account required.`,
    license_note:
      `Personal & household use only. Print as many copies as your family needs. ` +
      `Not for resale, redistribution or classroom-wide licensing.`,
    value_cards: {
      whats_inside: [
        `${pages} unique coloring pages`,
        `Themed cover artwork`,
        `${trim} print-ready PDF`,
        `One page per sheet`,
      ],
      why_kids_love_it: [
        `Bold outlines that feel achievable`,
        `${cat} they actually want to color`,
        `Finished pages look great on the fridge`,
        `Big enough to color with crayons or markers`,
      ],
      perfect_for: [
        `Screen-free time`,
        `Rainy days & long car rides`,
        `Restaurants & waiting rooms`,
        `Birthday party favors`,
        `Homeschool quiet time`,
      ],
    },
    trim_size: trim,
    format_label: `Printable PDF · ${pages} pages · ${trim}`,
  };
}
