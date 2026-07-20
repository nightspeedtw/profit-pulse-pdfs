import heroImage from "@/assets/kids-hero-spark-dreams-v2.png.asset.json";
import heroMobileImage from "@/assets/kids-hero-mobile-v1.png.asset.json";

interface Props {
  onCtaClick: () => void;
}

/**
 * Kids hero — magical night storybook.
 * Uses a tall portrait artwork on mobile and the wide artwork on md+.
 * Both variants have the headline baked in; the CTA sits in a band below.
 */
export default function KidsHeroCompact({ onCtaClick }: Props) {
  return (
    <section aria-label="Kids hero" className="relative w-full overflow-hidden">
      <div className="relative w-full mx-auto max-w-[1600px] px-0 md:px-4">
        <div className="relative w-full overflow-hidden md:rounded-3xl bg-[#0d0a2f]">
          {/* Mobile portrait */}
          <img
            src={heroMobileImage.url}
            alt="Stories that spark dreams and imagination — magical books for young explorers"
            className="block w-full h-auto md:hidden"
            fetchPriority="high"
            decoding="async"
          />
          {/* Tablet/desktop wide */}
          <img
            src={heroImage.url}
            alt="Stories that spark dreams and imagination — magical books for young explorers"
            className="hidden md:block w-full h-auto max-h-[560px] object-cover object-center"
            fetchPriority="high"
            decoding="async"
          />
          {/* Bottom fade so the CTA band blends into the hero without hiding art */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#0d0a2f]/70 to-transparent" />
        </div>
      </div>


      {/* CTA band — sits under the hero image, never covering characters */}
      <div className="mx-auto max-w-[1600px] px-4 -mt-8 md:-mt-10 relative z-10">
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 rounded-2xl bg-white/90 px-6 py-5 shadow-[0_20px_50px_-24px_rgba(23,16,82,0.35)] ring-1 ring-[#DED7F2] backdrop-blur">
          <button
            type="button"
            onClick={onCtaClick}
            className="kids-cta-gold min-h-12 rounded-full px-7 text-base font-semibold"
          >
            Explore kids' books
          </button>
          <p className="text-center text-sm text-[#6F688C]">
            Instant printable stories, coloring books, activities, and learning adventures.
          </p>
        </div>
      </div>
    </section>
  );
}
