import { supabase } from "@/integrations/supabase/client";

export interface Offering {
  book_id: string;
  book_type: "kids" | "adult";
  title: string;
  cover_url: string | null;
  total_shares: number;
  treasury_shares: number;
  ref_price_per_share: number;
  last_trade_price: number | null;
  last_trade_at: string | null;
  volume_24h_usd: number;
  trailing_90d_net_rev: number;
  listed_at: string;
  updated_at: string;
}

export async function listOfferings(): Promise<Offering[]> {
  const { data, error } = await supabase
    .from("rights_offerings")
    .select("*")
    .order("listed_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Offering[];
}

export async function getOffering(bookId: string): Promise<Offering | null> {
  const { data, error } = await supabase
    .from("rights_offerings")
    .select("*")
    .eq("book_id", bookId)
    .maybeSingle();
  if (error) throw error;
  return (data as Offering) ?? null;
}

export async function getAsks(bookId: string) {
  const { data, error } = await supabase
    .from("rights_orders")
    .select("id, price_per_share, qty_remaining, is_treasury, seller_id, created_at")
    .eq("book_id", bookId)
    .eq("status", "open")
    .order("price_per_share", { ascending: true })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

export async function getRecentTrades(bookId: string, limit = 20) {
  const { data, error } = await supabase
    .from("rights_trades")
    .select("id, qty, price_per_share, gross_usd, executed_at, seller_is_treasury")
    .eq("book_id", bookId)
    .order("executed_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function getPriceHistory(bookId: string, limit = 90) {
  const { data, error } = await supabase
    .from("rights_price_history")
    .select("snapshot_at, ref_price, last_trade_price, volume_usd")
    .eq("book_id", bookId)
    .order("snapshot_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).reverse();
}

export async function getMyWallet() {
  const { data, error } = await supabase.from("wallets").select("*").maybeSingle();
  if (error) throw error;
  return data;
}

export async function getMyWalletTx(limit = 50) {
  const { data, error } = await supabase
    .from("wallet_transactions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function getMyHoldings() {
  const { data, error } = await supabase
    .from("rights_holdings")
    .select("*, rights_offerings!inner(title, cover_url, ref_price_per_share, last_trade_price, book_type)")
    .gt("shares", 0);
  if (error) throw error;
  return data ?? [];
}

export async function getMyOpenOrders() {
  const { data, error } = await supabase
    .from("rights_orders")
    .select("*, rights_offerings!inner(title)")
    .eq("status", "open")
    .not("seller_id", "is", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getMyRoyalties(limit = 50) {
  const { data, error } = await supabase
    .from("royalty_distributions")
    .select("*, rights_offerings!inner(title)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function invoke<T = any>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) throw error;
  if (data && (data as any).ok === false) throw new Error((data as any).error || "request failed");
  return data as T;
}
