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

  // ?probe=<nézet>&body={json}&find=szöveg → tetszőleges NEXUS read-nézet mezői és
  // (a szövegre illő) első sorai — az annulálás-jelző felderítéséhez. Csak olvas.
  const probe = req.nextUrl.searchParams.get("probe");
  if (probe) {
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(req.nextUrl.searchParams.get("body") || "{}"); } catch { /* üres */ }
    const find = (req.nextUrl.searchParams.get("find") || "").toLowerCase();
    try {
      const resp = await fetch(`${host}/api/v3/read/${encodeURIComponent(probe)}`, {
        method: "POST", headers: { Authorization: basic, "Content-Type": "application/json" },
        body: JSON.stringify(body), cache: "no-store",
      });
      const text = await resp.text();
      let dj: { isError?: unknown; message?: string; result?: unknown } = {};
      try { dj = JSON.parse(text); } catch { return NextResponse.json({ ok: false, status: resp.status, raw: text.slice(0, 500) }); }
      let rs: unknown = dj?.result ?? [];
      if (typeof rs === "string") { try { rs = JSON.parse(rs); } catch { /* marad string */ } }
      const arr = Array.isArray(rs) ? (rs as Row[]) : [];
      const hit = find ? arr.filter(r => JSON.stringify(r).toLowerCase().includes(find)) : arr;
      return NextResponse.json({ ok: true, status: resp.status, isError: dj?.isError, message: dj?.message,
        n: arr.length, talalat: hit.length, keys: Object.keys(arr[0] ?? {}), sorok: hit.slice(0, 20) });
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message });
    }
  }
  const keysMode = req.nextUrl.searchParams.get("keys"); // ?keys=ÉÉÉÉ-HH-NN → nyers sorok minden mezővel (felderítés)
  const read = async (campuri?: string, view = "incasari_plati") => {
    const resp = await fetch(`${host}/api/v3/read/${view}`, {
      method: "POST",
      headers: { Authorization: basic, "Content-Type": "application/json" },
      body: JSON.stringify(campuri ? { campuri } : {}),
      cache: "no-store",
    });
    const dj = await resp.json();
    if (String(dj?.isError ?? 0) !== "0" && String(dj?.isError) !== "None") {
      throw new Error(dj?.message || "ismeretlen");
    }
    let rows: Row[] = dj?.result ?? [];
    if (typeof rows === "string") rows = JSON.parse(rows as unknown as string);
    return Array.isArray(rows) ? rows : [];
  };
  // Az `anulare` (sztornózott) mezőt is kérjük — ha ez a nézet nem ismeri, a mező nélkül próbáljuk újra.
  let rows: Row[];
  try {
    rows = await read(keysMode ? undefined : "id_document, data_document, cont, suma, plata, validare, anulare, tip_document, den_coresp, explicatii");
  } catch (e1) {
    try {
      rows = await read("id_document, data_document, cont, suma, plata, validare, tip_document, den_coresp, explicatii");
    } catch {
      return NextResponse.json({ error: "NEXUS hiba: " + (e1 as Error).message }, { status: 502 });
    }
  }

  // Annulált nyugta felismerése. A NEXUS az annulált chitanta-t NEM veszi ki az
  // incasari_plati naplóból és jelzőt sem ad rá — viszont törli a számla-hozzárendelését
  // az incasari_plati_linii nézetből (és a számla visszaáll "Neincasata"-ra).
  // Szabály: Chitanta + bevétel (plata=0), amelynek nincs egyetlen linii-sora sem → annulált.
  let allocated: Set<string> | null = null;
  try {
    const linii = await read("id_document, suma_platita", "incasari_plati_linii");
    allocated = new Set(linii.map(l => String(l["id_document"] ?? "")));
  } catch {
    allocated = null; // ha nem elérhető, a régi (jelző nélküli) viselkedés marad
  }
  const unallocated = (r: Row) => allocated !== null
    && String(r["tip_document"] ?? "").trim().toLowerCase() === "chitanta"
    && String(r["plata"]) === "0"
    && !allocated.has(String(r["id_document"] ?? ""));

  // Érvénytelen sor: nem érvényesített VAGY sztornózott (anulare true/1) VAGY annulált nyugta.
  const skip = (r: Row) => String(r["validare"]).toLowerCase() === "false"
    || /^(true|1)$/i.test(String(r["anulare"] ?? "").trim())
    || unallocated(r);

  // ?check=ÉÉÉÉ-HH → a hónap annuláltnak ítélt (hozzárendelés nélküli) nyugtái a lerakat kasszáján
  const check = req.nextUrl.searchParams.get("check");
  if (check) {
    const cont = String(units[0].nexus_cont).trim();
    const list = rows
      .filter(r => String(r["data_document"] ?? "").slice(0, 7) === check)
      .filter(r => String(r["cont"] ?? "").replace(/\s/g, "").startsWith(cont))
      .filter(unallocated)
      .map(r => ({ nap: String(r["data_document"] ?? "").slice(0, 10), id: r["id_document"], suma: num(r["suma"]),
                   partner: String(r["den_coresp"] ?? "").trim(), magyarazat: String(r["explicatii"] ?? "").trim() }));
    const total = rows.filter(r => String(r["data_document"] ?? "").slice(0, 7) === check
      && String(r["cont"] ?? "").replace(/\s/g, "").startsWith(cont)
      && String(r["tip_document"] ?? "").trim().toLowerCase() === "chitanta" && String(r["plata"]) === "0").length;
    return NextResponse.json({ ok: true, honap: check, linii_elerheto: allocated !== null, nyugtak: total, annulalt: list });
  }

  if (keysMode) {
    const cont = String(units[0].nexus_cont).trim();
    // ?keys=ÉÉÉÉ-HH-NN → a nap sorai; ?keys=ÉÉÉÉ-HH-NN&find=szöveg → a szöveget bárhol tartalmazó
    // sorok (minden nap, minden kassza) + a negatív összegű sorok — sztornó-felderítéshez
    const find = req.nextUrl.searchParams.get("find");
    const list = find
      ? rows.filter(r => JSON.stringify(r).toLowerCase().includes(find.toLowerCase()) || num(r["suma"]) < 0)
      : rows.filter(r => String(r["data_document"] ?? "").slice(0, 10) === keysMode)
            .filter(r => String(r["cont"] ?? "").replace(/\s/g, "").startsWith(cont));
    return NextResponse.json({ ok: true, keys: Object.keys(rows[0] ?? {}), sorok: list });
  }

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
      if (skip(r)) continue;
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
      .map(r => ({ tip: r["tip_document"], plata: r["plata"], suma: num(r["suma"]),
                   partner: String(r["den_coresp"] ?? "").trim(),
                   validare: r["validare"], anulare: r["anulare"], hozzarendeles_nelkul: unallocated(r), kihagyva: skip(r) }));
    return NextResponse.json({ ok: true, detail, tetelek: list });
  }

  const report: Row[] = [];
  for (const u of units) {
    const cont = String(u.nexus_cont).trim();
    const byDay = new Map<string, number>();
    const skipped: Row[] = [];
    for (const r of rows) {
      const day = String(r["data_document"] ?? "").slice(0, 10);
      if (day < fromIso || day > bucharest) continue;
      if (String(r["plata"]) === "1") continue; // kifizetés — nem bevétel
      const c = String(r["cont"] ?? "").replace(/\s/g, "");
      if (!c.startsWith(cont)) continue;
      if (skip(r)) {                             // nem érvényesített / sztornózott / annulált nyugta
        skipped.push({ nap: day, suma: num(r["suma"]), partner: String(r["den_coresp"] ?? "").trim() });
        continue;
      }
      byDay.set(day, (byDay.get(day) ?? 0) + num(r["suma"]));
    }
    for (const [day, amount] of byDay) {
      const up = await db.from("cash_nexus_rev").upsert({
        unit_id: u.id, day, amount: Math.round(amount * 100) / 100,
        synced_at: new Date().toISOString(),
      });
      if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });
    }
    report.push({ unit: u.code, napok: Object.fromEntries(byDay), kihagyott_nyugtak: skipped });
  }
  return NextResponse.json({ ok: true, sorok: rows.length, report });
}
