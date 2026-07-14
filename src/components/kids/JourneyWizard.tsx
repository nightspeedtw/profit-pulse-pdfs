import { useState } from "react";
import * as Icons from "lucide-react";
import type { KidsAgeGroup, KidsTheme } from "@/lib/kidsTaxonomy";
import { Check, ChevronLeft } from "lucide-react";

export type WizardValue = {
  theme: string | null;      // theme slug or "any"
  audience: "boy" | "girl" | "any" | null;
  age: string | null;        // age slug or "any"
};

interface Props {
  themes: KidsTheme[];
  ageGroups: KidsAgeGroup[];
  value: WizardValue;
  onChange: (v: WizardValue) => void;
  onComplete: () => void;
}

const AUDIENCES: { key: "boy" | "girl" | "any"; label_th: string; label_en: string; emoji: string; grad: string }[] = [
  { key: "boy",  label_th: "เด็กผู้ชาย",   label_en: "For a boy",  emoji: "👦", grad: "from-sky-400 to-indigo-500" },
  { key: "girl", label_th: "เด็กผู้หญิง", label_en: "For a girl", emoji: "👧", grad: "from-pink-400 to-fuchsia-500" },
  { key: "any",  label_th: "ทุกคน",         label_en: "For anyone", emoji: "🧒", grad: "from-amber-400 to-orange-500" },
];

const AGE_BLURB: Record<string, string> = {
  "0-3":  "หนังสือกระดาษหนา คำสั้น จังหวะร้องซ้ำ",
  "4-6":  "นิทานภาพเต็มเล่ม เรื่องดีๆ ที่สอนแบบไม่บ่น",
  "7-9":  "เรื่องยาวขึ้น คำใหม่ พัฒนาการอ่าน",
  "9-12": "วรรณกรรมเยาวชน โลกที่ลึกขึ้น",
  "13+":  "เรื่องราวสำหรับวัยรุ่น",
};

export const JourneyWizard = ({ themes, ageGroups, value, onChange, onComplete }: Props) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const next = () => (step < 3 ? setStep((s) => (s + 1) as 1 | 2 | 3) : onComplete());
  const back = () => step > 1 && setStep((s) => (s - 1) as 1 | 2 | 3);

  return (
    <section id="picker" className="container py-10 md:py-16 scroll-mt-4">
      {/* Progress dots */}
      <div className="flex items-center justify-center gap-3 mb-8">
        {[1, 2, 3].map((n) => (
          <div key={n} className="flex items-center gap-3">
            <div
              className={`h-3 rounded-full transition-all ${
                n === step ? "w-10 bg-accent" : n < step ? "w-3 bg-accent" : "w-3 bg-muted"
              }`}
            />
          </div>
        ))}
      </div>

      <div className="max-w-4xl mx-auto">
        {step > 1 && (
          <button
            type="button"
            onClick={back}
            className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" /> ย้อนกลับ
          </button>
        )}

        {step === 1 && (
          <StepTheme
            themes={themes}
            selected={value.theme}
            onSelect={(t) => {
              onChange({ ...value, theme: t });
              setTimeout(next, 250);
            }}
          />
        )}

        {step === 2 && (
          <StepAudience
            selected={value.audience}
            onSelect={(a) => {
              onChange({ ...value, audience: a });
              setTimeout(next, 250);
            }}
          />
        )}

        {step === 3 && (
          <StepAge
            groups={ageGroups}
            selected={value.age}
            onSelect={(g) => {
              onChange({ ...value, age: g });
              setTimeout(onComplete, 300);
            }}
          />
        )}
      </div>
    </section>
  );
};

