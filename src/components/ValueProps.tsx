import { Zap, Lock, RefreshCcw, Award } from "lucide-react";

const FEATURES = [
  {
    icon: Zap,
    title: "Instant delivery",
    body: "Download your PDF the second your payment clears. No waiting, no shipping.",
  },
  {
    icon: Lock,
    title: "Watermarked & secure",
    body: "Each file is uniquely fingerprinted to your purchase for safe ownership.",
  },
  {
    icon: RefreshCcw,
    title: "30-day refund",
    body: "Not what you expected? Get your money back, no questions asked.",
  },
  {
    icon: Award,
    title: "Made by experts",
    body: "Every printable is curated and reviewed by topic specialists worldwide.",
  },
];

export const ValueProps = () => (
  <section className="bg-foreground text-background border-y-2 border-foreground">
    <div className="container py-16 lg:py-20">
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
        {FEATURES.map((f) => (
          <div key={f.title} className="border-l-2 border-highlight pl-5">
            <f.icon className="h-8 w-8 text-highlight mb-4" strokeWidth={2} />
            <h3 className="font-display text-xl uppercase mb-2">{f.title}</h3>
            <p className="text-background/70 text-sm leading-relaxed">{f.body}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);
