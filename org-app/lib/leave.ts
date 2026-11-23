import { supabase } from "./supabaseClient";
import { Person } from "./orgboard";

export type LeaveBoard = { id: string; name_hu: string; name_ro: string | null; sort: number };
export type LeaveType = {
  code: string; name_hu: string; name_ro: string | null; color: string;
  counts_quota: boolean; self_service: boolean; limit_szamit: boolean; sort: number;
};
export type Part = "egesz" | "de" | "du";
export type LeaveEntry = {
  id: string; board_id: string; person_id: string; day: string; part: Part;
  type_code: string; note: string | null; person: Person | null;
  /** kivett ünnepnapnál: melyik ünnepnap helyett (SQL 39) */
  holiday_day?: string | null;
  /** ok | fuggo (betelt napra, jóváhagyásra vár) | elutasitva (SQL 42) */
  status?: "ok" | "fuggo" | "elutasitva";
  pending_group?: string | null;
  decided_by?: string | null;
};
/** érvényes (jóváhagyott) bejegyzés — a régi, státusz nélküli sorok is azok */
export const isOk = (e: { status?: string }) => !e.status || e.status === "ok";
export type Blackout = {
  id: string; board_id: string; from_day: string; to_day: string; reason: string | null;
};
export type Holiday = { day: string; name_hu: string; name_ro: string | null };
export type BoardMember = { person_id: string; board_id: string };
export type Rule = { board_id: string; key: string; value: string };
export type Quota = { person_id: string; year: number; days: number;
  /** előző évről áthozott napok (SQL 41) */ carry_over?: number };

export type LeaveStatic = {
  boards: LeaveBoard[]; types: LeaveType[]; persons: Person[];
  members: BoardMember[]; rules: Rule[]; me: Person | null; isHr: boolean;
  /** hétvégi ügyeletet bárkinek felvehet/módosíthat/törölhet (HR, admin vagy külön jog) */
  canDuty: boolean;
  /** az összes ünnepnap (kivett ünnepnap választóhoz, évhatáron át is) */
  allHolidays: Holiday[];
};

const fail = (e: { message?: string } | null) => { if (e) throw new Error(e.message || "DB hiba"); };

export async function loadLeaveStatic(): Promise<LeaveStatic> {
  const [{ data: { session } }, boardsQ, typesQ, personsQ, membersQ, rulesQ, capsQ, holQ] =
    await Promise.all([
      supabase.auth.getSession(),
      supabase.from("leave_boards").select("*").order("sort"),
      supabase.from("leave_types").select("*").order("sort"),
      supabase.from("persons").select("*").eq("active", true).order("name"),
      supabase.from("board_members").select("*"),
      supabase.from("leave_rules").select("*"),
      supabase.from("person_capabilities").select("capability"),
      supabase.from("holidays").select("*").order("day"),
    ]);
  for (const q of [boardsQ, typesQ, personsQ, membersQ, rulesQ, capsQ, holQ]) fail(q.error ?? null);
  const uid = session?.user?.id;
  const persons = (personsQ.data as Person[]) ?? [];
  const meQ = uid
    ? await supabase.from("persons").select("*").eq("user_id", uid).maybeSingle()
    : { data: null };
  const caps = new Set(((capsQ.data as { capability: string }[]) ?? []).map(c => c.capability));
  return {
    boards: (boardsQ.data as LeaveBoard[]) ?? [],
    types: (typesQ.data as LeaveType[]) ?? [],
    persons,
    members: (membersQ.data as BoardMember[]) ?? [],
    rules: (rulesQ.data as Rule[]) ?? [],
    me: (meQ.data as Person | null) ?? null,
    isHr: caps.has("hr") || caps.has("admin"),
    canDuty: caps.has("hr") || caps.has("admin") || caps.has("szabadsag.ugyelet"),
    allHolidays: (holQ.data as Holiday[]) ?? [],
  };
}

