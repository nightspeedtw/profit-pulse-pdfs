import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Pull sales for kids books joined via order_items → ebooks_kids
    const { data: sales } = await supabase
      .from('order_items')
      .select('ebook_id, quantity, created_at')
      .gte('created_at', cutoff);

    const kidsIds = new Set<string>();
    const { data: kidsBooks } = await supabase.from('ebooks_kids').select('id, age_group_id, theme_ids').neq('book_type', 'coloring_book');
    (kidsBooks ?? []).forEach(b => kidsIds.add(b.id as string));
    const bookMap = new Map((kidsBooks ?? []).map(b => [b.id, b] as const));

    // Aggregate sales per (age, theme) cell
    const cellSales = new Map<string, number>();
    for (const s of sales ?? []) {
      if (!kidsIds.has(s.ebook_id as string)) continue;
      const b = bookMap.get(s.ebook_id as string);
      if (!b || !b.age_group_id) continue;
      for (const tid of (b.theme_ids as string[]) ?? []) {
        const k = `${b.age_group_id}::${tid}`;
        cellSales.set(k, (cellSales.get(k) ?? 0) + Number(s.quantity ?? 1));
      }
    }

    const { data: weights } = await supabase
      .from('kids_category_weights')
      .select('id, age_group_id, theme_id, auto_managed');

    let updated = 0;
    for (const w of weights ?? []) {
      const s = cellSales.get(`${w.age_group_id}::${w.theme_id}`) ?? 0;
      const patch: Record<string, unknown> = { sales_last_30d: s };
      if (w.auto_managed) patch.weight = Math.max(1, 10 + s * 3);
      await supabase.from('kids_category_weights').update(patch).eq('id', w.id);
      updated++;
    }
    return new Response(JSON.stringify({ ok: true, updated }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
