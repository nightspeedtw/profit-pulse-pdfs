// Settings — essentials shown by default, advanced sections collapsed.
// Absorbs the former Autopilot, Categories and Costs pages.
import { useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Trash2, ExternalLink, Plus } from "lucide-react";
import { toast } from "sonner";

type Settings = {
  id: number;
  // Essentials
  daily_quota: number;
  autopilot_mode: string;
  auto_publish: boolean;
  daily_budget_usd: number;
  min_word_count: number;
  min_score_threshold: number;
  enabled_category_ids: string[];
  // Advanced
  mode: string;
  per_ebook_budget_usd: number;
  publish_hour_utc: number;
  max_ai_calls_per_ebook: number;
  max_rewrite_attempts: number;
  max_shopify_uploads_per_day: number;
  auto_rewrite_limit: number;
  shopify_draft_upload_enabled: boolean;
  cron_enabled: boolean;
  autopilot_enabled: boolean;
  paused: boolean;
};

type Category = {
  id: string; name: string; slug: string; description: string | null;
  default_price: number; cover_style_prompt: string | null; enabled: boolean;
};

type CostRow = {
  id: string; step: string; model: string;
  input_tokens: number; output_tokens: number; cost_usd: number;
  created_at: string;
};

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [costs, setCosts] = useState<CostRow[]>([]);
  const [advanced, setAdvanced] = useState(false);
  const [savingCats, setSavingCats] = useState(false);
  const [draft, setDraft] = useState({ name: "", slug: "", default_price: 24.99 });

  useEffect(() => {
    (async () => {
      const [{ data: setRow }, { data: catRows }] = await Promise.all([
        supabase.from("generation_settings").select("*").eq("id", 1).maybeSingle(),
        supabase.from("categories").select("*").order("name"),
      ]);
      if (setRow) setS(setRow as Settings);
      if (catRows) setCats(catRows as Category[]);
    })();
  }, []);

  async function loadCosts() {
    const { data } = await supabase.from("cost_log")
      .select("id,step,model,input_tokens,output_tokens,cost_usd,created_at")
      .order("created_at", { ascending: false }).limit(100);
    setCosts((data ?? []) as CostRow[]);
  }

  async function patchSettings(patch: Partial<Settings>) {
    if (!s) return;
    const next = { ...s, ...patch };
    setS(next);
    const { error } = await supabase.from("generation_settings").update(patch as never).eq("id", 1);
    if (error) toast.error(error.message);
  }

  function toggleCategoryEnabled(id: string, on: boolean) {
    if (!s) return;
    const next = on
      ? Array.from(new Set([...s.enabled_category_ids, id]))
      : s.enabled_category_ids.filter((c) => c !== id);
    patchSettings({ enabled_category_ids: next });
  }

  async function addCategory() {
    if (!draft.name || !draft.slug) return toast.error("Name and slug required");
    setSavingCats(true);
    const { error } = await supabase.from("categories").insert(draft);
    setSavingCats(false);
    if (error) return toast.error(error.message);
    setDraft({ name: "", slug: "", default_price: 24.99 });
    const { data } = await supabase.from("categories").select("*").order("name");
    setCats((data ?? []) as Category[]);
    toast.success("Category added");
  }

  async function updateCategory(c: Category, patch: Partial<Category>) {
    const { error } = await supabase.from("categories").update(patch).eq("id", c.id);
    if (error) return toast.error(error.message);
    setCats((prev) => prev.map((x) => (x.id === c.id ? { ...x, ...patch } : x)));
  }

  async function deleteCategory(id: string) {
    if (!confirm("Delete category?")) return;
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setCats((prev) => prev.filter((c) => c.id !== id));
  }

  if (!s) return <div>Loading…</div>;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="font-mono uppercase tracking-widest text-xs">[ Settings ]</p>
          <h1 className="font-display text-4xl uppercase">Factory settings</h1>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs">Advanced mode</Label>
          <Switch checked={advanced} onCheckedChange={setAdvanced} />
        </div>
      </div>

      {/* ===== Essentials ===== */}
      <Card className="border-2 border-foreground">
        <CardHeader><CardTitle>Production</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div>
            <Label>Daily ebook quota</Label>
            <Input
              type="number" min={0} max={100}
              value={s.daily_quota}
              onChange={(e) => setS({ ...s, daily_quota: Number(e.target.value) })}
              onBlur={(e) => patchSettings({ daily_quota: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label>Autopilot mode</Label>
            <Select value={s.autopilot_mode} onValueChange={(v) => patchSettings({ autopilot_mode: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="safe">Safe (draft only)</SelectItem>
                <SelectItem value="full">Full (auto-publish)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Daily budget (USD)</Label>
            <Input
              type="number" step="0.01"
              value={s.daily_budget_usd}
              onChange={(e) => setS({ ...s, daily_budget_usd: Number(e.target.value) })}
              onBlur={(e) => patchSettings({ daily_budget_usd: Number(e.target.value) })}
            />
          </div>
          <div className="flex items-center justify-between border-2 border-foreground/10 px-3 rounded">
            <div>
              <Label>Auto-publish</Label>
              <p className="text-xs text-muted-foreground">Only active in Full mode.</p>
            </div>
            <Switch checked={s.auto_publish} onCheckedChange={(v) => patchSettings({ auto_publish: v })} />
          </div>
        </CardContent>
      </Card>

      <Card className="border-2 border-foreground">
        <CardHeader><CardTitle>Quality gates</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div>
            <Label>Minimum word count</Label>
            <Input
              type="number"
              value={s.min_word_count ?? 0}
              onChange={(e) => setS({ ...s, min_word_count: Number(e.target.value) })}
              onBlur={(e) => patchSettings({ min_word_count: Number(e.target.value) })}
            />
            <p className="text-xs text-muted-foreground mt-1">Recommended: 18,000.</p>
          </div>
          <div>
            <Label>Minimum QC score</Label>
            <Input
              type="number" min={0} max={100}
              value={s.min_score_threshold ?? 0}
              onChange={(e) => setS({ ...s, min_score_threshold: Number(e.target.value) })}
              onBlur={(e) => patchSettings({ min_score_threshold: Number(e.target.value) })}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-2 border-foreground">
        <CardHeader><CardTitle>Categories enabled for autopilot</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {cats.length === 0 && <p className="text-sm text-muted-foreground">No categories yet — add one under "Category management" below.</p>}
          {cats.map((c) => (
            <label key={c.id} className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={s.enabled_category_ids.includes(c.id)}
                onCheckedChange={(v) => toggleCategoryEnabled(c.id, !!v)}
              />
              <span>{c.name}</span>
              <span className="text-xs text-muted-foreground font-mono">${c.default_price}</span>
              {!c.enabled && <span className="text-xs text-muted-foreground">(disabled globally)</span>}
            </label>
          ))}
        </CardContent>
      </Card>

      {/* ===== Advanced sections (collapsibles) ===== */}
      {advanced && (
        <>
          <AdvancedSection title="Advanced QC thresholds">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Auto-rewrite limit (per stage)</Label>
                <Input
                  type="number" min={0} max={5}
                  value={s.auto_rewrite_limit ?? 2}
                  onChange={(e) => setS({ ...s, auto_rewrite_limit: Number(e.target.value) })}
                  onBlur={(e) => patchSettings({ auto_rewrite_limit: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label>Max rewrite attempts</Label>
                <Input
                  type="number" min={0} max={5}
                  value={s.max_rewrite_attempts ?? 2}
                  onChange={(e) => setS({ ...s, max_rewrite_attempts: Number(e.target.value) })}
                  onBlur={(e) => patchSettings({ max_rewrite_attempts: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label>Max AI calls per ebook</Label>
                <Input
                  type="number" min={10} max={500}
                  value={s.max_ai_calls_per_ebook ?? 60}
                  onChange={(e) => setS({ ...s, max_ai_calls_per_ebook: Number(e.target.value) })}
                  onBlur={(e) => patchSettings({ max_ai_calls_per_ebook: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label>Per-ebook budget (USD)</Label>
                <Input
                  type="number" step="0.25"
                  value={s.per_ebook_budget_usd ?? 2}
                  onChange={(e) => setS({ ...s, per_ebook_budget_usd: Number(e.target.value) })}
                  onBlur={(e) => patchSettings({ per_ebook_budget_usd: Number(e.target.value) })}
                />
              </div>
            </div>
          </AdvancedSection>

          <AdvancedSection title="Category management">
            <div className="space-y-3">
              <div className="grid grid-cols-12 gap-2 items-end border-b border-foreground/10 pb-3">
                <div className="col-span-4">
                  <Label className="text-xs">Name</Label>
                  <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </div>
                <div className="col-span-4">
                  <Label className="text-xs">Slug</Label>
                  <Input value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Price</Label>
                  <Input type="number" step="0.01" value={draft.default_price} onChange={(e) => setDraft({ ...draft, default_price: Number(e.target.value) })} />
                </div>
                <Button className="col-span-2" onClick={addCategory} disabled={savingCats}>
                  <Plus className="size-3 mr-1" /> Add
                </Button>
              </div>
              {cats.map((c) => (
                <div key={c.id} className="grid grid-cols-12 gap-2 items-center">
                  <Input className="col-span-4" defaultValue={c.name} onBlur={(e) => e.target.value !== c.name && updateCategory(c, { name: e.target.value })} />
                  <Input className="col-span-3 font-mono text-xs" defaultValue={c.slug} disabled />
                  <Input className="col-span-2" type="number" step="0.01" defaultValue={c.default_price}
                    onBlur={(e) => Number(e.target.value) !== c.default_price && updateCategory(c, { default_price: Number(e.target.value) })} />
                  <div className="col-span-2 flex items-center gap-2 text-xs">
                    <Switch checked={c.enabled} onCheckedChange={(v) => updateCategory(c, { enabled: v })} />
                    <span>{c.enabled ? "On" : "Off"}</span>
                  </div>
                  <Button variant="ghost" size="icon" className="col-span-1" onClick={() => deleteCategory(c.id)}>
                    <Trash2 className="size-3" />
                  </Button>
                  <Textarea
                    className="col-span-12 text-xs"
                    defaultValue={c.cover_style_prompt ?? ""}
                    placeholder="Cover style prompt"
                    onBlur={(e) => e.target.value !== (c.cover_style_prompt ?? "") && updateCategory(c, { cover_style_prompt: e.target.value })}
                  />
                </div>
              ))}
            </div>
          </AdvancedSection>

          <AdvancedSection title="Shopify & scheduling">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center justify-between border-2 border-foreground/10 px-3 rounded">
                <Label>Shopify draft upload</Label>
                <Switch checked={s.shopify_draft_upload_enabled !== false} onCheckedChange={(v) => patchSettings({ shopify_draft_upload_enabled: v })} />
              </div>
              <div>
                <Label>Max Shopify uploads / day</Label>
                <Input
                  type="number" min={0} max={200}
                  value={s.max_shopify_uploads_per_day ?? 20}
                  onChange={(e) => setS({ ...s, max_shopify_uploads_per_day: Number(e.target.value) })}
                  onBlur={(e) => patchSettings({ max_shopify_uploads_per_day: Number(e.target.value) })}
                />
              </div>
              <div className="flex items-center justify-between border-2 border-foreground/10 px-3 rounded">
                <Label>Daily cron enabled</Label>
                <Switch checked={s.cron_enabled} onCheckedChange={(v) => patchSettings({ cron_enabled: v })} />
              </div>
              <div>
                <Label>Publish hour (UTC)</Label>
                <Input
                  type="number" min={0} max={23}
                  value={s.publish_hour_utc ?? 14}
                  onChange={(e) => setS({ ...s, publish_hour_utc: Number(e.target.value) })}
                  onBlur={(e) => patchSettings({ publish_hour_utc: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="mt-4">
              <ShopifyConnectionPanel />
            </div>
          </AdvancedSection>

          <AdvancedSection title="API & model settings">
            <div>
              <Label>Generation tier</Label>
              <Select value={s.mode} onValueChange={(v) => patchSettings({ mode: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low_cost">Low cost (Flash Lite)</SelectItem>
                  <SelectItem value="hybrid">Hybrid (recommended)</SelectItem>
                  <SelectItem value="premium">Premium (Pro models)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-2">
                AI key, prompts and model routing are configured server-side. Edit prompts in the codebase.
              </p>
            </div>
          </AdvancedSection>

          <AdvancedSection title="Debug — AI cost log" onOpen={loadCosts}>
            {costs.length === 0
              ? <p className="text-xs text-muted-foreground">No cost records loaded yet — opening this section fetches the last 100.</p>
              : (
                <div className="text-xs font-mono overflow-x-auto">
                  <table className="w-full">
                    <thead className="border-b border-foreground/20">
                      <tr className="text-left">
                        <th className="p-1">Time</th><th className="p-1">Step</th><th className="p-1">Model</th>
                        <th className="p-1 text-right">In/Out</th><th className="p-1 text-right">USD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {costs.map((r) => (
                        <tr key={r.id} className="border-b border-foreground/5">
                          <td className="p-1 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                          <td className="p-1">{r.step}</td>
                          <td className="p-1 truncate max-w-[160px]">{r.model}</td>
                          <td className="p-1 text-right">{r.input_tokens}/{r.output_tokens}</td>
                          <td className="p-1 text-right">${Number(r.cost_usd).toFixed(6)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </AdvancedSection>
        </>
      )}

      <p className="text-xs text-muted-foreground">
        Need to inspect or edit a single job? Open <RouterLink to="/admin/production" className="underline">Production</RouterLink> and click View on the row.
        Job-level rewrite, premium positioning, generate-alternatives, raw idea JSON and other power tools live on the job detail page.
        <ExternalLink className="inline size-3 ml-1" />
      </p>
    </div>
  );
}

function AdvancedSection({ title, children, onOpen }: { title: string; children: React.ReactNode; onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={(v) => { setOpen(v); if (v) onOpen?.(); }}>
      <Card className="border-2 border-foreground">
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer flex flex-row items-center justify-between pb-3 hover:bg-muted/40">
            <CardTitle className="text-sm font-mono uppercase">{title}</CardTitle>
            <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent>{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

type ShopifyTestResult = {
  ok: boolean;
  status: string;
  message: string;
  domain?: string;
  api_version?: string;
  token_prefix?: string | null;
  shop_name?: string | null;
  plan?: string | null;
  granted_scopes?: string[];
  problems?: string[];
  detail?: string;
  http_status?: number;
};

const REQUIRED_SCOPES_DRAFT = ["write_products", "read_products"];
const REQUIRED_SCOPES_FILES = ["write_files", "read_files"];
const REQUIRED_SCOPES_PUBLISH = ["write_publications", "read_publications"];

function ShopifyConnectionPanel() {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ShopifyTestResult | null>(null);

  async function runTest() {
    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("shopify-test-connection", { body: {} });
      if (error) throw new Error(error.message);
      setResult(data as ShopifyTestResult);
      if ((data as ShopifyTestResult).ok) toast.success("Shopify connection OK");
      else toast.error((data as ShopifyTestResult).message ?? "Shopify test failed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTesting(false);
    }
  }

  const granted = new Set(result?.granted_scopes ?? []);
  const scopeRow = (scope: string) => (
    <div key={scope} className="flex items-center gap-2 text-xs font-mono">
      <span className={granted.has(scope) ? "text-emerald-700" : "text-muted-foreground"}>
        {granted.has(scope) ? "✓" : "○"}
      </span>
      <span className={granted.has(scope) ? "" : "text-muted-foreground"}>{scope}</span>
    </div>
  );

  const badgeColor =
    !result ? "bg-muted text-foreground"
    : result.ok ? "bg-emerald-100 text-emerald-800 border border-emerald-700"
    : "bg-red-100 text-red-800 border border-red-700";

  return (
    <div className="border-2 border-foreground/20 rounded p-4 space-y-3 bg-muted/20">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="font-mono uppercase text-xs tracking-wider">Shopify connection</p>
          <p className="text-xs text-muted-foreground">
            Credentials are stored server-side. Use Test to verify the token, store domain, and scopes.
          </p>
        </div>
        <Button onClick={runTest} disabled={testing} size="sm">
          {testing ? "Testing…" : "Test Shopify Connection"}
        </Button>
      </div>

      {result && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
            <span className={`px-2 py-0.5 rounded ${badgeColor}`}>{result.status.toUpperCase()}</span>
            {result.domain && <span>domain: {result.domain}</span>}
            {result.api_version && <span>· api: {result.api_version}</span>}
            {result.token_prefix && <span>· token: {result.token_prefix}</span>}
            {result.shop_name && <span>· shop: {result.shop_name}</span>}
          </div>
          <p className="text-xs">{result.message}</p>
          {result.detail && (
            <pre className="text-[10px] font-mono bg-background border border-foreground/10 rounded p-2 overflow-x-auto whitespace-pre-wrap">
              {result.detail}
            </pre>
          )}
          <div className="pt-2 border-t border-foreground/10">
            <p className="text-[10px] font-mono uppercase text-muted-foreground mb-1">Required scopes</p>
            <div className="grid grid-cols-3 gap-x-4 gap-y-1">
              <div>
                <p className="text-[10px] text-muted-foreground">Draft product</p>
                {REQUIRED_SCOPES_DRAFT.map(scopeRow)}
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">PDF / cover files</p>
                {REQUIRED_SCOPES_FILES.map(scopeRow)}
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Full publish (optional)</p>
                {REQUIRED_SCOPES_PUBLISH.map(scopeRow)}
              </div>
            </div>
          </div>
          {!result.ok && result.status === "invalid_token" && (
            <div className="border-l-2 border-orange-700 bg-orange-50/60 p-3 text-xs space-y-1">
              <p className="font-semibold">Admin needed — how to fix</p>
              <ol className="list-decimal ml-4 space-y-0.5">
                <li>Open Shopify Admin → Settings → Apps and sales channels → Develop apps.</li>
                <li>Select the custom app used for this project.</li>
                <li>Copy the Admin API access token from API credentials.</li>
                <li>Update the <code>SHOPIFY_ADMIN_TOKEN</code> secret in Lovable Cloud.</li>
                <li>Confirm <code>SHOPIFY_STORE_DOMAIN</code> matches the same store.</li>
                <li>Click Test Shopify Connection again, then Re-push Shopify Draft.</li>
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
