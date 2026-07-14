import { Sparkles, BookOpen, Download } from "lucide-react";

interface Props {
  covers: string[];
  onCTA: () => void;
}

const ORBITS = [
  { cls: "top-[6%]  left-[6%]  w-24 h-24 md:w-32 md:h-32 animate-float-slow", delay: "0s",   rot: "-8deg" },
  { cls: "top-[10%] right-[8%] w-28 h-28 md:w-36 md:h-36 animate-float-med",  delay: "0.6s", rot: "6deg" },
  { cls: "bottom-[18%] left-[10%] w-20 h-20 md:w-28 md:h-28 animate-float-fast", delay: "1.2s", rot: "10deg" },
  { cls: "bottom-[8%]  right-[14%] w-24 h-24 md:w-32 md:h-32 animate-float-slow", delay: "1.6s", rot: "-6deg" },
  { cls: "top-[42%] right-[3%] w-16 h-16 md:w-24 md:h-24 animate-float-med",   delay: "0.3s", rot: "4deg" },
];

const SPARKS = Array.from({ length: 18 });

export const KidsHero = ({ covers, onCTA }: Props) => {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-[hsl(212,55%,12%)] via-[hsl(220,55%,20%)] to-[hsl(188,63%,44%)] text-white">
      {/* twinkles */}
      <div className="absolute inset-0 pointer-events-none motion-reduce:hidden">
        {SPARKS.map((_, i) => {
          const top = (i * 53) % 100;
          const left = (i * 37) % 100;
          const delay = (i % 7) * 0.4;
          const size = 6 + (i % 4) * 2;
          return (
            <span
              key={i}
              className="absolute rounded-full bg-white/80 animate-twinkle"
              style={{
                top: `${top}%`,
                left: `${left}%`,
                width: size,
                height: size,
                animationDelay: `${delay}s`,
                boxShadow: "0 0 12px rgba(255,255,255,0.9)",
              }}
            />
          );
        })}
      </div>

      {/* floating covers */}
      <div className="absolute inset-0 pointer-events-none motion-reduce:hidden hidden sm:block">
        {ORBITS.map((o, i) => {
          const cover = covers[i % Math.max(covers.length, 1)];
          if (!cover) return null;
          return (
            <div
              key={i}
              className={`absolute ${o.cls} rounded-lg overflow-hidden shadow-2xl ring-2 ring-white/40`}
              style={{ animationDelay: o.delay, transform: `rotate(${o.rot})` }}
            >
              <img src={cover} alt="" className="w-full h-full object-cover" loading="eager" />
            </div>
          );
        })}
      </div>

      <div className="container relative py-20 md:py-28 lg:py-32 text-center max-w-3xl">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/15 backdrop-blur border border-white/30 text-xs font-mono uppercase tracking-widest mb-6 animate-pop-in">
          <Sparkles className="h-3.5 w-3.5" /> Premium picture books · 8.5 × 8.5"
        </div>
        <h1 className="font-display text-4xl sm:text-5xl md:text-6xl lg:text-7xl leading-[1.05] mb-4 animate-fade-in-up">
          นิทานที่ลูกจะขอ<br className="hidden sm:block" />
          <span className="italic text-[hsl(48,100%,75%)]">ให้อ่านซ้ำ</span>ทุกคืน
        </h1>
        <p className="text-base sm:text-lg text-white/85 mb-2 animate-fade-in-up" style={{ animationDelay: "0.15s" }}>
          Picture books your child will beg to re-read.
        </p>
        <p className="text-sm text-white/75 mb-8 animate-fade-in-up" style={{ animationDelay: "0.25s" }}>
          พรีเมียมสี่สีทั้งเล่ม · ดาวน์โหลดทันที · เขียนเพื่อวัยของลูกโดยเฉพาะ
        </p>

        <button
          onClick={onCTA}
          className="group inline-flex items-center gap-2 px-7 h-14 rounded-full bg-white text-[hsl(212,55%,12%)] font-display text-lg shadow-brand hover:shadow-elegant transition-all hover:-translate-y-0.5 animate-pop-in"
          style={{ animationDelay: "0.4s" }}
        >
          หาหนังสือที่ใช่สำหรับลูกคุณ
          <span className="inline-block group-hover:translate-x-1 transition-transform">→</span>
        </button>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs sm:text-sm text-white/85">
          <span className="inline-flex items-center gap-1.5"><BookOpen className="h-4 w-4" /> อ่านตัวอย่างฟรี</span>
          <span className="inline-flex items-center gap-1.5"><Download className="h-4 w-4" /> ดาวน์โหลดทันที</span>
          <span className="inline-flex items-center gap-1.5"><Sparkles className="h-4 w-4" /> ภาพสีทั้งเล่ม</span>
        </div>
      </div>

      {/* soft bottom curve */}
      <svg className="block w-full text-background" viewBox="0 0 1440 80" preserveAspectRatio="none" aria-hidden>
        <path fill="currentColor" d="M0,32 C360,96 1080,0 1440,48 L1440,80 L0,80 Z" />
      </svg>
    </section>
  );
};