/** Egy tábla egy évének bejegyzései + zárolásai + ünnepnapok + saját keret. */
export async function loadLeaveYear(boardId: string, year: number, personId: string | null) {
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const [entriesQ, blackoutsQ, holidaysQ, quotaQ, myEntriesQ, myHolQ] = await Promise.all([
    supabase.from("leave_entries").select("*, person:persons(*)")
      .eq("board_id", boardId).gte("day", from).lte("day", to).order("day"),
    supabase.from("blackout_periods").select("*").eq("board_id", boardId),
    supabase.from("holidays").select("*").gte("day", from).lte("day", to),
    personId
      ? supabase.from("leave_quotas").select("*").eq("person_id", personId).eq("year", year).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    personId
      ? supabase.from("leave_entries").select("*, person:persons(*)")
          .eq("person_id", personId).gte("day", from).lte("day", to).order("day")
      : Promise.resolve({ data: [], error: null }),
    // az idei ünnepnapok kivétele (akár jövő év elején is) — a számlálóhoz
    personId
      ? supabase.from("leave_entries").select("*, person:persons(*)").eq("person_id", personId)
          .eq("type_code", "unnepnap_kivet").gte("holiday_day", from).lte("holiday_day", to)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const q of [entriesQ, blackoutsQ, holidaysQ, quotaQ, myEntriesQ, myHolQ]) fail((q as { error: { message?: string } | null }).error);
  return {
    entries: (entriesQ.data as LeaveEntry[]) ?? [],
    blackouts: (blackoutsQ.data as Blackout[]) ?? [],
    holidays: (holidaysQ.data as Holiday[]) ?? [],
    quota: (quotaQ.data as Quota | null) ?? null,
    myEntries: (myEntriesQ.data as LeaveEntry[]) ?? [],
    myHolEntries: (myHolQ.data as LeaveEntry[]) ?? [],
  };
}

export async function addLeave(boardId: string, personId: string, days: string[],
                               part: Part, type: string, note: string, holiday: string | null = null) {
  const { error } = await supabase.rpc("app_leave_add", {
    p_board: boardId, p_person: personId, p_days: days,
    p_part: part, p_type: type, p_note: note, p_holiday: holiday,
  });
  if (error && /schema cache|PGRST202/i.test(error.message || ""))
    throw new Error("Előbb futtatni kell a 39-es SQL fájlt az adatbázison.");
  fail(error);
}

/** Meglévő bejegyzés módosítása (HR): más kolléga, nap, napszak, megjegyzés. */
export async function updateLeave(id: string, personId: string, day: string, part: Part, note: string,
                                  holiday: string | null = null) {
  const { error } = await supabase.rpc("app_leave_update", {
    p_id: id, p_person: personId, p_day: day, p_part: part, p_note: note, p_holiday: holiday,
  });
  if (error && /schema cache|PGRST202/i.test(error.message || ""))
    throw new Error("Előbb futtatni kell a 39-es SQL fájlt az adatbázison.");
  fail(error);
}

export async function deleteLeave(id: string) {
  const { error } = await supabase.rpc("app_leave_delete", { p_id: id });
  fail(error);
}

// ── Admin (HR) műveletek — RLS védi ─────────────────────────
export async function addBlackout(boardId: string, from: string, to: string, reason: string) {
  const { error } = await supabase.from("blackout_periods")
    .insert({ board_id: boardId, from_day: from, to_day: to, reason: reason || null });
  fail(error);
}
export async function deleteBlackout(id: string) {
  const { error } = await supabase.from("blackout_periods").delete().eq("id", id);
  fail(error);
}
export async function updateBlackout(id: string, from: string, to: string, reason: string) {
  const { error } = await supabase.from("blackout_periods")
    .update({ from_day: from, to_day: to, reason: reason || null }).eq("id", id);
  fail(error);
}
/** HR: függő kérések (minden táblán) */
export async function loadPending() {
  const { data, error } = await supabase.from("leave_entries")
    .select("*, person:persons(*), board:leave_boards(name_hu, name_ro)")
    .eq("status", "fuggo").order("day");
  if (error && /status/i.test(error.message || "")) return [];
  fail(error);
  return (data as (LeaveEntry & { board: { name_hu: string; name_ro: string | null } | null })[]) ?? [];
}
export async function decideLeave(group: string, ok: boolean) {
  const { error } = await supabase.rpc("app_leave_decide", { p_group: group, p_ok: ok });
  fail(error);
}

export async function setRule(boardId: string, key: string, value: string) {
  const { error } = await supabase.from("leave_rules").upsert({ board_id: boardId, key, value });
  fail(error);
}
export async function setQuota(personId: string, year: number, days: number, carry = 0) {
  const { error } = await supabase.from("leave_quotas")
    .upsert({ person_id: personId, year, days, carry_over: carry });
  if (error && /carry_over/i.test(error.message || ""))
    throw new Error("Előbb futtatni kell a 41-es SQL fájlt az adatbázison.");
  fail(error);
}
export async function setMembership(personId: string, boardId: string, member: boolean) {
  if (member) {
    const { error } = await supabase.from("board_members").insert({ person_id: personId, board_id: boardId });
    if (error && !/duplicate/i.test(error.message)) fail(error);
  } else {
    const { error } = await supabase.from("board_members").delete()
      .eq("person_id", personId).eq("board_id", boardId);
    fail(error);
  }
}

// ── Ünnepnap-generálás bármely évre ─────────────────────────
const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Ortodox húsvétvasárnap (Julián-számítás + 13 nap, 1900–2099 között érvényes). */
function orthodoxEaster(y: number): Date {
  const a = y % 4, b = y % 7, c = y % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  const dt = new Date(y, month - 1, day);
  dt.setDate(dt.getDate() + 13);
  return dt;
}

/** Katolikus (gregorián) húsvétvasárnap — Meeus-algoritmus. */
function catholicEaster(y: number): Date {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}

const plus = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

export function computeHolidays(y: number): { day: string; name_hu: string; name_ro: string }[] {
  const oE = orthodoxEaster(y), cE = catholicEaster(y);
  const fix = (m: number, d: number, hu: string, ro: string) =>
    ({ day: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, name_hu: hu, name_ro: ro });
  const mov = (d: Date, hu: string, ro: string) => ({ day: isoLocal(d), name_hu: hu, name_ro: ro });
  return [
    fix(1, 1, "Újév", "Anul Nou"),
    fix(1, 2, "Újév másnapja", "A doua zi de Anul Nou"),
    fix(1, 6, "Vízkereszt", "Boboteaza"),
    fix(1, 7, "Keresztelő Szt. János", "Sfântul Ioan Botezătorul"),
    fix(1, 24, "Az egyesülés napja", "Ziua Unirii Principatelor"),
    fix(5, 1, "A munka ünnepe", "Ziua Muncii"),
    fix(6, 1, "Gyermeknap", "Ziua Copilului"),
    fix(8, 15, "Nagyboldogasszony", "Adormirea Maicii Domnului"),
    fix(11, 30, "Szt. András", "Sfântul Andrei"),
    fix(12, 1, "Románia nemzeti ünnepe", "Ziua Națională"),
    fix(12, 25, "Karácsony", "Crăciunul"),
    fix(12, 26, "Karácsony másnapja", "A doua zi de Crăciun"),
    mov(plus(oE, -2), "Nagypéntek (ortodox)", "Vinerea Mare"),
    mov(oE, "Húsvét (ortodox)", "Paștele"),
    mov(plus(oE, 1), "Húsvéthétfő (ortodox)", "A doua zi de Paște"),
    mov(plus(oE, 49), "Pünkösd (ortodox)", "Rusaliile"),
    mov(plus(oE, 50), "Pünkösdhétfő (ortodox)", "A doua zi de Rusalii"),
    mov(plus(cE, -2), "Nagypéntek (katolikus)", "Vinerea Mare (catolică)"),
    mov(cE, "Húsvét (katolikus)", "Paștele catolic"),
    mov(plus(cE, 1), "Húsvéthétfő (katolikus)", "A doua zi de Paște (catolic)"),
    mov(plus(cE, 49), "Pünkösd (katolikus)", "Rusaliile catolice"),
    mov(plus(cE, 50), "Pünkösdhétfő (katolikus)", "A doua zi de Rusalii (catolic)"),
  ];
}

/** Feltölti az adott év ünnepnapjait (meglévőket nem bántja). HR-jog kell hozzá. */
export async function generateHolidays(year: number): Promise<number> {
  const rows = computeHolidays(year);
  const { error } = await supabase.from("holidays")
    .upsert(rows, { onConflict: "day", ignoreDuplicates: true });
  fail(error);
  return rows.length;
}

// ── segédek ─────────────────────────────────────────────────
export const partWeight = (p: Part) => (p === "egesz" ? 1 : 0.5);

export function usedQuotaDays(myEntries: LeaveEntry[], types: LeaveType[]): number {
  const quotaTypes = new Set(types.filter(t => t.counts_quota).map(t => t.code));
  return myEntries.reduce((s, e) => s + (quotaTypes.has(e.type_code) ? partWeight(e.part) : 0), 0);
}

// ── Számláló (szabadság + ünnepnapok) ───────────────────────
/** A számlálók ettől az évtől számolnak (2026-ban még papíron ment). */
export const COUNT_FROM_YEAR = 2027;

/** húsvét/pünkösd: katolikus vagy ortodox (a név alapján) — a kettő közül csak egy jár */
export function holidayAlt(h: Holiday): { grp: string; fel: "kat" | "ort" } | null {
  const n = h.name_hu.toLowerCase();
  const grp = /húsvét|nagypéntek/.test(n) ? "husvet" : /pünkösd/.test(n) ? "punkosd" : null;
  const fel = n.includes("(katolikus)") ? "kat" : n.includes("(ortodox)") ? "ort" : null;
  return grp && fel ? { grp, fel } : null;
}

export type LeaveSummary = {
  quota: number | null; carry: number; total: number | null; used: number; left: number | null;
  /** az évben járó (hétköznapra eső) ünnepnapok */
  holDue: Holiday[]; holTaken: number;
  /** már elmúlt, de még nincs beírva */
  holMissing: Holiday[];
  /** csoport → választott felekezet (ha már kivett belőle) */
  chosen: Record<string, "kat" | "ort">;
};

/**
 * szab: a kolléga szabadság-bejegyzései az évben (day szerint);
 * unnep: kivett ünnepnapjai, amelyek az év ünnepeire vonatkoznak (holiday_day szerint);
 * hols: az év ünnepnapjai.
 */
export function leaveSummary(quota: Quota | null, szab: LeaveEntry[], unnep: LeaveEntry[],
                             hols: Holiday[], today: string): LeaveSummary {
  szab = szab.filter(isOk); unnep = unnep.filter(isOk);
  const used = szab.filter(e => e.type_code === "szabadsag").reduce((s, e) => s + partWeight(e.part), 0);
  const carry = Number(quota?.carry_over ?? 0);
  const q = quota ? Number(quota.days) : null;
  const total = q != null ? q + carry : null;
  const takenDays = new Set(unnep.filter(e => e.type_code === "unnepnap_kivet" && e.holiday_day)
    .map(e => e.holiday_day as string));
  const chosen: Record<string, "kat" | "ort"> = {};
  for (const h of hols) {
    const a = holidayAlt(h);
    if (a && takenDays.has(h.day)) chosen[a.grp] = a.fel;
  }
  const holDue = hols.filter(h => {
    const dow = new Date(h.day + "T00:00:00").getDay();
    if (dow === 0 || dow === 6) return false;
    const a = holidayAlt(h);
    if (!a) return true;
    // még nem döntött: az ortodox napokkal számolunk (ugyanannyi nap)
    return a.fel === (chosen[a.grp] ?? "ort");
  }).sort((a, b) => a.day.localeCompare(b.day));
  const holTaken = holDue.filter(h => takenDays.has(h.day)).length;
  const holMissing = holDue.filter(h => h.day < today && !takenDays.has(h.day));
  return { quota: q, carry, total, used, left: total != null ? total - used : null,
           holDue, holTaken, holMissing, chosen };
}

/** HR-összesítő: a megadott kollégák évi szabadsága, kivett ünnepnapjai és kerete */
export async function loadLeaveOverview(year: number, personIds: string[]) {
  const from = `${year}-01-01`, to = `${year}-12-31`;
  if (!personIds.length) return { szab: [] as LeaveEntry[], unnep: [] as LeaveEntry[], quotas: [] as Quota[] };
  const [sq, uq, qq] = await Promise.all([
    supabase.from("leave_entries").select("*").in("person_id", personIds)
      .eq("type_code", "szabadsag").gte("day", from).lte("day", to),
    supabase.from("leave_entries").select("*").in("person_id", personIds)
      .eq("type_code", "unnepnap_kivet").gte("holiday_day", from).lte("holiday_day", to),
    supabase.from("leave_quotas").select("*").eq("year", year).in("person_id", personIds),
  ]);
  for (const r of [sq, uq, qq]) fail(r.error);
  return { szab: (sq.data as LeaveEntry[]) ?? [], unnep: (uq.data as LeaveEntry[]) ?? [],
           quotas: (qq.data as Quota[]) ?? [] };
}
