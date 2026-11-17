import { supabase } from "./supabaseClient";

// Hőmérséklet-figyelő modul — adatelérés (sql/38_homerseklet.sql)

export type Site = { id: number; name: string; sort: number };
export type Device = {
  id: number; site_id: number; name: string; active: boolean;
  last_seen: string | null; rssi: number | null; fw: string | null;
};
export type Kind = "hutokamra" | "viragos_huto" | "raktar" | "iroda" | "egyeb";
export type Sensor = {
  id: number; device_id: number; hw_addr: string; name: string | null; kind: Kind;
  configured: boolean; active: boolean; sort: number;
  max_temp: number | null; max_delay_min: number | null;
  crit_temp: number | null; crit_delay_min: number | null;
  min_temp: number | null; min_delay_min: number | null;
  offline_min: number; hyst: number; cal_offset: number;
  last_temp: number | null; last_at: string | null;
};
export type AlertKind = "high" | "critical" | "low" | "sensor_fault" | "device_offline" | "site_offline";
export type Alert = {
  id: number; kind: AlertKind; sensor_id: number | null; device_id: number | null; site_id: number | null;
  started_at: string; notified_at: string | null; ack_at: string | null; ack_by: string | null;
  resolved_at: string | null; peak_temp: number | null; threshold: number | null;
};
export type Point = { ts: string; t_min: number; t_avg: number; t_max: number };
export type MinMax = Record<number, { min: number; max: number }>;

// Alapértékek szondatípusonként (a beállító űrlap ezt tölti be típusváltáskor)
export const PRESETS: Record<Kind, Pick<Sensor,
  "max_temp" | "max_delay_min" | "crit_temp" | "crit_delay_min" | "min_temp" | "min_delay_min">> = {
  hutokamra:    { max_temp: 8,    max_delay_min: 20,   crit_temp: 12,   crit_delay_min: 5,    min_temp: 0.5,  min_delay_min: 15 },
  viragos_huto: { max_temp: 10,   max_delay_min: 30,   crit_temp: 14,   crit_delay_min: 10,   min_temp: 1,    min_delay_min: 15 },
  raktar:       { max_temp: 30,   max_delay_min: 30,   crit_temp: null, crit_delay_min: null, min_temp: 3,    min_delay_min: 30 },
  iroda:        { max_temp: null, max_delay_min: null, crit_temp: null, crit_delay_min: null, min_temp: 10,   min_delay_min: 60 },
  egyeb:        { max_temp: null, max_delay_min: null, crit_temp: null, crit_delay_min: null, min_temp: null, min_delay_min: null },
};

const fail = (e: { message?: string } | null) => { if (e) throw new Error(e.message || "DB hiba"); };
const num = (v: unknown) => (v == null ? null : Number(v));

function normSensor(s: Sensor): Sensor {
  return {
    ...s,
    max_temp: num(s.max_temp), crit_temp: num(s.crit_temp), min_temp: num(s.min_temp),
    hyst: Number(s.hyst), cal_offset: Number(s.cal_offset), last_temp: num(s.last_temp),
  };
}

export async function loadAll(): Promise<{
  sites: Site[]; devices: Device[]; sensors: Sensor[]; open: Alert[]; minmax: MinMax;
}> {
  const [a, b, c, d, e] = await Promise.all([
    supabase.from("temp_sites").select("*").order("sort").order("name"),
    supabase.from("temp_devices").select("id, site_id, name, active, last_seen, rssi, fw").order("name"),
    supabase.from("temp_sensors").select("*").order("sort").order("name"),
    supabase.from("temp_alerts").select("*").is("resolved_at", null).order("started_at", { ascending: false }),
    supabase.rpc("temp_minmax24"),
  ]);
  for (const q of [a, b, c, d, e]) fail(q.error);
  const minmax: MinMax = {};
  for (const r of (e.data as { sensor_id: number; t_min: number; t_max: number }[]) ?? []) {
    minmax[r.sensor_id] = { min: Number(r.t_min), max: Number(r.t_max) };
  }
  return {
    sites: (a.data as Site[]) ?? [],
    devices: (b.data as Device[]) ?? [],
    sensors: ((c.data as Sensor[]) ?? []).map(normSensor),
    open: (d.data as Alert[]) ?? [],
    minmax,
  };
}

export async function loadAlertHistory(days = 30): Promise<Alert[]> {
  const from = new Date(Date.now() - days * 86400_000).toISOString();
  const { data, error } = await supabase.from("temp_alerts").select("*")
    .gte("started_at", from).order("started_at", { ascending: false }).limit(300);
  fail(error);
  return (data as Alert[]) ?? [];
}

export async function loadSeries(sensorId: number, from: Date, to: Date): Promise<Point[]> {
  const { data, error } = await supabase.rpc("temp_series", {
    p_sensor: sensorId, p_from: from.toISOString(), p_to: to.toISOString(),
  });
  fail(error);
  return ((data as Point[]) ?? []).map(p => ({
    ts: p.ts, t_min: Number(p.t_min), t_avg: Number(p.t_avg), t_max: Number(p.t_max),
  }));
}

export async function ackAlert(id: number) {
  const { error } = await supabase.rpc("temp_ack", { p_alert: id });
  fail(error);
}

export async function saveSensor(id: number, patch: Partial<Sensor>) {
  const { error } = await supabase.from("temp_sensors").update(patch).eq("id", id);
  fail(error);
}

export async function saveDevice(id: number, patch: Partial<Device>) {
  const { error } = await supabase.from("temp_devices").update(patch).eq("id", id);
  fail(error);
}

export async function addSite(name: string, sort: number) {
  const { error } = await supabase.from("temp_sites").insert({ name: name.trim(), sort });
  fail(error);
}

export async function renameSite(id: number, name: string) {
  const { error } = await supabase.from("temp_sites").update({ name: name.trim() }).eq("id", id);
  fail(error);
}

export async function newDevice(siteId: number, name: string): Promise<string> {
  const { data, error } = await supabase.rpc("temp_device_new", { p_site: siteId, p_name: name });
  fail(error);
  return String(data);
}

export async function rekeyDevice(id: number): Promise<string> {
  const { data, error } = await supabase.rpc("temp_device_rekey", { p_device: id });
  fail(error);
  return String(data);
}
