import { Printer } from "lucide-react";

/**
 * Notice pill placed under the cover on the coloring product page so shoppers
 * understand interior pages are black-and-white line art (not colored art).
 * Truthful, no marketing embellishment.
 */
export default function BWPreviewNotice() {
  return (
    <div className="flex items-start gap-2 border-2 border-foreground bg-highlight px-3 py-2 rounded-md">
      <Printer className="h-4 w-4 mt-0.5 flex-shrink-0" strokeWidth={2} />
      <p className="text-sm leading-snug">
        <span className="font-bold">Interior pages are black-and-white coloring designs</span>
        , ready to print at home.
      </p>
    </div>
  );
}
