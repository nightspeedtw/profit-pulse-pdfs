import { ShieldCheck, BookOpen, Sparkles } from "lucide-react";
import type { KidsTheme } from "@/lib/kidsTaxonomy";
import { KidsBookCard, type KidsBookCardData } from "./KidsBookCard";

interface Props {
  bookCount: number;
  sampleBooks: KidsBookCardData[];
  themes: KidsTheme[];
}

export const SocialProofStrip = ({ bookCount, sampleBooks, themes }: Props) => {
  return (
    <section className="bg-highlight/40 border-y border-border py-10 md:py-14">
      <div className="container">
        <div className="grid md:grid-cols-3 gap-4 md:gap-6 mb-8">
          <Stat icon={BookOpen}    big={`${bookCount}+`}    label="เล่มที่พร้อมดาวน์โหลด" />
          <Stat icon={ShieldCheck} big="QC ≥ 90"           label="ผ่านตรวจคุณภาพทุกเล่ม" />
          <Stat icon={Sparkles}    big="8.5 × 8.5"         label="พรีเมียมสี่สีทั้งเล่ม" />
        </div>

        {sampleBooks.length > 0 && (
          <>
            <p className="text-center font-mono uppercase tracking-widest text-xs text-muted-foreground mb-4">
              [ ตัวอย่างจากเล่มจริงในคลัง ]
            </p>
            <div className="overflow-x-auto -mx-6 px-6 pb-2">
              <div className="flex gap-4 min-w-min">
                {sampleBooks.slice(0, 12).map((b, i) => (
                  <KidsBookCard key={b.id} book={b} themes={themes} variant="strip" index={i} />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
};

const Stat = ({ icon: Icon, big, label }: { icon: React.ComponentType<{ className?: string }>; big: string; label: string }) => (
  <div className="rounded-2xl bg-card border border-border p-5 flex items-center gap-4">
    <div className="h-12 w-12 rounded-xl bg-accent/15 text-accent flex items-center justify-center flex-shrink-0">
      <Icon className="h-6 w-6" />
    </div>
    <div>
      <p className="font-display text-2xl leading-none">{big}</p>
      <p className="text-sm text-muted-foreground mt-1">{label}</p>
    </div>
  </div>
);
