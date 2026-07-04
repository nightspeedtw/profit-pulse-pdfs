import { useEffect } from "react";

const About = () => {
  useEffect(() => {
    document.title = "About — SecretPDF";
  }, []);

  return (
    <>
      <section className="border-b border-border bg-gradient-to-b from-highlight to-background">
        <div className="container py-24 max-w-4xl">
          <p className="font-mono uppercase tracking-[0.28em] text-xs mb-4 text-accent">
            [ Our story ]
          </p>
          <h1 className="font-display text-5xl lg:text-7xl leading-[1.02] tracking-tight">
            Knowledge, <br />
            <span className="brand-gradient-text italic">privately delivered.</span>
          </h1>
        </div>
      </section>

      <section className="container py-20 max-w-3xl space-y-7 text-lg leading-relaxed text-foreground/80">
        <p>
          SecretPDF exists for one reason — to put real, useful knowledge into the hands of the
          people who need it, without the noise. Every title is expert-authored, tightly edited,
          and delivered securely to your inbox seconds after checkout.
        </p>
        <p>
          Our library is deliberately curated. No filler, no recycled listicles, no data leaks.
          Whether you&apos;re rebuilding your finances, sharpening your health, or leveling up
          your craft — SecretPDF is a private, professional shelf you can trust.
        </p>
        <p className="font-display text-2xl italic mt-12 underline-brutal inline">
          Private. Secure. Trusted.
        </p>
      </section>
    </>
  );
};

export default About;
