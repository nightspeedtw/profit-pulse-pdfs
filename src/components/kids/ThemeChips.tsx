import type { KidsTheme } from "@/lib/kidsTaxonomy";
import * as Icons from "lucide-react";

interface Props {
  themes: KidsTheme[];
  value: string[];
  onChange: (slugs: string[]) => void;
}

export const ThemeChips = ({ themes, value, onChange }: Props) => {
  const toggle = (slug: string) => {
    onChange(value.includes(slug) ? value.filter((s) => s !== slug) : [...value, slug]);
  };
  return (
    <div className="flex flex-wrap gap-2">
      {themes.map((t) => {
        const active = value.includes(t.slug);
        const Icon = (t.icon_name && (Icons as any)[t.icon_name]) || Icons.Sparkles;
        return (
          <button
            key={t.slug}
            type="button"
            onClick={() => toggle(t.slug)}
            aria-pressed={active}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border-2 border-foreground text-xs sm:text-sm font-sans transition-all ${
              active
                ? "bg-accent text-accent-foreground shadow-brutal"
                : "bg-background hover:bg-secondary"
            }`}
          >
            <Icon className="h-4 w-4" strokeWidth={2} />
            {t.label_th}
          </button>
        );
      })}
      {value.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([])}
          className="px-3 py-1.5 text-xs font-mono uppercase underline hover:no-underline"
        >
          ล้างธีม
        </button>
      )}
    </div>
  );
};
