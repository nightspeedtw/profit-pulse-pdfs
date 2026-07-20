import logoFull from "@/assets/secretpdf-kids-logo-v2.png.asset.json";
import logoMark from "@/assets/secretpdf-kids-mark.png.asset.json";
import { cn } from "@/lib/utils";

/**
 * Official SecretPDF Kids brand lockup — the exact owner-approved asset.
 * Never AI-regenerated. Use `variant="mark"` for square chips (favicons,
 * avatars); `variant="full"` for headers / hero sections / product headers.
 */
export function KidsBrand({
  variant = "full",
  className,
  alt = "SecretPDF Kids",
}: {
  variant?: "full" | "mark";
  className?: string;
  alt?: string;
}) {
  const src = variant === "mark" ? logoMark.url : logoFull.url;
  return (
    <img
      src={src}
      alt={alt}
      loading="eager"
      decoding="async"
      className={cn(variant === "mark" ? "h-8 w-8" : "h-12 md:h-14 w-auto", className)}
    />
  );
}

export const KIDS_BRAND_URLS = {
  full: logoFull.url,
  mark: logoMark.url,
} as const;
