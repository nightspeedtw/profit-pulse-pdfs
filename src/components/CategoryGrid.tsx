import { Link } from "react-router-dom";
import {
  GraduationCap,
  Briefcase,
  Heart,
  Dumbbell,
  Baby,
  Sparkles,
  Palette,
  ChefHat,
  Pencil,
} from "lucide-react";

const CATEGORIES = [
  { slug: "study", label: "Study & Exam", icon: GraduationCap, color: "bg-highlight" },
  { slug: "business", label: "Business & Templates", icon: Briefcase, color: "bg-accent text-accent-foreground" },
  { slug: "wellness", label: "Wellness & Mind", icon: Heart, color: "bg-background" },
  { slug: "fitness", label: "Fitness & Meal Plans", icon: Dumbbell, color: "bg-foreground text-background" },
  { slug: "parenting", label: "Parenting & Kids", icon: Baby, color: "bg-highlight" },
  { slug: "coloring-books", label: "Coloring Books", icon: Pencil, color: "bg-background" },
  { slug: "lifestyle", label: "Lifestyle & Planners", icon: Sparkles, color: "bg-accent text-accent-foreground" },
  { slug: "creative", label: "Art & Creative", icon: Palette, color: "bg-background" },
  { slug: "cooking", label: "Cooking & Recipes", icon: ChefHat, color: "bg-foreground text-background" },
];

export const CategoryGrid = () => (
  <section className="container py-20">
    <div className="flex flex-wrap items-end justify-between gap-4 mb-10">
      <div>
        <p className="font-mono uppercase tracking-widest text-xs mb-3">[ Browse ]</p>
        <h2 className="font-display text-4xl lg:text-5xl uppercase">Pick your <span className="underline-brutal">niche</span>.</h2>
      </div>
      <Link to="/categories" className="font-display uppercase text-sm tracking-wider underline-offset-4 hover:underline">
        See all →
      </Link>
    </div>

    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {CATEGORIES.map((c) => (
        <Link
          key={c.slug}
          to={`/category/${c.slug}`}
          className={`group border-2 border-foreground p-5 ${c.color} transition-all hover:shadow-brutal hover:-translate-x-1 hover:-translate-y-1`}
        >
          <c.icon className="h-8 w-8 mb-4" strokeWidth={2} />
          <p className="font-display text-base uppercase leading-tight">{c.label}</p>
          <p className="text-xs mt-2 opacity-70 font-mono">View →</p>
        </Link>
      ))}
    </div>
  </section>
);

export { CATEGORIES };
