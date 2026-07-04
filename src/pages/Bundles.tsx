import { Link } from "react-router-dom";
import { useEffect } from "react";

const Bundles = () => {
  useEffect(() => {
    document.title = "Bundles — SecretPDF";
  }, []);

  return (
    <>
      <section className="border-b-2 border-foreground bg-foreground text-background">
        <div className="container py-16">
          <p className="font-mono uppercase tracking-widest text-xs mb-3 text-highlight">[ Bundles ]</p>
          <h1 className="font-display text-5xl lg:text-7xl uppercase leading-[0.95]">
            Buy a stack.
            <br />
            <span className="text-highlight">Save big.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-background/80">
            Hand-picked PDF bundles. The most-loved printables, packaged to save you up to 60%.
          </p>
        </div>
      </section>
      <section className="container py-16">
        <div className="border-2 border-dashed border-foreground p-16 text-center">
          <h2 className="font-display text-3xl uppercase mb-4">Bundles drop soon</h2>
          <p className="text-muted-foreground mb-6">
            We&apos;re packaging the first launch sets. Want first access?
          </p>
          <Link
            to="/library"
            className="inline-flex h-12 px-6 bg-accent text-accent-foreground font-display uppercase border-2 border-foreground shadow-brutal items-center hover:shadow-brutal-lg hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all"
          >
            Browse the library →
          </Link>
        </div>
      </section>
    </>
  );
};

export default Bundles;
