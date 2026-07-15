import { supabase } from "@/integrations/supabase/client";
import type { MarketRow } from "./math";

// The wire types are loose because these tables are new and not yet in the
// generated Supabase types file. We narrow to what we actually consume.
type Row = Record<string, unknown>;

export interface RoyaltyBookListing {
  book_id: string;
  title: string;
  category: string | null;
  cover_url: string | null;
  handle: string | null;
  price: number;
  market: MarketRow & {
    id: string;
    current_indicative_book_value_usd: number;
    initial_book_value_usd: number;
    status: string;
  };
  trailing_30d_sales_count: number;
}

function toMarket(row: Row): RoyaltyBookListing["market"] {
  return {
    id: String(row.id),
    total_units: Number(row.total_units),
    units_available: Number(row.units_available),
    current_indicative_unit_price_usd: Number(row.current_indicative_unit_price_usd),
    current_indicative_book_value_usd: Number(row.current_indicative_book_value_usd),
    initial_book_value_usd: Number(row.initial_book_value_usd),
    royalty_pool_percent: Number(row.royalty_pool_percent),
    minimum_purchase_usd: Number(row.minimum_purchase_usd),
    thai_vat_rate: Number(row.thai_vat_rate),
    gateway_fee_rate: Number(row.gateway_fee_rate),
    sales_vat_rate: Number(row.sales_vat_rate),
    sales_gateway_fee_rate: Number(row.sales_gateway_fee_rate),
    book_sale_price_usd: Number(row.book_sale_price_usd),
    status: String(row.status),
  };
}

export async function listRoyaltyBooks(): Promise<RoyaltyBookListing[]> {
  const client = supabase as unknown as {
    from: (t: string) => {
      select: (s: string) => Promise<{ data: Row[] | null; error: Error | null }>;
    };
  };
  const { data: markets, error } = await client
    .from("book_royalty_markets")
    .select("*");
  if (error) throw error;
  if (!markets?.length) return [];

  const bookIds = markets.map((m) => String(m.book_id));
  const { data: books, error: bErr } = await supabase
    .from("ebooks")
    .select("id, title, cover_url, price, category_slug")
    .in("id", bookIds);
  if (bErr) throw bErr;

  const byId = new Map<string, Row>((books ?? []).map((b) => [String(b.id), b as Row]));

  return markets.map((m) => {
    const b = byId.get(String(m.book_id)) ?? {};
    return {
      book_id: String(m.book_id),
      title: String(b.title ?? "Untitled"),
      category: (b.category_slug as string | null) ?? null,
      cover_url: (b.cover_url as string | null) ?? null,
      handle: null,
      price: Number(b.price ?? m.book_sale_price_usd ?? 0),
      market: toMarket(m),
      trailing_30d_sales_count: 0,
    };
  });
}

export async function getRoyaltyBook(bookId: string): Promise<RoyaltyBookListing | null> {
  const client = supabase as unknown as {
    from: (t: string) => {
      select: (s: string) => {
        eq: (col: string, v: string) => {
          maybeSingle: () => Promise<{ data: Row | null; error: Error | null }>;
        };
      };
    };
  };
  const { data: m, error } = await client
    .from("book_royalty_markets")
    .select("*")
    .eq("book_id", bookId)
    .maybeSingle();
  if (error) throw error;
  if (!m) return null;

  const { data: b } = await supabase
    .from("ebooks")
    .select("id, title, cover_url, price, category_slug, product_description")
    .eq("id", bookId)
    .maybeSingle();

  return {
    book_id: String(m.book_id),
    title: String(b?.title ?? "Untitled"),
    category: (b?.category_slug as string | null) ?? null,
    cover_url: (b?.cover_url as string | null) ?? null,
    handle: null,
    price: Number(b?.price ?? m.book_sale_price_usd ?? 0),
    market: toMarket(m),
    trailing_30d_sales_count: 0,
  };
}

export interface ServerQuote {
  units: number;
  unit_price: number;
  subtotal_usd: number;
  vat_usd: number;
  gateway_fee_usd: number;
  total_payment_usd: number;
  ownership_percentage: number;
  estimated_royalty_per_sale: number;
  estimated_break_even_sales_subtotal: number;
  estimated_break_even_sales_total: number;
}

export async function createQuote(bookId: string, opts: { amount_usd?: number; units?: number }) {
  const { data, error } = await supabase.functions.invoke("royalty-quote", {
    body: { book_id: bookId, amount_usd: opts.amount_usd, units: opts.units },
  });
  if (error) throw error;
  return data as { ok: boolean; quote?: Row & ServerQuote; computed?: ServerQuote; error?: string; message?: string };
}

export async function reserveQuote(quoteId: string) {
  const { data, error } = await supabase.functions.invoke("royalty-reserve", {
    body: { quote_id: quoteId },
  });
  if (error) throw error;
  return data as { ok: boolean; message?: string; error?: string };
}

export interface HoldingRow {
  book_id: string;
  units_owned: number;
  ownership_percentage: number;
  average_unit_cost: number;
  subtotal_invested_usd: number;
  total_vat_usd: number;
  total_gateway_fee_usd: number;
  total_paid_usd: number;
  lifetime_royalty_earned: number;
  pending_royalty: number;
}

export async function listMyHoldings(): Promise<HoldingRow[]> {
  const client = supabase as unknown as {
    from: (t: string) => { select: (s: string) => Promise<{ data: Row[] | null; error: Error | null }> };
  };
  const { data, error } = await client.from("royalty_holdings").select("*");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    book_id: String(r.book_id),
    units_owned: Number(r.units_owned),
    ownership_percentage: Number(r.ownership_percentage),
    average_unit_cost: Number(r.average_unit_cost),
    subtotal_invested_usd: Number(r.subtotal_invested_usd),
    total_vat_usd: Number(r.total_vat_usd),
    total_gateway_fee_usd: Number(r.total_gateway_fee_usd),
    total_paid_usd: Number(r.total_paid_usd),
    lifetime_royalty_earned: Number(r.lifetime_royalty_earned),
    pending_royalty: Number(r.pending_royalty),
  }));
}
