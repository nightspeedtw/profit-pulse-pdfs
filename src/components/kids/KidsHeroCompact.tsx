interface Props {
  onCtaClick: () => void;
}

/**
 * Owner hero banner (2026-07-20).
 * The uploaded image already contains the headline, branding, and visual story.
 * We render it as a full-width responsive image and layer only the CTA button.
 */
export default function KidsHeroCompact({ onCtaClick }: Props) {
  return (
    <section aria-label="Kids hero" className="relative w-full overflow-hidden">
      <div className="relative w-full">
        <img
          src="/site-assets/kids-hero-spark-dreams.png"
          alt="Stories that spark dreams and imagination — magical books for young explorers"
          className="w-full h-auto object-cover object-center"
          fetchPriority="high"
          decoding="async"
        />

        {/* CTA button — anchored to the bottom-center of the artwork */}
        <div className="absolute inset-x-0 bottom-4 flex justify-center px-4 sm:bottom-6 md:bottom-8">
          <button
            type="button"
            onClick={onCtaClick}
            className="min-h-11 rounded-full bg-amber-400 px-6 py-2.5 text-sm font-semibold text-[#1a1148] shadow-lg shadow-amber-500/30 transition hover:bg-amber-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
          >
            Explore kids' books
          </button>
        </div>
      </div>
    </section>
  );
}
