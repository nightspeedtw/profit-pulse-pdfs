// Owner law 2026-07-18: every coloring book must ship with a complete,
// conversion-ready sales page. This helper derives the full copy pack from
// the four inputs we always have at publish time (title, category, ages,
// page_count) so the storefront renders a rich, differentiated product page
// with zero manual copywriting per book.
//
// Persisted at publish time under `storefront_meta.conversion_copy`, and
// re-derived on-the-fly by `list-storefront` for older books so retroactive
// upgrades don't require a backfill migration.

export interface ColoringSalesCopyInput {
  title: string;
  category_name: string | null;
  age_min: number | null;
  age_max: number | null;
  page_count: number;
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

export function buildColoringSalesCopy(input: ColoringSalesCopyInput): ColoringSalesCopy {
  const cat = categoryReadable(input.category_name);
  const ages = ageBand(input.age_min, input.age_max);
  const pages = input.page_count || 32;
  const trim = "8.5 × 11 in (US Letter)";

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
