import { useEffect, useState } from "react";

const STARS = Array.from({ length: 26 }, (_, i) => ({
  left: (i * 37) % 100,
  top: (i * 53) % 55,
  size: 2 + ((i * 7) % 3),
  delay: (i % 9) * 0.6,
  dur: 2.4 + (i % 5) * 0.7,
}));

interface Props {
  covers?: string[];
  onStart: () => void;
}

export default function KidsHero({ covers = [], onStart }: Props) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 60);
    return () => clearTimeout(t);
  }, []);
  const floats = covers.slice(0, 4);

  return (
    <section className="relative w-full overflow-hidden" style={{ minHeight: "92svh" }}>
      <style>{`
        @keyframes kh-twinkle { 0%,100%{opacity:.15;transform:scale(.8)} 50%{opacity:.9;transform:scale(1.15)} }
        @keyframes kh-bob { 0%,100%{transform:translateY(0) rotate(var(--tilt))} 50%{transform:translateY(-14px) rotate(calc(var(--tilt) + 2deg))} }
        @keyframes kh-glow { 0%,100%{box-shadow:0 8px 28px rgba(255,166,97,.45)} 50%{box-shadow:0 8px 44px rgba(255,166,97,.75)} }
        @keyframes kh-rise { from{opacity:0;transform:translateY(22px)} to{opacity:1;transform:translateY(0)} }
        @media (prefers-reduced-motion: reduce) { .kh-anim { animation: none !important; } }
      `}</style>

      {/* AI illustration background */}
      <picture>
        <source media="(min-width: 768px)" srcSet="/site-assets/kids-hero-desktop.jpg" />
        <img
          src="/site-assets/kids-hero-mobile.jpg"
          alt=""
          fetchPriority="high"
          className="absolute inset-0 h-full w-full object-cover object-center"
        />
      </picture>
      {/* readability gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#0b1035]/55 via-transparent to-[#0b1035]/92" />

      {/* twinkling stars */}
      {STARS.map((s, i) => (
        <span
          key={i}
          aria-hidden
          className="kh-anim absolute rounded-full bg-white"
          style={{
            left: `${s.left}%`,
            top: `${s.top}%`,
            width: s.size,
            height: s.size,
            animation: `kh-twinkle ${s.dur}s ease-in-out ${s.delay}s infinite`,
          }}
        />
      ))}

      {/* floating real book covers (desktop) */}
      <div className="pointer-events-none absolute inset-0 hidden md:block">
        {floats.map((src, i) => (
          <img
            key={i}
            src={src}
            alt=""
            loading="lazy"
            className="kh-anim absolute w-28 lg:w-36 rounded-xl shadow-2xl ring-2 ring-white/30"
            style={{
              ["--tilt" as string]: `${i % 2 ? -7 : 6}deg`,
              left: ["6%", "84%", "10%", "80%"][i],
              top: ["16%", "12%", "58%", "55%"][i],
              animation: `kh-bob ${6 + i}s ease-in-out ${i * 0.9}s infinite`,
            } as React.CSSProperties}
          />
        ))}
      </div>

      {/* content */}
      <div
        className="relative z-10 mx-auto flex max-w-3xl flex-col items-center px-5 pt-[16svh] pb-24 text-center"
        style={{ animation: loaded ? "kh-rise .7s ease-out both" : undefined }}
      >
        <span className="mb-4 rounded-full border border-white/25 bg-white/10 px-4 py-1.5 text-xs font-semibold tracking-wide text-white/90 backdrop-blur">
          ✦ PREMIUM PICTURE BOOKS · 8.5 × 8.5"
        </span>
        <h1
          className="text-4xl leading-tight text-white md:text-6xl"
          style={{ fontFamily: "'Mali', cursive", fontWeight: 700 }}
        >
          นิทานที่ลูกจะขอ<br />
          <span className="bg-gradient-to-r from-amber-300 via-orange-300 to-pink-300 bg-clip-text text-transparent">
            ให้อ่านซ้ำ
          </span>
          ทุกคืน
        </h1>
        <p
          className="mt-4 max-w-md text-base text-white/85 md:text-lg"
          style={{ fontFamily: "'Baloo 2', sans-serif" }}
        >
          Picture books your child will beg to re-read. พรีเมียมสีทั้งเล่ม · ดาวน์โหลดทันที · เขียนเพื่อวัยของลูกโดยเฉพาะ
        </p>
        <button
          onClick={onStart}
          className="kh-anim mt-8 rounded-full bg-gradient-to-r from-amber-400 to-orange-400 px-9 py-4 text-lg font-bold text-[#3a1d00] transition-transform hover:scale-105 active:scale-95"
          style={{ animation: "kh-glow 2.6s ease-in-out infinite", fontFamily: "'Mali', cursive" }}
        >
          หาหนังสือที่ใช่สำหรับลูกคุณ →
        </button>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-white/80">
          <span>📖 อ่านตัวอย่างฟรี</span>
          <span>⚡ ดาวน์โหลดทันที</span>
          <span>🎨 ภาพสีทั้งเล่ม</span>
        </div>
      </div>

      {/* soft wave into next section */}
      <svg
        className="absolute bottom-0 left-0 w-full"
        viewBox="0 0 1440 90"
        fill="none"
        preserveAspectRatio="none"
        aria-hidden
      >
        <path
          d="M0,48 C240,88 480,8 720,40 C960,72 1200,20 1440,52 L1440,90 L0,90 Z"
          fill="hsl(var(--background))"
        />
      </svg>
    </section>
  );
}
