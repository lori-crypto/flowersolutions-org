import { NextRequest, NextResponse } from "next/server";

// Ideiglenes felderítő végpont: egy NEXUS nézet mezőinek megismerése.
// CRON_SECRET védi; csak olvas, semmit nem ír.

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const clean = (v?: string) => (v ?? "").trim().replace(/^["']+|["']+$/g, "");

export async function GET(req: NextRequest) {
  const secret = clean(process.env.CRON_SECRET);
  const qs = req.nextUrl.searchParams;
  if (!secret || qs.get("secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const view = qs.get("view") || "comenzi_clienti";
  const body: Record<string, string> = {};
  for (const k of ["anluna", "id_document", "campuri"]) {
    const v = qs.get(k); if (v) body[k] = v;
  }
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
  let res = d?.result ?? [];
  if (typeof res === "string") { try { res = JSON.parse(res); } catch { /* marad */ } }
  const rows = Array.isArray(res) ? res : [];
  return NextResponse.json({
    isError: d?.isError, message: d?.message,
    count: rows.length,
    keys: rows[0] ? Object.keys(rows[0]).sort() : [],
    sample: rows.slice(0, Number(qs.get("n") || 2)),
  });
}
