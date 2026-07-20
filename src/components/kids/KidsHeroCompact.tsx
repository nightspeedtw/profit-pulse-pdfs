import heroImage from "@/assets/kids-hero-desktop-v3.png.asset.json";
import heroMobileImage from "@/assets/kids-hero-mobile-v1.png.asset.json";

interface Props {
  onCtaClick: () => void;
}

/**
 * Kids hero — magical night storybook.
 * Portrait artwork on mobile, wide artwork on md+. Headline is baked in.
 *
 * Motion policy (per owner): NO drifting/parallax/float on the artwork —
 * only gentle firefly sparkles that rise upward with a soft pulse. Any
 * side-to-side motion caused headaches, so it is removed permanently.
 */
export default function KidsHeroCompact({ onCtaClick }: Props) {
  return (
    <section aria-label="Kids hero" className="relative w-full overflow-hidden">
      <style>{`
        /* Fireflies: rise straight up + fade, with a soft twinkle. Two rise
           speeds so nearby particles don't move in lockstep. No lateral drift. */
        @keyframes kfRise {
          0%   { transform: translate3d(0, 0, 0);      opacity: 0; }
          15%  { opacity: .9; }
          85%  { opacity: .9; }
          100% { transform: translate3d(0, -160px, 0); opacity: 0; }
        }
        @keyframes kfTwinkle { 0%,100%{filter:brightness(.85)} 50%{filter:brightness(1.25)} }
        .kf { position:absolute; border-radius:9999px; pointer-events:none; will-change:transform,opacity; }
        .kf-glow { box-shadow: 0 0 6px rgba(255,225,150,.85), 0 0 14px rgba(255,200,110,.5); }
        .kf-cool { box-shadow: 0 0 6px rgba(200,220,255,.85), 0 0 14px rgba(150,180,255,.45); }
        .kf-rise-slow { animation: kfRise 14s linear infinite, kfTwinkle 4.5s ease-in-out infinite; }
        .kf-rise-med  { animation: kfRise 11s linear infinite, kfTwinkle 5.5s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .kf-rise-slow, .kf-rise-med { animation: none !important; opacity: .6 !important; }
        }
      `}</style>

      <div className="relative w-full mx-auto max-w-[1600px] px-0 md:px-4">
        <div className="relative w-full overflow-hidden md:rounded-3xl bg-[#0d0a2f] shadow-[0_30px_80px_-30px_rgba(50,20,140,0.55)]">
          {/* Layered night-sky gradient base */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(120% 80% at 50% 0%, #1a1160 0%, #0d0a2f 55%, #06031a 100%)",
            }}
          />

          {/* Hero artwork — completely still. */}
          <div className="relative">
            {/* Mobile portrait */}
            <img
              src={heroMobileImage.url}
              alt="Stories that spark dreams and imagination — magical books for young explorers"
              className="relative block w-full h-auto md:hidden"
              fetchPriority="high"
              decoding="async"
            />
            {/* Tablet/desktop wide */}
            <img
              src={heroImage.url}
              alt="Stories that spark dreams and imagination — magical books for young explorers"
              className="relative hidden md:block w-full h-auto max-h-[560px] object-cover object-center"
              fetchPriority="high"
              decoding="async"
            />
          </div>

          {/* Fireflies — sparse, warm-gold with a few cool accents. Rise only. */}
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            {FIREFLIES.map((f, i) => (
              <span
                key={i}
                className={`kf ${f.tone === "cool" ? "kf-cool" : "kf-glow"} ${
                  f.speed === "slow" ? "kf-rise-slow" : "kf-rise-med"
                } ${f.mobile ? "" : "hidden md:block"}`}
                style={{
                  left: `${f.x}%`,
                  top: `${f.y}%`,
                  width: `${f.size}px`,
                  height: `${f.size}px`,
                  background:
                    f.tone === "cool"
                      ? "radial-gradient(circle, rgba(230,240,255,1) 0%, rgba(180,200,255,.85) 45%, rgba(120,150,255,0) 75%)"
                      : "radial-gradient(circle, rgba(255,246,210,1) 0%, rgba(255,220,140,.9) 45%, rgba(255,180,80,0) 75%)",
                  animationDelay: `${f.delay}s, ${f.pulseDelay}s`,
                }}
              />
            ))}
          </div>

          {/* Bottom fade so the CTA band blends into the hero without hiding art */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#0d0a2f]/80 to-transparent" />
        </div>
      </div>


      {/* CTA band — sits under the hero image, never covering characters */}
      <div className="mx-auto max-w-[1600px] px-4 -mt-8 md:-mt-10 relative z-10">
        <div className="relative mx-auto flex max-w-2xl flex-col items-center gap-3 rounded-2xl bg-white/90 px-6 py-5 shadow-[0_20px_50px_-24px_rgba(23,16,82,0.35)] ring-1 ring-[#DED7F2] backdrop-blur">
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

// Fireflies — sparse, positioned along the lower/side bands so they rise up
// through open sky without crossing the baked headline or character faces.
const FIREFLIES: Array<{
  x: number; y: number; size: number;
  delay: number; pulseDelay: number;
  speed: "slow" | "med";
  tone: "warm" | "cool";
  mobile?: boolean;
}> = [
  // warm-gold fireflies (majority) — start lower, rise up
  { x:  6, y: 78, size: 3, delay: 0.0,  pulseDelay: 0.2, speed: "slow", tone: "warm", mobile: true },
  { x: 14, y: 88, size: 4, delay: 3.5,  pulseDelay: 1.1, speed: "med",  tone: "warm", mobile: true },
  { x: 22, y: 72, size: 2, delay: 6.0,  pulseDelay: 2.0, speed: "slow", tone: "warm" },
  { x: 30, y: 92, size: 3, delay: 1.8,  pulseDelay: 0.6, speed: "med",  tone: "warm", mobile: true },
  { x: 42, y: 82, size: 2, delay: 8.0,  pulseDelay: 3.0, speed: "slow", tone: "warm" },
  { x: 58, y: 90, size: 3, delay: 4.5,  pulseDelay: 1.5, speed: "med",  tone: "warm", mobile: true },
  { x: 70, y: 76, size: 2, delay: 2.4,  pulseDelay: 2.4, speed: "slow", tone: "warm" },
  { x: 80, y: 86, size: 4, delay: 7.2,  pulseDelay: 0.9, speed: "med",  tone: "warm" },
  { x: 88, y: 70, size: 3, delay: 5.0,  pulseDelay: 1.7, speed: "slow", tone: "warm", mobile: true },
  { x: 94, y: 84, size: 2, delay: 9.5,  pulseDelay: 0.4, speed: "med",  tone: "warm" },
  // cool pale-blue accents
  { x: 36, y: 68, size: 2, delay: 10.0, pulseDelay: 2.2, speed: "slow", tone: "cool" },
  { x: 66, y: 66, size: 2, delay: 3.0,  pulseDelay: 3.4, speed: "med",  tone: "cool" },
];