/* ---------------- Step 1: Theme ---------------- */
const StepTheme = ({
  themes,
  selected,
  onSelect,
}: {
  themes: KidsTheme[];
  selected: string | null;
  onSelect: (slug: string) => void;
}) => (
  <div className="animate-slide-in-right">
    <StepHeading th="เลือกสิ่งที่อยากให้ลูกได้รับ" en="Pick the gift you want this book to give" step="1 / 3" />
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 md:gap-4">
      {themes.map((t) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Icon = ((t.icon_name && (Icons as any)[t.icon_name]) || Icons.Sparkles) as React.ComponentType<{ className?: string }>;
        const active = selected === t.slug;
        return (
          <button
            key={t.slug}
            type="button"
            onClick={() => onSelect(t.slug)}
            className={`group relative text-left p-4 md:p-5 rounded-2xl border-2 transition-all hover:-translate-y-1 hover:shadow-brand ${
              active ? "border-accent bg-accent/10 shadow-brand" : "border-border bg-card hover:border-accent/50"
            }`}
          >
            <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-highlight text-accent group-hover:animate-wiggle">
              <Icon className="h-6 w-6" />
            </div>
            <p className="font-display text-base md:text-lg leading-tight">{t.label_th}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{t.label_en}</p>
            {active && <Check className="absolute top-3 right-3 h-4 w-4 text-accent" />}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => onSelect("any")}
        className={`p-4 md:p-5 rounded-2xl border-2 border-dashed transition-all hover:-translate-y-1 text-left ${
          selected === "any" ? "border-accent bg-accent/10" : "border-border hover:border-accent/50"
        }`}
      >
        <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Icons.Shuffle className="h-6 w-6" />
        </div>
        <p className="font-display text-base md:text-lg leading-tight">เลือกให้หน่อย</p>
        <p className="text-xs text-muted-foreground mt-0.5">Surprise me</p>
      </button>
    </div>
  </div>
);

/* ---------------- Step 2: Audience ---------------- */
const StepAudience = ({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (a: "boy" | "girl" | "any") => void;
}) => (
  <div className="animate-slide-in-right">
    <StepHeading th="หนังสือเล่มนี้สำหรับใคร" en="Who is this book for?" step="2 / 3" />
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {AUDIENCES.map((a) => {
        const active = selected === a.key;
        return (
          <button
            key={a.key}
            type="button"
            onClick={() => onSelect(a.key)}
            className={`relative overflow-hidden rounded-2xl p-6 text-white text-left bg-gradient-to-br ${a.grad} transition-all hover:-translate-y-1 hover:shadow-brand ${
              active ? "ring-4 ring-accent ring-offset-2 ring-offset-background" : ""
            }`}
          >
            <div className="text-5xl mb-3 group-hover:animate-wiggle">{a.emoji}</div>
            <p className="font-display text-xl leading-tight">{a.label_th}</p>
            <p className="text-xs opacity-90 mt-1">{a.label_en}</p>
            {active && <Check className="absolute top-3 right-3 h-5 w-5 text-white" />}
          </button>
        );
      })}
    </div>
  </div>
);

/* ---------------- Step 3: Age ---------------- */
const StepAge = ({
  groups,
  selected,
  onSelect,
}: {
  groups: KidsAgeGroup[];
  selected: string | null;
  onSelect: (slug: string) => void;
}) => (
  <div className="animate-slide-in-right">
    <StepHeading th="อายุเท่าไหร่" en="How old is your child?" step="3 / 3" />
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
      {groups.map((g) => {
        const active = selected === g.slug;
        return (
          <button
            key={g.slug}
            type="button"
            onClick={() => onSelect(g.slug)}
            className={`p-5 rounded-2xl border-2 text-left transition-all hover:-translate-y-1 hover:shadow-brand ${
              active ? "border-accent bg-accent/10 shadow-brand" : "border-border bg-card hover:border-accent/50"
            }`}
          >
            <p className="font-display text-2xl leading-none">{g.slug}</p>
            <p className="text-xs uppercase tracking-widest text-accent mt-1">{g.label_en.split("·")[1]?.trim() ?? ""}</p>
            <p className="text-sm text-muted-foreground mt-2 leading-snug">
              {AGE_BLURB[g.slug] ?? g.label_th}
            </p>
          </button>
        );
      })}
    </div>
  </div>
);

const StepHeading = ({ th, en, step }: { th: string; en: string; step: string }) => (
  <div className="text-center mb-6">
    <p className="font-mono uppercase tracking-widest text-xs text-accent mb-2">[ Step {step} ]</p>
    <h2 className="font-display text-3xl md:text-4xl leading-tight">{th}</h2>
    <p className="text-sm text-muted-foreground mt-1">{en}</p>
  </div>
);
