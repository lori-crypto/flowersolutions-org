import { supabase } from "./supabaseClient";

export type CashUnit = {
  id: string; code: string; name_hu: string; name_ro: string | null;
  kind: "bolt" | "lerakat"; sort: number;
  nexus_today: number | null;
  nexus_synced_at: string | null;
  today_day: CashDay | null;
  monetar: { denom: number; qty: number }[];
  expenses: CashExpense[];
  history: CashHistoryDay[];
};
export type CashDay = {
  id: string; unit_id: string; day: string; status: string;
  float_morning: number | null; float_evening: number | null;
  counted_cash: number | null; z_cash: number | null; z_card: number | null;
  pos_settlement: number | null; nexus_revenue: number | null;
  cash_diff: number | null; card_diff: number | null;
  expl_cash: string | null; expl_card: string | null; review_note: string | null;
};
export type CashExpense = {
  id: string; amount: number; category_id: string | null;
  vehicle_id: string | null; client_name: string | null; description: string | null;
};
export type CashHistoryDay = {
  day: string; status: string; counted_cash: number | null;
  nexus_revenue: number | null; cash_diff: number | null;
  expl_cash: string | null; expenses_total: number; closed_by_name: string | null;
};
export type CashCategory = {
  id: string; name_hu: string; name_ro: string | null;
  req_vehicle: boolean; req_client: boolean; req_desc: boolean; req_photo: boolean;
  staff_can_use: boolean; approved: boolean; active: boolean; sort: number;
};
export type CashVehicle = { id: string; plate: string; name: string | null; active: boolean };
export type CashQuicklabel = { id: string; category_id: string; label: string };

const fail = (e: { message?: string } | null) => { if (e) throw new Error(e.message || "DB hiba"); };

export async function cashContext(): Promise<{ today: string; units: CashUnit[] }> {
  const { data, error } = await supabase.rpc("app_cash_context");
  fail(error);
  return data as { today: string; units: CashUnit[] };
}

export type DayPayload = {
  float_morning?: string; float_evening?: string;
  z_cash?: string; z_card?: string; pos_settlement?: string;
  nexus_revenue?: string;
  expl_cash?: string; expl_card?: string;
  monetar: { denom: number; qty: number }[];
  expenses: { amount: number; category_id: string | null; vehicle_id: string | null;
              client_name: string | null; description: string | null }[];
};

export async function cashSaveDay(unitId: string, payload: DayPayload): Promise<string> {
  const { data, error } = await supabase.rpc("app_cash_save_day", {
    p_unit: unitId, p_payload: payload,
  });
  fail(error);
  return data as string;
}

export async function cashCloseDay(unitId: string): Promise<{ cash_diff: number; card_diff: number | null }> {
  const { data, error } = await supabase.rpc("app_cash_close_day", { p_unit: unitId });
  fail(error);
  return data as { cash_diff: number; card_diff: number | null };
}

export async function cashMeta(): Promise<{
  categories: CashCategory[]; vehicles: CashVehicle[]; quicklabels: CashQuicklabel[];
}> {
  const [c, v, q] = await Promise.all([
    supabase.from("cash_categories").select("*").eq("active", true).order("sort"),
    supabase.from("cash_vehicles").select("*").eq("active", true).order("plate"),
    supabase.from("cash_quicklabels").select("*"),
  ]);
  fail(c.error); fail(v.error); fail(q.error);
  return {
    categories: (c.data as CashCategory[]) ?? [],
    vehicles: (v.data as CashVehicle[]) ?? [],
    quicklabels: (q.data as CashQuicklabel[]) ?? [],
  };
}

export const DENOMS = [500, 200, 100, 50, 10, 5, 1, 0.5, 0.1];

export type LedgerEntry = {
  entry_date: string; etype: "zaras" | "letet" | "koltseg" | "korrekcio";
  unit_name: string | null; label: string; amount: number;
  receipt_path: string | null; who: string | null; status: string | null; expl: string | null;
};

export async function cashBalance(): Promise<{ opening_balance: number; opening_date: string; balance: number }> {
  const { data, error } = await supabase.rpc("app_cash_balance");
  fail(error);
  return data as { opening_balance: number; opening_date: string; balance: number };
}

export async function cashLedger(from: string, to: string): Promise<LedgerEntry[]> {
  const { data, error } = await supabase.rpc("app_cash_ledger", { p_from: from, p_to: to });
  fail(error);
  return ((data as LedgerEntry[]) ?? []).map(r => ({ ...r, amount: Number(r.amount) || 0 }));
}

export async function cashQuickAdd(p: {
  day: string; kind: "letet" | "koltseg" | "korrekcio"; amount: number;
  unit?: string | null; category?: string | null; vehicle?: string | null;
  client?: string | null; desc?: string | null; note?: string | null; receipt?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("app_cash_quick_add", {
    p_day: p.day, p_kind: p.kind, p_amount: p.amount,
    p_unit: p.unit || null, p_category: p.category || null, p_vehicle: p.vehicle || null,
    p_client: p.client || null, p_desc: p.desc || null, p_note: p.note || null,
    p_receipt: p.receipt || null,
  });
  fail(error);
  return data as string;
}

export async function uploadReceipt(file: File): Promise<string> {
  const safe = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(-60);
  const path = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}-${safe}`;
  const { error } = await supabase.storage.from("bizonylatok").upload(path, file);
  fail(error);
  return path;
}

export async function receiptUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from("bizonylatok").createSignedUrl(path, 120);
  fail(error);
  return data!.signedUrl;
}
