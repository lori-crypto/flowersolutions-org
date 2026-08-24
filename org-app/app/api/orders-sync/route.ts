import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// NEXUS vevői rendelések (comenzi_clienti) szinkronja.
// Alapból a futó + előző hónap; ?full=1 → teljes visszatöltés 2024-01-től.

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const clean = (v?: string) => (v ?? "").trim().replace(/^["']+|["']+$/g, "");
type Row = Record<string, unknown>;

async function nexus(view: string, body: Row): Promise<Row[]> {
  const host = clean(process.env.NEXUS_HOST);
  const key = clean(process.env.NEXUS_API_KEY);
  const auth = "Basic " + Buffer.from(key + ":").toString("base64");
  const resp = await fetch(`${host}/api/v3/read/${view}`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const d = await resp.json();
  if (String(d?.isError ?? 0) !== "0" && String(d?.isError) !== "None") {
    throw new Error("NEXUS hiba: " + (d?.message || "ismeretlen"));
  }
  let res = d?.result ?? [];
  if (typeof res === "string") res = JSON.parse(res);
  return Array.isArray(res) ? res : [];
}

const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? "0").replace(",", ""));
  return Number.isFinite(n) ? n : 0;
};

function monthList(full: boolean): string[] {
  const now = new Date();
  if (!full) {
    const cur = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    const p = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return [`${p.getFullYear()}${String(p.getMonth() + 1).padStart(2, "0")}`, cur];
  }
  const out: string[] = [];
  const d = new Date(2024, 0, 1);
  while (d <= now) {
    out.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`);
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

export async function GET(req: NextRequest) {
  const secret = clean(process.env.CRON_SECRET);
  const auth = req.headers.get("authorization") ?? "";
  const qs = req.nextUrl.searchParams.get("secret") ?? "";
  if (!secret || (auth !== `Bearer ${secret}` && qs !== secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = supabaseAdmin();
  const months = monthList(req.nextUrl.searchParams.get("full") === "1");
  const report: Row[] = [];

  for (const anluna of months) {
    const heads = await nexus("comenzi_clienti", { anluna });
    const rows = heads
      .filter(h =>
        String(h["validare"]).toLowerCase() !== "false" &&
        String(h["anulat"]).toLowerCase() !== "true" &&
        !String(h["stare_comanda"] ?? "").toLowerCase().includes("anulat") &&
        h["data_livrare"])
      .map(h => ({
        id_document: String(h["id_document"]),
        anluna,
        data_document: String(h["data_document"] ?? "").slice(0, 10) || null,
        data_livrare: String(h["data_livrare"] ?? "").slice(0, 10),
        seria: String(h["serie_document"] ?? "").trim() || null,
        nr: String(h["numar_document"] ?? "").trim() || null,
        id_client: h["id_client"] != null ? String(h["id_client"]).trim() : null,
        nume_cli: String(h["den_client"] ?? "").trim() || null,
        valoare: num(h["valoare"]),
        valoare_tva: num(h["valoare_cu_tva"]),
        stare: String(h["stare_comanda"] ?? "").trim() || null,
        gestiune: String(h["den_gestiune"] ?? "").trim() || null,
      }))
      .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.data_livrare));

    const del = await db.from("nexus_orders").delete().eq("anluna", anluna);
    if (del.error) return NextResponse.json({ error: del.error.message }, { status: 500 });
    for (let i = 0; i < rows.length; i += 1000) {
      const ins = await db.from("nexus_orders").insert(rows.slice(i, i + 1000));
      if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
    }
    report.push({ anluna, rendelesek: rows.length });
  }
  return NextResponse.json({ ok: true, report });
}
