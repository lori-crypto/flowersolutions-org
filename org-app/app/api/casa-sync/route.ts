import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// NEXUS Casa in lei → cash_nexus_rev: a lerakat(ok) napi készpénz-bevétele.
// Az incasari_plati naplóból szűrjük az egység nexus_cont kasszakódjára
// eső bevételeket (plata=0), az utolsó 7 napra, naponként összegezve.

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const clean = (v?: string) => (v ?? "").trim().replace(/^["']+|["']+$/g, "");
type Row = Record<string, unknown>;

const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? "0").replace(",", ""));
  return Number.isFinite(n) ? n : 0;
};

export async function GET(req: NextRequest) {
  const secret = clean(process.env.CRON_SECRET);
  const auth = req.headers.get("authorization") ?? "";
  const qs = req.nextUrl.searchParams.get("secret") ?? "";
  if (!secret || (auth !== `Bearer ${secret}` && qs !== secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const host = clean(process.env.NEXUS_HOST);
  const key = clean(process.env.NEXUS_API_KEY);
  if (!host || !key) return NextResponse.json({ error: "Hiányzó NEXUS env." }, { status: 500 });

  const db = supabaseAdmin();
  const { data: units, error: ue } = await db.from("cash_units")
    .select("id, code, nexus_cont").eq("kind", "lerakat").eq("active", true)
    .not("nexus_cont", "is", null);
  if (ue) return NextResponse.json({ error: ue.message }, { status: 500 });
  if (!units?.length) return NextResponse.json({ ok: true, info: "nincs lerakat egység" });

  // teljes napló, karcsúsított mezőkkel (az anluna szűrőt ez a nézet nem ismeri)
  const basic = "Basic " + Buffer.from(key + ":").toString("base64");
  const resp = await fetch(`${host}/api/v3/read/incasari_plati`, {
    method: "POST",
    headers: { Authorization: basic, "Content-Type": "application/json" },
    body: JSON.stringify({ campuri: "data_document, cont, suma, plata, validare, tip_document, den_coresp" }),
    cache: "no-store",
  });
  const dj = await resp.json();
  if (String(dj?.isError ?? 0) !== "0" && String(dj?.isError) !== "None") {
    return NextResponse.json({ error: "NEXUS hiba: " + (dj?.message || "ismeretlen") }, { status: 502 });
  }
  let rows: Row[] = dj?.result ?? [];
  if (typeof rows === "string") rows = JSON.parse(rows as unknown as string);
  if (!Array.isArray(rows)) rows = [];

  const bucharest = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Bucharest" });
  const from = new Date(bucharest + "T12:00:00");
  from.setDate(from.getDate() - 7);
  const fromIso = from.toISOString().slice(0, 10);

  // ?conts=ÉÉÉÉ-HH → a hónap kasszakódjai típusonként összegezve (felderítéshez)
  const conts = req.nextUrl.searchParams.get("conts");
  if (conts) {
    const agg = new Map<string, { n: number; s: number }>();
    for (const r of rows) {
      const day = String(r["data_document"] ?? "").slice(0, 7);
      if (day !== conts) continue;
      if (String(r["validare"]).toLowerCase() === "false") continue;
      const k = `${String(r["cont"] ?? "").replace(/\s/g, "")} | ${String(r["tip_document"] ?? "").trim()} | plata=${r["plata"]}`;
      const a = agg.get(k) ?? { n: 0, s: 0 };
      a.n += 1; a.s += num(r["suma"]); agg.set(k, a);
    }
    return NextResponse.json({ ok: true, honap: conts,
      kodok: Object.fromEntries([...agg.entries()].map(([k, v]) => [k, { db: v.n, osszeg: Math.round(v.s * 100) / 100 }])) });
  }

  // ?detail=ÉÉÉÉ-HH-NN → az adott nap tételeinek listája (felderítéshez)
  const detail = req.nextUrl.searchParams.get("detail");
  if (detail) {
    const cont = String(units[0].nexus_cont).trim();
    const list = rows
      .filter(r => String(r["data_document"] ?? "").slice(0, 10) === detail)
      .filter(r => String(r["cont"] ?? "").replace(/\s/g, "").startsWith(cont))
      .filter(r => String(r["validare"]).toLowerCase() !== "false")
      .map(r => ({ tip: r["tip_document"], plata: r["plata"], suma: num(r["suma"]),
                   partner: String(r["den_coresp"] ?? "").trim() }));
    return NextResponse.json({ ok: true, detail, tetelek: list });
  }

  const report: Row[] = [];
  for (const u of units) {
    const cont = String(u.nexus_cont).trim();
    const byDay = new Map<string, number>();
    for (const r of rows) {
      const day = String(r["data_document"] ?? "").slice(0, 10);
      if (day < fromIso || day > bucharest) continue;
      if (String(r["plata"]) === "1") continue; // kifizetés — nem bevétel
      if (String(r["validare"]).toLowerCase() === "false") continue;
      const c = String(r["cont"] ?? "").replace(/\s/g, "");
      if (!c.startsWith(cont)) continue;
      byDay.set(day, (byDay.get(day) ?? 0) + num(r["suma"]));
    }
    for (const [day, amount] of byDay) {
      const up = await db.from("cash_nexus_rev").upsert({
        unit_id: u.id, day, amount: Math.round(amount * 100) / 100,
        synced_at: new Date().toISOString(),
      });
      if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });
    }
    report.push({ unit: u.code, napok: Object.fromEntries(byDay) });
  }
  return NextResponse.json({ ok: true, sorok: rows.length, report });
}
