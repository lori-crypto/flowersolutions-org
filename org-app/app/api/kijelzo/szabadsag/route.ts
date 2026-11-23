import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { kioskKeyOk } from "@/lib/kioskKey";
import { shortName } from "@/lib/names";

// Szabadságos tábla — CSAK OLVASÓ adat a falra tett kijelzőnek.
// Belépés nélkül, kulccsal (?key=…) érhető el; a válasz csak azt tartalmazza, ami a
// falitáblán amúgy is látszik: rövidített név, nap, típus (szín). Nincs benne megjegyzés,
// email, keret vagy bármilyen más személyes adat.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (!kioskKeyOk("szabadsag", sp.get("key"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Bucharest" });
  const y = parseInt(sp.get("year") || "", 10);
  const year = Number.isFinite(y) && y >= 2020 && y <= 2100 ? y : parseInt(today.slice(0, 4), 10);
  const from = `${year}-01-01`, to = `${year}-12-31`;

  try {
    const db = supabaseAdmin();
    const [boardsQ, typesQ, entriesQ, blackQ, holQ, modeQ] = await Promise.all([
      db.from("leave_boards").select("id, name_hu, name_ro, sort").order("sort"),
      db.from("leave_types").select("code, name_hu, name_ro, color, sort").order("sort"),
      db.from("leave_entries").select("id, board_id, day, part, type_code, person:persons(name)")
        .gte("day", from).lte("day", to).eq("status", "ok").order("day"),
      db.from("blackout_periods").select("board_id, from_day, to_day, reason"),
      db.from("holidays").select("day, name_hu, name_ro").gte("day", from).lte("day", to),
      db.from("leave_rules").select("board_id, value").eq("key", "kijelzo_mod"),
    ]);
    for (const q of [boardsQ, typesQ, entriesQ, blackQ, holQ, modeQ]) {
      if (q.error) return NextResponse.json({ error: q.error.message }, { status: 500 });
    }
    type Row = { id: string; board_id: string; day: string; part: string; type_code: string;
                 person: { name: string } | { name: string }[] | null };
    const entries = ((entriesQ.data as unknown as Row[]) ?? []).map(e => {
      const p = Array.isArray(e.person) ? e.person[0] : e.person;
      return { id: e.id, board_id: e.board_id, day: e.day, part: e.part, type_code: e.type_code,
               name: shortName(p?.name ?? "?") };
    });
    return NextResponse.json({
      ok: true, today, year,
      boards: boardsQ.data ?? [], types: typesQ.data ?? [],
      entries, blackouts: blackQ.data ?? [], holidays: holQ.data ?? [],
      // a szabadságos oldalon állítható nézet táblánként: "ev" (egész év) | "hatra" (hátralevő hetek)
      modes: Object.fromEntries(((modeQ.data as { board_id: string; value: string }[]) ?? []).map(r => [r.board_id, r.value])),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
