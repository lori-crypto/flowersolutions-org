import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Éjszakai NEXUS → sales_lines szinkron.
// A futó és az előző hónapot (anluna) teljesen újratölti az API-ból
// (source: 'nexus_api'), mert a NEXUS-ban visszamenőleg is módosulhat számla.
// A régebbi hónapok (nexus_export történelem) érintetlenek maradnak.
// ?today=1 → GYORS mód: csak a MAI nap számláit cseréli (kézi frissítéshez).

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const clean = (v?: string) => (v ?? "").trim().replace(/^["']+|["']+$/g, "");

type Row = Record<string, unknown>;

async function nexus(path: string, body: Row, timeoutMs = 55000): Promise<Row[]> {
  const host = clean(process.env.NEXUS_HOST);
  const key = clean(process.env.NEXUS_API_KEY);
  if (!host || !key) throw new Error("Hiányzó NEXUS_HOST / NEXUS_API_KEY env.");
  const auth = "Basic " + Buffer.from(key + ":").toString("base64");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(`${host}/api/v3/read/${path}`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: ctrl.signal,
    });
    const d = await resp.json();
    if (String(d?.isError ?? 0) !== "0" && String(d?.isError) !== "None") {
      throw new Error("NEXUS hiba: " + (d?.message || "ismeretlen"));
    }
    let res = d?.result ?? [];
    if (typeof res === "string") res = JSON.parse(res);
    return Array.isArray(res) ? res : [];
  } finally {
    clearTimeout(t);
  }
}

const first = (...vals: unknown[]) =>
  vals.find(v => v !== undefined && v !== null && v !== "");
const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? "0").replace(",", ""));
  return Number.isFinite(n) ? n : 0;
};

function monthsToSync(): string[] {
  const now = new Date();
  const cur = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const p = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prev = `${p.getFullYear()}${String(p.getMonth() + 1).padStart(2, "0")}`;
  return [cur, prev]; // a futó hónap az első: ha kifutnánk az időből, az frissüljön biztosan
}

