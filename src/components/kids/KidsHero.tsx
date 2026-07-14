import { useEffect, useState } from "react";

const STARS = Array.from({ length: 26 }, (_, i) => ({
  left: (i * 37) % 100,
  top: (i * 53) % 55,
  size: 2 + ((i * 7) % 3),
  delay: (i % 9) * 0.6,
  dur: 2.4 + (i % 5) * 0.7,
}));

const FIREFLIES = [
  { left: "18%", delay: 0, dur: 10 },
  { left: "52%", delay: 2.5, dur: 12 },
  { left: "78%", delay: 5, dur: 8 },
];

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
    <section className="relative w-full overflow-hidden" style={{ minHeight: "100svh" }}>
      <style>{`
        @keyframes kh-twinkle { 0%,100%{opacity:.15;transform:scale(.8)} 50%{opacity:.9;transform:scale(1.15)} }
        @keyframes kh-bob { 0%,100%{transform:translateY(0) rotate(var(--tilt))} 50%{transform:translateY(-14px) rotate(calc(var(--tilt) + 2deg))} }
        @keyframes kh-glow { 0%,100%{box-shadow:0 8px 28px rgba(255,166,97,.45)} 50%{box-shadow:0 8px 44px rgba(255,166,97,.75)} }
        @keyframes kh-rise { from{opacity:0;transform:translateY(22px)} to{opacity:1;transform:translateY(0)} }
        @keyframes kh-drift {
          0%   { transform: translateY(0) translateX(0); opacity: 0; }
          15%  { opacity: .9; }
          50%  { transform: translateY(-40vh) translateX(12px); opacity: .7; }
          85%  { opacity: .5; }
          100% { transform: translateY(-80vh) translateX(-8px); opacity: 0; }
        }
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
      {/* readability gradient — stronger at top so headline pops */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#081326]/70 via-transparent to-[#0b1035]/92" />

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

      {/* drifting fireflies */}
      {FIREFLIES.map((f, i) => (
        <span
          key={`ff-${i}`}
          aria-hidden
          className="kh-anim absolute rounded-full"
          style={{
            left: f.left,
            bottom: "35%",
            width: 6,
            height: 6,
            background: "radial-gradient(circle, #ffe8a8 0%, rgba(255,200,120,.6) 40%, transparent 70%)",
            boxShadow: "0 0 12px 3px rgba(255,210,120,.55)",
            animation: `kh-drift ${f.dur}s ease-in-out ${f.delay}s infinite`,
          }}
        />
      ))}

      {/* floating real book covers (desktop only) */}
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

      {/* content — flex column, text top / illustration middle / CTA docked bottom */}
      <div
        className="relative z-10 flex flex-col justify-between px-5 text-center"
        style={{ minHeight: "100svh" }}
      >
        {/* TOP: text block */}
        <div
          className="mx-auto max-w-3xl pt-20 md:pt-24"
          style={{ animation: loaded ? "kh-rise .7s ease-out both" : undefined }}
        >
          <p
            className="mb-2 text-sm font-semibold text-amber-200/90"
            style={{ fontFamily: "'Mali', cursive" }}
          >
            ✦ นิทานพรีเมียม 8.5 × 8.5 นิ้ว ✦
          </p>
          <h1
            className="text-[2.35rem] leading-[1.15] text-white md:text-6xl"
            style={{ fontFamily: "'Mali', cursive", fontWeight: 700 }}
          >
            นิทานที่ลูกจะขอ<br />
            <span className="relative inline-block">
              <span className="bg-gradient-to-r from-amber-300 via-orange-300 to-pink-300 bg-clip-text text-transparent">
                ให้อ่านซ้ำ
              </span>
              <svg
                className="absolute -bottom-2 left-0 w-full"
                viewBox="0 0 120 10"
                aria-hidden
              >
                <path d="M3 7 Q 60 -2 117 6" stroke="url(#khg)" strokeWidth="4" strokeLinecap="round" fill="none" />
                <defs>
                  <linearGradient id="khg" x1="0" x2="1">
                    <stop offset="0" stopColor="#fcd34d" />
                    <stop offset="1" stopColor="#f9a8d4" />
                  </linearGradient>
                </defs>
              </svg>
            </span>{" "}ทุกคืน
          </h1>
          <p
            className="mx-auto mt-3 max-w-md text-[15px] text-white/85 md:text-lg"
            style={{ fontFamily: "'Baloo 2', sans-serif" }}
          >
            เขียนเพื่อวัยของลูกโดยเฉพาะ · ภาพสีทั้งเล่ม · ดาวน์โหลดอ่านได้ทันที
          </p>
        </div>

        {/* MIDDLE: intentionally empty — the illustration shows here */}

        {/* BOTTOM: docked CTA */}
        <div className="mx-auto w-full max-w-md pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <button
            onClick={onStart}
            className="kh-anim w-full rounded-2xl bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400 py-4 text-lg font-bold text-[#3a1d00] transition-transform hover:scale-[1.03] active:scale-95"
            style={{ animation: "kh-glow 2.6s ease-in-out infinite", fontFamily: "'Mali', cursive" }}
          >
            หาหนังสือที่ใช่สำหรับลูกคุณ →
          </button>
          <div className="mt-3 flex items-center justify-center gap-x-4 text-[13px] text-white/85">
            <span>✅ อ่านตัวอย่างฟรี</span>
            <span>✅ ดาวน์โหลดทันที</span>
            <span>✅ ภาพสีทั้งเล่ม</span>
          </div>
        </div>
      </div>

      {/* soft wave into next section — behind the docked CTA */}
      <svg
        className="absolute bottom-0 left-0 z-0 w-full"
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
