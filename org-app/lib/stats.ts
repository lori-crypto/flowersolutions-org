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
  client?: string; grupa?: string; q?: string; inv?: boolean;
}): Promise<StatRow[]> {
  const { data, error } = await supabase.rpc("app_stat_sales", {
    p_from: p.from, p_to: p.to, p_dim: p.dim,
    p_client: p.client || null, p_grupa: p.grupa || null, p_q: p.q || null,
    p_inv: !!p.inv,
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

export type ProgressRow = {
  k: "year" | "month" | "week" | "orders";
  cur_from: string; cur_to: string;
  prev_from: string; prev_same_to: string; prev_full_to: string;
  cur: number; prev_same: number; prev_full: number;
};

export async function statProgress(): Promise<ProgressRow[]> {
  const { data, error } = await supabase.rpc("app_stat_progress");
  fail(error);
  return ((data as ProgressRow[]) ?? []).map(r => ({
    ...r,
    cur: Number(r.cur) || 0,
    prev_same: Number(r.prev_same) || 0,
    prev_full: Number(r.prev_full) || 0,
  }));
}

export async function statOptions(): Promise<{ clients: string[]; grupak: string[] }> {
  const { data, error } = await supabase.rpc("app_stat_options");
  fail(error);
  const rows = (data as { kind: string; label: string }[]) ?? [];
  return {
    clients: rows.filter(r => r.kind === "client").map(r => r.label)
      .sort((a, b) => a.localeCompare(b, "hu")),
    grupak: rows.filter(r => r.kind === "grupa").map(r => r.label)
      .sort((a, b) => a.localeCompare(b, "hu")),
  };
}

export type CompareWeek = {
  week: string; week_end: string; is_future: boolean;
  cur_order: number; cur_gross: number; cur_net: number;
  ly_from: string; ly_to: string; ly_order: number; ly_gross: number;
};

export async function statCompareWeeks(from: string, to: string): Promise<CompareWeek[]> {
  const { data, error } = await supabase.rpc("app_stat_compare_weeks", { p_from: from, p_to: to });
  fail(error);
  return ((data as CompareWeek[]) ?? []).map(r => ({
    ...r,
    cur_order: Number(r.cur_order) || 0, cur_gross: Number(r.cur_gross) || 0,
    cur_net: Number(r.cur_net) || 0, ly_order: Number(r.ly_order) || 0,
    ly_gross: Number(r.ly_gross) || 0,
  }));
}

export async function getCycles(): Promise<string[]> {
  const { data, error } = await supabase.from("webshop_cycles")
    .select("delivery_date").order("delivery_date");
  fail(error);
  return ((data as { delivery_date: string }[]) ?? []).map(c => c.delivery_date);
}
