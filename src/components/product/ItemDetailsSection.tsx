// Etsy-style Item Details — auto-generated from book metadata.
// Template values only. Never hand-written per book.
import { PackageCheck, Users, PlayCircle, AlertTriangle } from "lucide-react";

interface Props {
  pageCount: number;
  ageMin: number;
  ageMax: number;
  categoryName: string;
  themes?: string[];
}

export default function ItemDetailsSection({
  pageCount,
  ageMin,
  ageMax,
  categoryName,
  themes = [],
}: Props) {
  const included = [
    `${pageCount} unique coloring pages (no repeats)`,
    `1 printable cover page`,
    `1 "You did it!" completion certificate`,
    `Parent & teacher tips page`,
  ];
  const perfectFor = [
    "Parents looking for screen-free quiet time",
    "Homeschool art blocks & rainy-day activities",
    "Classroom & birthday-party printables",
    "Grandparents printing for visits",
  ];
  const howItWorks = [
    "Buy — no account required",
    "Instantly download your PDF",
    "Print at home on 8.5×11 paper (any color printer)",
  ];
  const important = [
    "Digital file only — nothing ships to your address",
    "Personal-use license (not for resale)",
    "Works on iPad / GoodNotes for tablet coloring",
    `Best on standard letter (US) or A4 (Europe) paper`,
  ];

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <DetailCard title="What's included" icon={<PackageCheck className="h-4 w-4" />} items={included} />
      <DetailCard title="Perfect for" icon={<Users className="h-4 w-4" />} items={perfectFor} />
      <DetailCard title="How it works" icon={<PlayCircle className="h-4 w-4" />} items={howItWorks} ordered />
      <DetailCard title="Important" icon={<AlertTriangle className="h-4 w-4" />} items={important} />
      {themes.length > 0 && (
        <div className="md:col-span-2 border-2 border-border rounded-lg p-4">
          <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">
            Themes
          </div>
          <div className="flex flex-wrap gap-2">
            {themes.map((t) => (
              <span key={t} className="px-2 py-1 border border-border rounded text-xs">
                {t}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="md:col-span-2 text-xs text-muted-foreground">
        Category: <span className="font-medium">{categoryName}</span> · Recommended ages{" "}
        <span className="font-medium">{ageMin}–{ageMax}</span>
      </div>
    </div>
  );
}

function DetailCard({
  title,
  icon,
  items,
  ordered,
}: {
  title: string;
  icon: JSX.Element;
  items: string[];
  ordered?: boolean;
}) {
  const ListTag = ordered ? "ol" : "ul";
  return (
    <div className="border-2 border-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-muted-foreground">{icon}</span>
        <h3 className="font-display uppercase text-sm tracking-wide">{title}</h3>
      </div>
      <ListTag className={`space-y-1.5 text-sm ${ordered ? "list-decimal ml-5" : "list-disc ml-5"}`}>
        {items.map((it) => (
          <li key={it}>{it}</li>
        ))}
      </ListTag>
    </div>
  );
}
