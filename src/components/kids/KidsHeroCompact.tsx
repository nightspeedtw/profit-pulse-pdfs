import heroBoyAsset from "@/assets/secretpdf-kids-hero-boy.png.asset.json";

interface Props {
  onCtaClick: () => void;
}

/**
 * Compact Kids hero (owner spec 2026-07-20).
 * - Mobile: portrait hero art of the boy reading, HTML copy on the calm
 *   dark area, target 520–620px height. Never 100vh.
 * - Desktop: 44/56 split — copy left, art right; target 420–520px height.
 * - No baked typography in the image; everything below is accessible HTML.
 * - Original story-garden palette: midnight indigo → violet → amber accent.
 */
export default function KidsHeroCompact({ onCtaClick }: Props) {
  return (
    <section
      aria-labelledby="kids-hero-title"
      className="relative w-full overflow-hidden bg-[#0f0b2e]"
    >
      {/* Ambient glow */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#1a1148] via-[#0f0b2e] to-[#0a0722]" aria-hidden="true" />
      <div className="pointer-events-none absolute -top-24 -left-16 h-72 w-72 rounded-full bg-violet-500/20 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-24 -right-16 h-72 w-72 rounded-full bg-amber-400/20 blur-3xl" aria-hidden="true" />

      {/* MOBILE (< md): stacked portrait hero */}
      <div className="md:hidden relative">
        <div className="relative h-[560px] w-full overflow-hidden">
          <img
            src={heroBoyAsset.url}
            alt="A curious boy reading a glowing storybook in a magical night garden"
            className="absolute inset-0 h-full w-full object-cover object-center"
            fetchPriority="high"
            decoding="async"
          />
          {/* Dark gradient ONLY behind copy — face stays lit */}
          <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[#0a0722]/85 via-[#0a0722]/55 to-transparent" aria-hidden="true" />
        </div>

        <div className="absolute inset-x-0 top-0 px-5 pt-8 pb-6 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-300/90">
            Made for curious young minds
          </p>
          <h1
            id="kids-hero-title"
            className="mt-2 font-serif text-[28px] leading-[1.1] text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.55)]"
          >
            Books that make little minds light up
          </h1>
          <p className="mx-auto mt-2 max-w-[22rem] text-[13px] leading-snug text-white/85 drop-shadow-[0_1px_6px_rgba(0,0,0,0.6)]">
            Find stories, coloring books, activities, and learning adventures made for every age.
          </p>
        </div>

        <div className="absolute inset-x-0 bottom-4 flex justify-center px-5">
          <button
            type="button"
            onClick={onCtaClick}
            className="min-h-11 rounded-full bg-amber-400 px-6 py-2.5 text-sm font-semibold text-[#1a1148] shadow-lg shadow-amber-500/30 transition hover:bg-amber-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
          >
            Explore kids' books
          </button>
        </div>
      </div>

      {/* DESKTOP (>= md): 44/56 split */}
      <div className="hidden md:grid relative mx-auto max-w-6xl grid-cols-12 items-center gap-6 px-6 py-10 lg:py-14 min-h-[420px]">
        <div className="col-span-12 md:col-span-5 relative z-10">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-300">
            Made for curious young minds
          </p>
          <h1
            className="mt-3 font-serif text-4xl lg:text-5xl leading-[1.05] text-white"
          >
            Books that make little minds light up
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-white/85">
            Find stories, coloring books, activities, and learning adventures made for every age.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onCtaClick}
              className="min-h-11 rounded-full bg-amber-400 px-6 py-2.5 text-sm font-semibold text-[#1a1148] shadow-lg shadow-amber-500/30 transition hover:bg-amber-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
            >
              Explore kids' books
            </button>
            <p className="text-xs text-white/60">Instant PDF download · Print at home</p>
          </div>
        </div>

        <div className="col-span-12 md:col-span-7 relative">
          <div className="relative mx-auto aspect-[4/5] max-h-[460px] w-full max-w-[520px] overflow-hidden rounded-3xl ring-1 ring-white/10 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)]">
            <img
              src={heroBoyAsset.url}
              alt="A curious boy reading a glowing storybook in a magical night garden"
              className="absolute inset-0 h-full w-full object-cover object-center"
              fetchPriority="high"
              decoding="async"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
