import type { KidsAgeGroup } from "@/lib/kidsTaxonomy";

interface Props {
  groups: KidsAgeGroup[];
  value: string | null;
  onChange: (slug: string | null) => void;
}

export const AgeGroupTabs = ({ groups, value, onChange }: Props) => {
  const btn = (active: boolean) =>
    `px-4 py-2 border-2 border-foreground font-display uppercase text-xs sm:text-sm tracking-wide transition-all whitespace-nowrap ${
      active
        ? "bg-foreground text-background shadow-brutal"
        : "bg-background hover:bg-highlight"
    }`;
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Age group">
      <button
        type="button"
        role="radio"
        aria-checked={value === null}
        onClick={() => onChange(null)}
        className={btn(value === null)}
      >
        ทุกช่วงวัย
      </button>
      {groups.map((g) => (
        <button
          key={g.slug}
          type="button"
          role="radio"
          aria-checked={value === g.slug}
          onClick={() => onChange(g.slug)}
          className={btn(value === g.slug)}
        >
          {g.label_th}
        </button>
      ))}
    </div>
  );
};
