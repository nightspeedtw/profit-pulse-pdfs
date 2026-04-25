import { useEffect } from "react";

const About = () => {
  useEffect(() => {
    document.title = "About — Printly";
  }, []);

  return (
    <>
      <section className="border-b-2 border-foreground bg-highlight">
        <div className="container py-20 max-w-4xl">
          <p className="font-mono uppercase tracking-widest text-xs mb-3">[ Our story ]</p>
          <h1 className="font-display text-5xl lg:text-7xl uppercase leading-[0.95]">
            Knowledge,
            <br />
            <span className="bg-foreground text-background px-2">printed.</span>
          </h1>
        </div>
      </section>

      <section className="container py-16 max-w-3xl space-y-6 text-lg leading-relaxed">
        <p>
          Printly exists for one reason — to put real, useful knowledge into the hands of people
          who actually want to do something with it. No fluff. No filler. Just battle-tested
          printables built by experts.
        </p>
        <p>
          Every PDF in our library has been curated, designed, and reviewed for one purpose:
          to make a difference the second you print it. Whether you&apos;re studying, building
          a business, raising kids, or training your dog — we&apos;ve got the printable for it.
        </p>
        <p className="font-display text-2xl uppercase mt-12 underline-brutal inline">
          Welcome to the new printable era.
        </p>
      </section>
    </>
  );
};

export default About;
