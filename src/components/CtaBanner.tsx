import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

export const CtaBanner = () => (
  <section className="container py-20">
    <div className="relative border-2 border-foreground bg-accent text-accent-foreground overflow-hidden shadow-brutal-lg">
      {/* Background pattern */}
      <div
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, transparent, transparent 20px, currentColor 20px, currentColor 22px)",
        }}
      />
      <div className="relative grid lg:grid-cols-[1.5fr_1fr] gap-8 p-10 lg:p-16 items-center">
        <div>
          <p className="font-mono uppercase text-xs tracking-widest mb-4 opacity-80">[ The Drop ]</p>
          <h2 className="font-display text-4xl lg:text-6xl uppercase leading-[0.95]">
            Get the launch
            <br />
            <span className="bg-highlight text-highlight-foreground px-2">discount</span> now.
          </h2>
          <p className="text-base lg:text-lg mt-6 opacity-90 max-w-xl">
            Subscribers get 25% off every release, free preview chapters, and first-dibs on
            the printables before they go public.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <input
            type="email"
            placeholder="you@email.com"
            className="h-14 px-4 bg-background text-foreground border-2 border-foreground font-mono text-sm placeholder:text-muted-foreground focus:outline-none focus:bg-highlight"
          />
          <Link
            to="/library"
            className="h-14 inline-flex items-center justify-center gap-2 bg-foreground text-background font-display uppercase tracking-wider border-2 border-foreground hover:bg-background hover:text-foreground transition-colors"
          >
            Claim 25% off
            <ArrowRight className="h-5 w-5" />
          </Link>
          <p className="text-xs font-mono opacity-70 text-center">Unsubscribe anytime. No spam.</p>
        </div>
      </div>
    </div>
  </section>
);
