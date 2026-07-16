import { Link } from "react-router-dom";
import { AGE_BANDS, THEMES, BUYER_JOBS } from "@/lib/kidsCatalogTaxonomy";

/**
 * Kids section nav — surfaces the taxonomy as browsable shelves.
 * Rendered under KidsHero on /kids and on every /kids/:categorySlug page.
 */
export function KidsSectionNav() {
  const topThemes = THEMES.slice(0, 4);
  return (
    <nav className="w-full border-b border-border bg-background/95 backdrop-blur sticky top-16 z-30">
      <div className="max-w-6xl mx-auto px-4 py-2 flex items-center gap-1 overflow-x-auto scrollbar-none text-xs font-mono uppercase tracking-widest">
        <span className="text-muted-foreground pr-2 shrink-0">Ages</span>
        {AGE_BANDS.map((a) => (
          <Link key={a.slug} to={`/kids/ages-${a.slug}`} className="px-2 py-1 hover:text-accent shrink-0">{a.short}</Link>
        ))}

        <span className="mx-2 h-4 w-px bg-border shrink-0" />

        <span className="text-muted-foreground pr-2 shrink-0">Themes</span>
        {topThemes.map((t) => (
          <Link key={t.slug} to={`/kids?theme=${t.slug}`} className="px-2 py-1 hover:text-accent shrink-0 whitespace-nowrap">{t.label}</Link>
        ))}

        <span className="mx-2 h-4 w-px bg-border shrink-0" />

        <span className="text-muted-foreground pr-2 shrink-0">Collections</span>
        <Link to="/kids/calmer-bedtimes"   className="px-2 py-1 hover:text-accent shrink-0 whitespace-nowrap">Calmer Bedtimes</Link>
        <Link to="/kids/for-the-classroom" className="px-2 py-1 hover:text-accent shrink-0 whitespace-nowrap">Classroom</Link>
        <Link to="/kids/perfect-gifts"     className="px-2 py-1 hover:text-accent shrink-0 whitespace-nowrap">Gifts</Link>

        <span className="mx-2 h-4 w-px bg-border shrink-0" />

        <Link to="/kids/coloring-books" className="px-2 py-1 hover:text-accent shrink-0 whitespace-nowrap text-accent">Coloring Books</Link>
      </div>
    </nav>
  );
}
