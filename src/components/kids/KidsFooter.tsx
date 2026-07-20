import { Link } from "react-router-dom";
import { KIDS_BRAND_URLS } from "./KidsBrand";
import footerLogo from "@/assets/secretpdf-kids-logo-v2.png.asset.json";

const SHOP: Array<{ label: string; href: string }> = [
  { label: "All Kids' Books", href: "/kids" },
  { label: "Coloring Books", href: "/kids?type=coloring-books" },
  { label: "Storybooks", href: "/kids?type=storybooks" },
  { label: "Activity & Puzzle Books", href: "/kids?type=activity-puzzle-books" },
  { label: "Learning Workbooks", href: "/kids?type=learning-workbooks" },
  { label: "Comics & Graphic Novels", href: "/kids?type=comics-graphic-novels" },
];

const AGES: Array<{ label: string; href: string }> = [
  { label: "Ages 2–4", href: "/kids?age=2-4" },
  { label: "Ages 4–6", href: "/kids?age=4-6" },
  { label: "Ages 6–8", href: "/kids?age=6-8" },
  { label: "Ages 8–10", href: "/kids?age=8-10" },
  { label: "Ages 10–12", href: "/kids?age=10-12" },
];

const HELP: Array<{ label: string; href: string }> = [
  { label: "Downloads", href: "/download" },
  { label: "FAQ", href: "/faq" },
  { label: "Refund Policy", href: "/refund" },
  { label: "Contact", href: "/contact" },
];

export function KidsFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="kids-night mt-16 text-[#F1EDFF]">
      <div className="mx-auto max-w-[1600px] px-4 py-14 md:py-16">
        <div className="grid gap-10 md:grid-cols-12">
          <div className="md:col-span-5">
            <img
              src={footerLogo.url || KIDS_BRAND_URLS.full}
              alt="SecretPDF Kids"
              className="h-16 md:h-20 w-auto mb-4"
            />
            <p className="font-display text-xl text-[#FFFDF8] max-w-sm">
              Magical books made for curious young minds.
            </p>
            <p className="mt-3 text-sm text-[#F1EDFF]/75 max-w-sm leading-relaxed">
              Instant printable stories, coloring books, activities, and learning
              adventures for every stage of childhood.
            </p>
          </div>

          <FooterCol title="Shop" items={SHOP} />
          <FooterCol title="Ages" items={AGES} />
          <FooterCol title="Help" items={HELP} />
        </div>

        <div className="mt-12 border-t border-white/10 pt-6 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between text-xs text-[#F1EDFF]/60">
          <p>Instant digital download · Secure checkout</p>
          <p>© {year} SecretPDF Kids. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, items }: { title: string; items: Array<{ label: string; href: string }> }) {
  return (
    <div className="md:col-span-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#FFC44D] mb-4">
        {title}
      </h3>
      <ul className="space-y-2.5 text-sm">
        {items.map((it) => (
          <li key={it.href + it.label}>
            <Link
              to={it.href}
              className="text-[#F1EDFF]/85 hover:text-[#FFE19A] transition-colors"
            >
              {it.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
