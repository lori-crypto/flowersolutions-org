import { supabase } from "./supabaseClient";

export type StatRow = {
  label: string; invoices: number; qty: number;
  net: number; gross: number; cost: number | null;
};
export type CompareRow = {
  week: string; client: string;
  order_ron: number; nexus_net: number; nexus_gross: number;
};

const fail = (e: { message?: string } | null) => { if (e) throw new Error(e.message || "DB hiba"); };

export async function statSales(p: {
  from: string; to: string; dim: string;
  client?: string; grupa?: string; q?: string;
}): Promise<StatRow[]> {
  const { data, error } = await supabase.rpc("app_stat_sales", {
    p_from: p.from, p_to: p.to, p_dim: p.dim,
    p_client: p.client || null, p_grupa: p.grupa || null, p_q: p.q || null,
  });
  fail(error);
  return ((data as StatRow[]) ?? []).map(r => ({
    ...r,
    invoices: Number(r.invoices) || 0, qty: Number(r.qty) || 0,
    net: Number(r.net) || 0, gross: Number(r.gross) || 0,
    cost: r.cost == null ? null : Number(r.cost),
  }));
}

export async function statCompare(from: string, to: string): Promise<CompareRow[]> {
  const { data, error } = await supabase.rpc("app_stat_compare", { p_from: from, p_to: to });
  fail(error);
  return ((data as CompareRow[]) ?? []).map(r => ({
    ...r,
    order_ron: Number(r.order_ron) || 0,
    nexus_net: Number(r.nexus_net) || 0,
    nexus_gross: Number(r.nexus_gross) || 0,
  }));
}

export async function getCycles(): Promise<string[]> {
  const { data, error } = await supabase.from("webshop_cycles")
    .select("delivery_date").order("delivery_date");
  fail(error);
  return ((data as { delivery_date: string }[]) ?? []).map(c => c.delivery_date);
}