export async function GET(req: NextRequest) {
  // védelem: Vercel cron (CRON_SECRET) vagy kézi hívás ?secret=
  const secret = clean(process.env.CRON_SECRET);
  const auth = req.headers.get("authorization") ?? "";
  const qs = req.nextUrl.searchParams.get("secret") ?? "";
  if (!secret || (auth !== `Bearer ${secret}` && qs !== secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  const report: Row[] = [];

  // gyors mód: csak a mai (bukaresti) nap
  const today = req.nextUrl.searchParams.get("today") === "1"
    ? new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Bucharest" })
    : null;
  const months = today ? [today.slice(0, 4) + today.slice(5, 7)] : monthsToSync();

  // termék-hierarchia a kódokhoz
  const produse = await nexus("produse",
    { campuri: "cod_extern, den_grupa, den_clasa, den_subclasa" });
  const prodMap = new Map<string, Row>();
  for (const p of produse) {
    const c = String(p["cod_extern"] ?? "").trim();
    if (c) prodMap.set(c, p);
  }

  for (const anluna of months) {
    // számlafejek — csak érvényes, nem sztornózott
    const headsAll = await nexus("facturi_clienti", { anluna });
    const heads = headsAll.filter(h =>
      String(h["validare"]).toLowerCase() !== "false" &&
      String(h["anulare"]).toLowerCase() !== "true" &&
      (!today || String(h["data_document"] ?? "").slice(0, 10) === today));
    const byId = new Map<string, Row>();
    for (const h of heads) {
      const id = String(h["id_document"] ?? "");
      if (id) byId.set(id, h);
    }

    // sorok — a szerver néha ignorálja a szűrőt: helyben is szűrünk a fejekre
    let lines: Row[] = [];
    if (byId.size > 0) {
      try {
        lines = await nexus("facturi_clienti_linii", { anluna });
      } catch {
        for (const id of byId.keys()) {
          lines.push(...await nexus("facturi_clienti_linii",
            { anluna, id_document: id }, 20000));
        }
      }
    }
    lines = lines.filter(l => byId.has(String(l["id_document"] ?? "")));

    const rows = lines.map(l => {
      const h = byId.get(String(l["id_document"]))!;
      const cod = String(first(l["cod_extern_produs"], l["cod_produs"]) ?? "").trim();
      const p = prodMap.get(cod);
      const q = num(l["cantitate"]);
      const puNet = num(first(l["pret_vanzare"], l["pret_unitar"], l["pret"], l["pret_fara_tva"]));
      const puGross = num(first(l["pret_vanzare_tva"]));
      const cota = num(first(l["cota_tva_ies"], l["cota_tva"])) || 21;
      // FONTOS: a kedvezmény külön (negatív) sorként érkezik — a procent_discount
      // csak tájékoztató, NEM szabad újra alkalmazni!
      const r2 = (x: number) => Math.round(x * 100) / 100;
      const net = l["valoare_fara_tva"] != null ? num(l["valoare_fara_tva"]) : r2(q * puNet);
      const gross = l["valoare_cu_tva"] != null ? num(l["valoare_cu_tva"])
        : puGross ? r2(q * puGross) : r2(net * (1 + cota / 100));
      const dataDoc = String(h["data_document"] ?? "").slice(0, 10);
      return {
        source: "nexus_api",
        tip_doc: "Factura",
        seria: String(h["serie_document"] ?? "").trim() || null,
        nr: String(h["numar_document"] ?? "").trim() || null,
        data_doc: dataDoc,
        anluna,
        cont: null,
        nume_cli: String(h["den_client"] ?? "").trim() || null,
        id_client: h["id_client"] != null ? String(h["id_client"]).trim() : null,
        nume_gest: null,
        cod_ext: cod || null,
        denumire: String(l["den_produs"] ?? "").trim() || null,
        grupa: p ? String(p["den_grupa"] ?? "").trim() || null : null,
        clasa: p ? String(p["den_clasa"] ?? "").trim() || null : null,
        subclasa: p ? String(first(p["den_subclasa"], p["den_sub_clasa"]) ?? "").trim() || null : null,
        um: String(first(l["den_um"], l["um"]) ?? "").trim() || null,
        cantitate: q,
        pu: null, puv: puNet,
        val_pu: null,
        val_puv: net, val_disc: 0, val_tva: Math.round((gross - net) * 100) / 100,
        val_puv_tva: gross,
        real_net: net, real_gross: gross,
        aviz: false, aviz_korr: false,
      };
    }).filter(r => r.data_doc && r.data_doc.length === 10);

    // csere NAPONKÉNT: sosem törlünk többet, mint amit rögtön vissza is írunk —
    // így egy időkorlát miatt félbeszakadt futás sem tud egész hónapot elrontani
    const byDay = new Map<string, typeof rows>();
    for (const r of rows) {
      const a = byDay.get(r.data_doc) ?? []; a.push(r); byDay.set(r.data_doc, a);
    }
    if (today && !byDay.has(today)) byDay.set(today, []); // ma minden számlát sztornóztak
    const days = Array.from(byDay.keys()).sort();
    if (!today && days.length > 0) {
      // napok, amikre a NEXUS-ban már egyetlen számla sincs, nálunk viszont van sor
      const gone = await db.from("sales_lines").delete().eq("anluna", anluna)
        .not("data_doc", "in", `(${days.join(",")})`);
      if (gone.error) throw new Error("Nap-takarítás hiba: " + gone.error.message);
    }
    for (const day of days) {
      const dayRows = byDay.get(day)!;
      const del = await db.from("sales_lines").delete().eq("anluna", anluna).eq("data_doc", day);
      if (del.error) throw new Error("Törlés hiba: " + del.error.message);
      for (let i = 0; i < dayRows.length; i += 1000) {
        const ins = await db.from("sales_lines").insert(dayRows.slice(i, i + 1000));
        if (ins.error) throw new Error("Beszúrás hiba: " + ins.error.message);
      }
    }
    report.push({ anluna, nap: today ?? "teljes hónap", szamlak: byId.size, sorok: rows.length });
  }

  return NextResponse.json({ ok: true, report });
}
