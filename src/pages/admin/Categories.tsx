import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

type Cat = {
  id: string; name: string; slug: string; description: string | null;
  default_price: number; cover_style_prompt: string | null; enabled: boolean;
};

export default function Categories() {
  const [items, setItems] = useState<Cat[]>([]);
  const [draft, setDraft] = useState({ name: "", slug: "", description: "", default_price: 24.99, cover_style_prompt: "" });

  const load = async () => {
    const { data } = await supabase.from("categories").select("*").order("name");
    setItems((data ?? []) as Cat[]);
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!draft.name || !draft.slug) { toast.error("Name and slug required"); return; }
    const { error } = await supabase.from("categories").insert(draft);
    if (error) toast.error(error.message);
    else { toast.success("Category added"); setDraft({ name: "", slug: "", description: "", default_price: 24.99, cover_style_prompt: "" }); load(); }
  };

  const update = async (c: Cat, patch: Partial<Cat>) => {
    const { error } = await supabase.from("categories").update(patch).eq("id", c.id);
    if (error) toast.error(error.message); else load();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete category?")) return;
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) toast.error(error.message); else load();
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <p className="font-mono uppercase tracking-widest text-xs">[ Categories ]</p>
        <h1 className="font-display text-4xl uppercase">Ebook categories</h1>
      </div>

      <Card className="border-2 border-foreground">
        <CardHeader><CardTitle>New category</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div><Label>Name</Label><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
          <div><Label>Slug</Label><Input value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} /></div>
          <div className="col-span-2"><Label>Description</Label><Textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></div>
          <div><Label>Default price (USD)</Label><Input type="number" step="0.01" value={draft.default_price} onChange={(e) => setDraft({ ...draft, default_price: Number(e.target.value) })} /></div>
          <div><Label>Cover style prompt</Label><Input value={draft.cover_style_prompt} onChange={(e) => setDraft({ ...draft, cover_style_prompt: e.target.value })} /></div>
          <Button className="col-span-2" onClick={add}>Add category</Button>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {items.map((c) => (
          <Card key={c.id} className="border-2 border-foreground">
            <CardContent className="pt-6 grid grid-cols-12 gap-3 items-center">
              <Input className="col-span-3" defaultValue={c.name} onBlur={(e) => e.target.value !== c.name && update(c, { name: e.target.value })} />
              <Input className="col-span-3 font-mono text-xs" defaultValue={c.slug} disabled />
              <Input className="col-span-2" type="number" step="0.01" defaultValue={c.default_price} onBlur={(e) => Number(e.target.value) !== c.default_price && update(c, { default_price: Number(e.target.value) })} />
              <div className="col-span-3 flex items-center gap-2 text-sm">
                <Switch checked={c.enabled} onCheckedChange={(v) => update(c, { enabled: v })} />
                <span>{c.enabled ? "Enabled" : "Disabled"}</span>
              </div>
              <Button variant="outline" size="icon" className="col-span-1" onClick={() => remove(c.id)}><Trash2 className="size-4" /></Button>
              <Textarea className="col-span-12 text-xs" defaultValue={c.cover_style_prompt ?? ""} placeholder="Cover style prompt" onBlur={(e) => e.target.value !== (c.cover_style_prompt ?? "") && update(c, { cover_style_prompt: e.target.value })} />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
