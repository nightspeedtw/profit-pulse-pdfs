import { useEffect, useState } from "react";
import { Upload, CheckCircle2, Trash2, Loader2, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Ref {
  id: string;
  name: string;
  image_url: string;
  palette: string[] | null;
  lighting: string | null;
  layout_notes: string | null;
  style_summary: string | null;
  is_active: boolean;
  created_at: string;
}

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let s = ""; const c = 0x8000;
  for (let i = 0; i < buf.length; i += c) s += String.fromCharCode(...buf.subarray(i, i + c));
  return btoa(s);
}

export function CoverStyleReferenceCard() {
  const [refs, setRefs] = useState<Ref[]>([]);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("cover-style-reference", { method: "GET" as never });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setRefs((data as { references: Ref[] }).references ?? []);
  };

  useEffect(() => { load(); }, []);

  const onUpload = async () => {
    if (!file) { toast.error("Choose an image first"); return; }
    setBusy(true);
    try {
      const image_base64 = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke("cover-style-reference", {
        body: { action: "upload", name: name || file.name, image_base64, mime: file.type || "image/jpeg" },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      toast.success("Reference uploaded & activated");
      setFile(null); setName("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const onActivate = async (id: string) => {
    setBusy(true);
    try {
      await supabase.functions.invoke("cover-style-reference", { body: { action: "activate", id } });
      await load();
    } finally { setBusy(false); }
  };

  const onDelete = async (id: string) => {
    if (!confirm("Delete this reference?")) return;
    setBusy(true);
    try {
      await supabase.functions.invoke("cover-style-reference", { body: { action: "delete", id } });
      await load();
    } finally { setBusy(false); }
  };

  const active = refs.find((r) => r.is_active);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Palette className="h-4 w-4" /> Master Cover Style Reference
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          อัปโหลดภาพปกตัวอย่างที่ต้องการ ระบบจะดึง palette / lighting / layout ไปใช้กับทุกปกที่สร้างต่อจากนี้
        </p>

        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[180px]">
            <label className="text-xs font-medium">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Debt Exit Hardcover" />
          </div>
          <div>
            <label className="text-xs font-medium block">Image</label>
            <Input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <Button onClick={onUpload} disabled={busy || !file} className="gap-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Upload & Activate
          </Button>
        </div>

        {active && (
          <div className="rounded-md border-2 border-emerald-600/60 bg-emerald-50/50 dark:bg-emerald-950/20 p-3">
            <div className="flex items-start gap-3">
              <img src={active.image_url} alt={active.name} className="h-32 w-24 object-cover rounded shadow" />
              <div className="text-sm space-y-1 flex-1">
                <div className="flex items-center gap-2 font-medium">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Active: {active.name}
                </div>
                <div className="flex gap-1 flex-wrap">
                  {(active.palette ?? []).map((c) => (
                    <span key={c} className="h-5 w-5 rounded border" style={{ background: c }} title={c} />
                  ))}
                </div>
                {active.lighting && <div className="text-xs text-muted-foreground"><b>Lighting:</b> {active.lighting}</div>}
                {active.layout_notes && <div className="text-xs text-muted-foreground line-clamp-3"><b>Layout:</b> {active.layout_notes}</div>}
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : refs.length > 1 && (
          <div>
            <div className="text-xs font-medium mb-2">Previous references</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {refs.filter((r) => !r.is_active).map((r) => (
                <div key={r.id} className="rounded border p-2 text-xs space-y-1">
                  <img src={r.image_url} alt={r.name} className="h-24 w-full object-cover rounded" />
                  <div className="truncate font-medium">{r.name}</div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" className="h-6 px-2 text-xs flex-1" onClick={() => onActivate(r.id)} disabled={busy}>Activate</Button>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => onDelete(r.id)} disabled={busy}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
