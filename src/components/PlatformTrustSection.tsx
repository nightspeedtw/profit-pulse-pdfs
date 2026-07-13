import { ShieldCheck, Tablet, BadgeCheck } from "lucide-react";

const items = [
  {
    icon: ShieldCheck,
    title: "100% Secure Delivery",
    body: "Instant PDF download via SecretPDF's encrypted delivery system — your file, protected end to end.",
  },
  {
    icon: Tablet,
    title: "Multi-Device Compatibility",
    body: "Open on iPad, tablet, smartphone, laptop — or print it out. Works everywhere PDFs work.",
  },
  {
    icon: BadgeCheck,
    title: "Satisfaction Guaranteed",
    body: "Every purchase is backed by our platform satisfaction guarantee. Buy with confidence.",
  },
];

export default function PlatformTrustSection() {
  return (
    <section className="space-y-4 pt-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-2xl uppercase">Why Buy via SecretPDF?</h2>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {items.map(({ icon: Icon, title, body }) => (
          <div key={title} className="border-2 border-foreground p-5 bg-background space-y-2">
            <Icon className="h-8 w-8" strokeWidth={2.5} />
            <h3 className="font-display text-base uppercase leading-tight">{title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
