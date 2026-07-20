// Coloring V2 customer preview — read-only.
// Only reachable when FEATURES.ENABLE_COLORING_LANE_V2 is true.
// Shows the approved cover + a few sample interior pages. No purchase flow.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

type Book = { id: string; title: string | null; theme: string; age_band: string; page_count: number; publish_status: string };
type Asset = { id: string; kind: string; page_number: number | null; storage_path: string };

export default function ColoringPreviewV2() {
  const { bookId } = useParams();
  const [book, setBook] = useState<Book | null>(null);
  const [cover, setCover] = useState<string | null>(null);
  const [samples, setSamples] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!bookId) return;
    (async () => {
      setLoading(true);
      const { data: b } = await supabase
        .from("coloring_v2_books" as never)
        .select("id,title,theme,age_band,page_count,publish_status")
        .eq("id", bookId).maybeSingle();
      setBook((b as unknown as Book) ?? null);

      const { data: assets } = await supabase
        .from("coloring_v2_assets" as never)
        .select("id,kind,page_number,storage_path")
        .eq("book_id", bookId)
        .in("kind", ["cover_composite", "interior"]);
      const list = (assets as unknown as Asset[]) ?? [];
      const coverAsset = list.find(a => a.kind === "cover_composite");
      const interior = list.filter(a => a.kind === "interior").slice(0, 4);
      const sign = async (p: string) => (await supabase.storage.from("coloring-v2").createSignedUrl(p, 3600)).data?.signedUrl ?? null;
      if (coverAsset) setCover(await sign(coverAsset.storage_path));
      const signed = await Promise.all(interior.map(a => sign(a.storage_path)));
      setSamples(signed.filter((s): s is string => !!s));
      setLoading(false);
    })();
  }, [bookId]);

  if (loading) return <div className="p-8">Loading preview…</div>;
  if (!book) return <div className="p-8">Book not found.</div>;

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-6">
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-100 px-4 py-3 text-sm">
        Experimental preview — Coloring V2. Not for sale yet (publish status: <strong>{book.publish_status}</strong>).
      </div>
      <h1 className="text-3xl font-bold">{book.title ?? "(untitled)"}</h1>
      <p className="text-muted-foreground">{book.theme} · Ages {book.age_band} · {book.page_count} pages</p>
      {cover && <img src={cover} alt="Cover preview" className="w-full max-w-md rounded-md border" />}
      {samples.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-3">Sample interior pages</h2>
          <div className="grid grid-cols-2 gap-4">
            {samples.map((src, i) => <img key={i} src={src} alt={`Page ${i + 1}`} className="w-full rounded-md border" />)}
          </div>
        </div>
      )}
    </div>
  );
}
