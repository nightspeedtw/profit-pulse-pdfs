import { ShieldCheck, FileCheck2, BadgeCheck } from "lucide-react";

interface Props {
  compact?: boolean;
  className?: string;
}

/**
 * Honest editorial-quality badge — replaces fake customer-rating stars on
 * surfaces that have no real customer reviews yet. Every live SecretPDF
 * book passes editorial QC, PDF verification, and age-band checks before
 * shipping, so we surface those guarantees instead of fabricating a rating.
 */
export function EditorialQualityBadge({ compact = false, className = "" }: Props) {
  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[11px] text-muted-foreground ${className}`}
        title="Passed SecretPDF editorial QC · Verified PDF · Age-checked"
        aria-label="SecretPDF editorial quality: passed QC, verified PDF, age-checked"
      >
        <BadgeCheck className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2} />
        <span>Editorial QC</span>
      </span>
    );
  }
  return (
    <div
      className={`inline-flex items-center gap-3 rounded-md border border-border/60 bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground ${className}`}
      aria-label="SecretPDF editorial quality: passed QC, verified PDF, age-checked"
    >
      <span className="flex items-center gap-1">
        <BadgeCheck className="h-4 w-4 text-emerald-600" strokeWidth={2} />
        <span>QC passed</span>
      </span>
      <span className="flex items-center gap-1">
        <FileCheck2 className="h-4 w-4 text-emerald-600" strokeWidth={2} />
        <span>Verified PDF</span>
      </span>
      <span className="flex items-center gap-1">
        <ShieldCheck className="h-4 w-4 text-emerald-600" strokeWidth={2} />
        <span>Age-checked</span>
      </span>
    </div>
  );
}

export default EditorialQualityBadge;
