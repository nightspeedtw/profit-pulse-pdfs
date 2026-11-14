import { HOME_FAQ } from "@/content/homeFaq";

export const HomeFaq = () => (
  <section className="container py-16 lg:py-20">
    <p className="font-mono uppercase tracking-widest text-xs mb-3">[ FAQ ]</p>
    <h2 className="font-display text-4xl lg:text-5xl uppercase mb-8">Questions</h2>
    <div className="grid md:grid-cols-2 gap-8">
      {HOME_FAQ.map((f) => (
        <div key={f.q} className="border-l-2 border-foreground pl-5">
          <h3 className="font-display text-xl uppercase mb-2">{f.q}</h3>
          <p className="text-muted-foreground text-sm leading-relaxed">{f.a}</p>
        </div>
      ))}
    </div>
  </section>
);
