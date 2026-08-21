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
};
export type Blackout = {
  id: string; board_id: string; from_day: string; to_day: string; reason: string | null;
};
export type Holiday = { day: string; name_hu: string; name_ro: string | null };
export type BoardMember = { person_id: string; board_id: string };
export type Rule = { board_id: string; key: string; value: string };
export type Quota = { person_id: string; year: number; days: number };

export type LeaveStatic = {
  boards: LeaveBoard[]; types: LeaveType[]; persons: Person[];
  members: BoardMember[]; rules: Rule[]; me: Person | null; isHr: boolean;
};

const fail = (e: { message?: string } | null) => { if (e) throw new Error(e.message || "DB hiba"); };

export async function loadLeaveStatic(): Promise<LeaveStatic> {
  const [{ data: { session } }, boardsQ, typesQ, personsQ, membersQ, rulesQ, capsQ] =
    await Promise.all([
      supabase.auth.getSession(),
      supabase.from("leave_boards").select("*").order("sort"),
      supabase.from("leave_types").select("*").order("sort"),
      supabase.from("persons").select("*").eq("active", true).order("name"),
      supabase.from("board_members").select("*"),
      supabase.from("leave_rules").select("*"),
      supabase.from("person_capabilities").select("capability"),
    ]);
  for (const q of [boardsQ, typesQ, personsQ, membersQ, rulesQ, capsQ]) fail(q.error ?? null);
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
  };
}

/** Egy tábla egy évének bejegyzései + zárolásai + ünnepnapok + saját keret. */
export async function loadLeaveYear(boardId: string, year: number, personId: string | null) {
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const [entriesQ, blackoutsQ, holidaysQ, quotaQ, myEntriesQ] = await Promise.all([
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
  ]);
  for (const q of [entriesQ, blackoutsQ, holidaysQ, quotaQ, myEntriesQ]) fail((q as { error: { message?: string } | null }).error);
  return {
    entries: (entriesQ.data as LeaveEntry[]) ?? [],
    blackouts: (blackoutsQ.data as Blackout[]) ?? [],
    holidays: (holidaysQ.data as Holiday[]) ?? [],
    quota: (quotaQ.data as Quota | null) ?? null,
    myEntries: (myEntriesQ.data as LeaveEntry[]) ?? [],
  };
}

export async function addLeave(boardId: string, personId: string, days: string[],
                               part: Part, type: string, note: string) {
  const { error } = await supabase.rpc("app_leave_add", {
    p_board: boardId, p_person: personId, p_days: days,
    p_part: part, p_type: type, p_note: note,
  });
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
export async function setRule(boardId: string, key: string, value: string) {
  const { error } = await supabase.from("leave_rules").upsert({ board_id: boardId, key, value });
  fail(error);
}
export async function setQuota(personId: string, year: number, days: number) {
  const { error } = await supabase.from("leave_quotas").upsert({ person_id: personId, year, days });
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

// ── segédek ─────────────────────────────────────────────────
export const partWeight = (p: Part) => (p === "egesz" ? 1 : 0.5);

export function usedQuotaDays(myEntries: LeaveEntry[], types: LeaveType[]): number {
  const quotaTypes = new Set(types.filter(t => t.counts_quota).map(t => t.code));
  return myEntries.reduce((s, e) => s + (quotaTypes.has(e.type_code) ? partWeight(e.part) : 0), 0);
}
