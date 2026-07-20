import { useEffect, useRef } from "react";
import heroImage from "@/assets/kids-hero-spark-dreams-v2.png.asset.json";
import heroMobileImage from "@/assets/kids-hero-mobile-v1.png.asset.json";

interface Props {
  onCtaClick: () => void;
}

/**
 * Kids hero — magical night storybook.
 * Portrait artwork on mobile, wide artwork on md+. Headline is baked in.
 * A layered fantasy effect system (radial glow, floating sparkles, shimmer,
 * blur orbs, subtle desktop parallax) is composed *around* the artwork so
 * readability, CTAs, and Core Web Vitals stay intact. All effects respect
 * prefers-reduced-motion and are pointer-events:none.
 */
export default function KidsHeroCompact({ onCtaClick }: Props) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const parallaxRef = useRef<HTMLDivElement | null>(null);

  // Desktop-only, motion-safe mouse parallax on the glow/orb layer.
  useEffect(() => {
    const frame = frameRef.current;
    const layer = parallaxRef.current;
    if (!frame || !layer) return;
    const mq = window.matchMedia("(hover: hover) and (pointer: fine) and (min-width: 768px)");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!mq.matches || reduce.matches) return;
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      const r = frame.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width - 0.5) * 2;   // -1..1
      const y = ((e.clientY - r.top) / r.height - 0.5) * 2;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        layer.style.transform = `translate3d(${x * 10}px, ${y * 8}px, 0)`;
      });
    };
    const onLeave = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        layer.style.transform = "translate3d(0,0,0)";
      });
    };
    frame.addEventListener("mousemove", onMove);
    frame.addEventListener("mouseleave", onLeave);
    return () => {
      frame.removeEventListener("mousemove", onMove);
      frame.removeEventListener("mouseleave", onLeave);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section aria-label="Kids hero" className="relative w-full overflow-hidden">
      <style>{`
        @keyframes kidsHeroFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
        @keyframes kidsHeroDrift { 0%{transform:translate3d(0,0,0)} 50%{transform:translate3d(6px,-10px,0)} 100%{transform:translate3d(0,0,0)} }
        @keyframes kidsHeroShimmer { 0%{transform:translateX(-120%)} 100%{transform:translateX(120%)} }
        @keyframes kidsHeroSparkle { 0%,100%{opacity:.15;transform:translateY(0) scale(.9)} 50%{opacity:1;transform:translateY(-14px) scale(1.15)} }
        @keyframes kidsHeroOrb { 0%,100%{transform:translate3d(0,0,0) scale(1);opacity:.55} 50%{transform:translate3d(12px,-14px,0) scale(1.06);opacity:.8} }
        .kids-hero-float { animation: kidsHeroFloat 7s ease-in-out infinite; }
        .kids-hero-orb { animation: kidsHeroOrb 11s ease-in-out infinite; }
        .kids-hero-orb.delay-1 { animation-duration: 14s; animation-delay: -3s; }
        .kids-hero-orb.delay-2 { animation-duration: 17s; animation-delay: -6s; }
        .kids-hero-shimmer::after {
          content:""; position:absolute; inset:0;
          background: linear-gradient(115deg, transparent 30%, rgba(255,236,178,.28) 48%, rgba(255,255,255,.55) 50%, rgba(255,236,178,.28) 52%, transparent 70%);
          mix-blend-mode: screen;
          transform: translateX(-120%);
          animation: kidsHeroShimmer 6s ease-in-out infinite;
          animation-delay: 1.2s;
        }
        .kids-hero-sparkle { animation: kidsHeroSparkle 4.5s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .kids-hero-float, .kids-hero-orb, .kids-hero-sparkle { animation: none !important; }
          .kids-hero-shimmer::after { animation: none !important; opacity: 0; }
        }
      `}</style>

      <div className="relative w-full mx-auto max-w-[1600px] px-0 md:px-4">
        <div
          ref={frameRef}
          className="relative w-full overflow-hidden md:rounded-3xl bg-[#0d0a2f] shadow-[0_30px_80px_-30px_rgba(50,20,140,0.55)]"
        >
          {/* Layered night-sky gradient base */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(120% 80% at 50% 0%, #1a1160 0%, #0d0a2f 55%, #06031a 100%)",
            }}
          />

          {/* Parallax glow + orb layer (desktop mouse-tracked) */}
          <div
            ref={parallaxRef}
            aria-hidden
            className="pointer-events-none absolute inset-0 transition-transform duration-300 ease-out will-change-transform"
          >
            {/* Central magical bloom behind the artwork */}
            <div
              className="absolute left-1/2 top-1/2 h-[70%] w-[70%] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl kids-hero-orb"
              style={{
                background:
                  "radial-gradient(circle, rgba(255,208,120,0.35) 0%, rgba(154,110,255,0.28) 35%, rgba(46,28,120,0) 70%)",
              }}
            />
            {/* Warm golden bloom (right/center — over the magical book area) */}
            <div
              className="absolute left-[58%] top-[45%] h-[45%] w-[45%] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl kids-hero-orb delay-1"
              style={{
                background:
                  "radial-gradient(circle, rgba(255,225,150,0.55) 0%, rgba(255,170,90,0.18) 45%, rgba(0,0,0,0) 75%)",
              }}
            />
            {/* Cool violet orb (left) */}
            <div
              className="absolute left-[18%] top-[28%] h-[38%] w-[38%] rounded-full blur-3xl kids-hero-orb delay-2"
              style={{
                background:
                  "radial-gradient(circle, rgba(120,90,255,0.45) 0%, rgba(60,30,160,0.15) 50%, rgba(0,0,0,0) 78%)",
              }}
            />
            {/* Indigo haze bottom */}
            <div
              className="absolute inset-x-0 bottom-0 h-1/2 blur-2xl opacity-70"
              style={{
                background:
                  "radial-gradient(60% 100% at 50% 100%, rgba(80,50,200,0.35) 0%, rgba(13,10,47,0) 70%)",
              }}
            />
          </div>

          {/* Hero artwork — gentle float + shimmer overlay wrapper */}
          <div className="relative kids-hero-float">
            <div className="relative kids-hero-shimmer">
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
          </div>

          {/* Floating sparkles / fairy dust — decorative, above art but below CTA */}
          <div aria-hidden className="pointer-events-none absolute inset-0">
            {SPARKLES.map((s, i) => (
              <span
                key={i}
                className="absolute rounded-full kids-hero-sparkle"
                style={{
                  left: `${s.x}%`,
                  top: `${s.y}%`,
                  width: `${s.size}px`,
                  height: `${s.size}px`,
                  background:
                    "radial-gradient(circle, rgba(255,244,200,1) 0%, rgba(255,220,140,.9) 40%, rgba(255,180,80,0) 70%)",
                  boxShadow:
                    "0 0 8px rgba(255,225,150,0.9), 0 0 18px rgba(255,190,110,0.55)",
                  animationDelay: `${s.delay}s`,
                  animationDuration: `${s.duration}s`,
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
          {/* Soft sparkle accents around the CTA card */}
          <span
            aria-hidden
            className="pointer-events-none absolute -left-2 -top-2 h-2 w-2 rounded-full kids-hero-sparkle"
            style={{
              background:
                "radial-gradient(circle, rgba(255,235,170,1), rgba(255,180,80,0) 70%)",
              boxShadow: "0 0 10px rgba(255,210,120,.9)",
            }}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute -right-1 top-3 h-1.5 w-1.5 rounded-full kids-hero-sparkle"
            style={{
              background:
                "radial-gradient(circle, rgba(210,200,255,1), rgba(120,90,255,0) 70%)",
              boxShadow: "0 0 8px rgba(180,160,255,.9)",
              animationDelay: "1.5s",
            }}
          />
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

// Deterministic sparkle field — hand-tuned so nothing sits over the baked
// headline area (roughly the center of the wide art) or over faces.
const SPARKLES: Array<{ x: number; y: number; size: number; delay: number; duration: number }> = [
  { x: 8,  y: 18, size: 4, delay: 0.0, duration: 4.2 },
  { x: 14, y: 62, size: 3, delay: 1.4, duration: 5.0 },
  { x: 22, y: 12, size: 2, delay: 0.8, duration: 4.6 },
  { x: 30, y: 78, size: 3, delay: 2.2, duration: 5.4 },
  { x: 44, y: 8,  size: 2, delay: 0.4, duration: 4.8 },
  { x: 55, y: 70, size: 4, delay: 1.8, duration: 5.2 },
  { x: 68, y: 20, size: 3, delay: 0.6, duration: 4.4 },
  { x: 76, y: 58, size: 2, delay: 2.6, duration: 5.6 },
  { x: 84, y: 30, size: 4, delay: 1.0, duration: 4.9 },
  { x: 91, y: 74, size: 3, delay: 2.0, duration: 5.1 },
  { x: 38, y: 40, size: 2, delay: 3.0, duration: 6.0 },
  { x: 62, y: 44, size: 2, delay: 0.2, duration: 5.5 },
];
