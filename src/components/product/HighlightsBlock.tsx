// Etsy-style "Highlights" block — right-column trust facts.
// All values come from the book's metadata; no hand-written copy per book.
import { FileText, Layers, Users, Baby, Palette } from "lucide-react";

interface Props {
  pageCount: number;
  ageMin: number;
  ageMax: number;
  categoryName: string;
  trimLabel?: string;
}

export default function HighlightsBlock({
  pageCount,
  ageMin,
  ageMax,
  categoryName,
  trimLabel = "8.5×8.5 in square",
}: Props) {
  const items: { icon: JSX.Element; label: string; value: string }[] = [
    { icon: <Users className="h-4 w-4" />, label: "Designed by", value: "SecretPDF Kids Studio" },
    { icon: <FileText className="h-4 w-4" />, label: "Digital file type", value: "1 PDF" },
    { icon: <Layers className="h-4 w-4" />, label: "Pages", value: String(pageCount) },
    { icon: <Baby className="h-4 w-4" />, label: "Ages", value: `${ageMin}–${ageMax}` },
    { icon: <Palette className="h-4 w-4" />, label: "Style", value: categoryName },
    { icon: <FileText className="h-4 w-4" />, label: "Print size", value: trimLabel },
  ];
  return (
    <div className="border-2 border-border rounded-lg p-4 bg-background">
      <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">
        Highlights
      </div>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {items.map((it) => (
          <li key={it.label} className="flex items-start gap-2">
            <span className="mt-0.5 text-muted-foreground">{it.icon}</span>
            <span>
              <span className="text-muted-foreground">{it.label}: </span>
              <span className="font-medium">{it.value}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
