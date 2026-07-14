import { ShieldCheck, BookOpen, Sparkles } from "lucide-react";

interface Props {
  bookCount: number;
  sampleCovers: string[];
}

export const SocialProofStrip = ({ bookCount, sampleCovers }: Props) => {
  return (
    <section className="bg-highlight/40 border-y border-border py-10 md:py-14">
      <div className="container">
        <div className="grid md:grid-cols-3 gap-4 md:gap-6 mb-8">
          <Stat icon={BookOpen}    big={`${bookCount}+`}    label="เล่มที่พร้อมดาวน์โหลด" />
          <Stat icon={ShieldCheck} big="QC ≥ 90"           label="ผ่านตรวจคุณภาพทุกเล่ม" />
          <Stat icon={Sparkles}    big="8.5 × 8.5"         label="พรีเมียมสี่สีทั้งเล่ม" />
        </div>

        {sampleCovers.length > 0 && (
          <>
            <p className="text-center font-mono uppercase tracking-widest text-xs text-muted-foreground mb-3">
              [ ตัวอย่างจากเล่มจริงในคลัง ]
            </p>
            <div className="overflow-x-auto -mx-6 px-6">
              <div className="flex gap-3 md:gap-4 min-w-min">
                {sampleCovers.slice(0, 12).map((c, i) => (
                  <img
                    key={i}
                    src={c}
                    alt=""
                    loading="lazy"
                    className="h-32 w-32 md:h-40 md:w-40 flex-shrink-0 rounded-xl object-cover shadow-soft"
                  />
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
