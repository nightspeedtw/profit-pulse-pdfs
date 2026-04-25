import { Link } from "react-router-dom";
import heroImg from "@/assets/hero-printables.jpg";
import { ArrowRight, Download, Printer, Globe2, Star } from "lucide-react";

export const Hero = () => (
  <section className="relative bg-background border-b-2 border-foreground overflow-hidden grain">
    <div className="container relative grid lg:grid-cols-2 gap-12 lg:gap-16 py-16 lg:py-24 items-center">
      {/* Left: copy */}
      <div className="relative z-10">
        <div className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 border-2 border-foreground bg-highlight font-mono text-xs uppercase tracking-widest">
          <span className="h-2 w-2 bg-accent rounded-full animate-pulse" />
          New drops every week
        </div>

        <h1 className="font-display text-5xl sm:text-6xl lg:text-7xl xl:text-8xl uppercase leading-[0.9] tracking-tight mb-6">
          Printable
          <br />
          <span className="underline-brutal">knowledge</span>,
          <br />
          on demand.
        </h1>

        <p className="text-lg lg:text-xl text-muted-foreground max-w-xl mb-8 leading-relaxed">
          The world&apos;s sharpest library of expert PDFs. Download instantly,
          print as many copies as you want, and put real knowledge in your hands.
        </p>

        <div className="flex flex-wrap gap-4 mb-10">
          <Link
            to="/library"
            className="group inline-flex items-center gap-2 h-14 px-6 bg-accent text-accent-foreground font-display uppercase tracking-wider border-2 border-foreground shadow-brutal hover:shadow-brutal-lg hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all"
          >
            Browse the Library
            <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
          </Link>
          <Link
            to="/categories"
            className="inline-flex items-center gap-2 h-14 px-6 bg-background text-foreground font-display uppercase tracking-wider border-2 border-foreground hover:bg-highlight transition-colors"
          >
            See categories
          </Link>
        </div>

        {/* Social proof tiles */}
        <div className="grid grid-cols-3 gap-3 max-w-xl">
          {[
            { icon: Download, label: "Instant", sub: "Download" },
            { icon: Printer, label: "Print", sub: "Unlimited" },
            { icon: Globe2, label: "Worldwide", sub: "Delivery" },
          ].map((it, i) => (
            <div key={i} className="border-2 border-foreground p-3 bg-background">
              <it.icon className="h-5 w-5 mb-1" strokeWidth={2.5} />
              <p className="font-display text-sm uppercase leading-tight">{it.label}</p>
              <p className="text-xs text-muted-foreground">{it.sub}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Right: visual */}
      <div className="relative">
        <div className="relative aspect-square border-2 border-foreground bg-highlight shadow-brutal-lg overflow-hidden">
          <img
            src={heroImg}
            alt="Stack of premium printable PDFs"
            className="w-full h-full object-cover"
          />
          {/* Sticker */}
          <div className="absolute top-6 right-6 h-24 w-24 bg-accent border-2 border-foreground rounded-full flex flex-col items-center justify-center font-display text-accent-foreground text-center leading-tight rotate-12 shadow-brutal-sm">
            <span className="text-2xl">50%</span>
            <span className="text-[10px] uppercase tracking-wider">Launch deal</span>
          </div>
        </div>

        {/* Floating rating card */}
        <div className="absolute -bottom-6 -left-6 bg-background border-2 border-foreground p-4 shadow-brutal hidden sm:block max-w-[220px]">
          <div className="flex gap-0.5 mb-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star key={i} className="h-4 w-4 fill-accent stroke-foreground" strokeWidth={2} />
            ))}
          </div>
          <p className="font-display text-sm uppercase leading-tight">Top-rated digital library</p>
          <p className="text-xs text-muted-foreground mt-1">Built for serious learners</p>
        </div>
      </div>
    </div>
  </section>
);
