import { Link } from "react-router-dom";
import { ShieldCheck, BookOpen, Sparkles } from "lucide-react";

export interface SampleBook {
  id: string;
  title: string;
  cover_url: string | null;
}

interface Props {
  bookCount: number;
  sampleBooks: SampleBook[];
}

export const SocialProofStrip = ({ bookCount, sampleBooks }: Props) => {
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
            <p className="text-center font-mono uppercase tracking-widest text-xs text-muted-foreground mb-3">
              [ ตัวอย่างจากเล่มจริงในคลัง ]
            </p>
            <div className="overflow-x-auto -mx-6 px-6">
              <div className="flex gap-3 md:gap-4 min-w-min">
                {sampleBooks.slice(0, 12).map((b) => (
                  <Link
                    key={b.id}
                    to={`/product/${b.id}`}
                    aria-label={b.title}
                    className="group cursor-pointer flex-shrink-0 h-32 w-32 md:h-40 md:w-40 rounded-xl overflow-hidden shadow-soft ring-1 ring-border transition-all hover:-translate-y-1 hover:shadow-brand hover:ring-accent"
                  >
                    {b.cover_url ? (
                      <img
                        src={b.cover_url}
                        alt={b.title}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                      />
                    ) : (
                      <div className="h-full w-full bg-muted" />
                    )}
                  </Link>
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
