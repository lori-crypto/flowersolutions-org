import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Éjszakai webshop → org szinkron: előrendelés-sorok + szállítási ciklusok.
// Teljes csere (kis adatmennyiség), a webshop Supabase-éből olvasva.

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const clean = (v?: string) => (v ?? "").trim().replace(/^["']+|["']+$/g, "");
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

export async function GET(req: NextRequest) {
  const secret = clean(process.env.CRON_SECRET);
  const auth = req.headers.get("authorization") ?? "";
  const qs = req.nextUrl.searchParams.get("secret") ?? "";
  if (!secret || (auth !== `Bearer ${secret}` && qs !== secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const wsUrl = clean(process.env.WEBSHOP_SUPABASE_URL);
  const wsKey = clean(process.env.WEBSHOP_SERVICE_KEY);
  if (!wsUrl || !wsKey) {
    return NextResponse.json({ error: "Hiányzó WEBSHOP_SUPABASE_URL / WEBSHOP_SERVICE_KEY env." }, { status: 500 });
  }
  const ws = createClient(wsUrl, wsKey, { auth: { persistSession: false } });
  const db = supabaseAdmin();

  // 1) szállítási ciklusok
  const { data: cycles, error: ce } = await ws.from("delivery_cycles")
    .select("delivery_date").order("delivery_date");
  if (ce) return NextResponse.json({ error: "webshop ciklusok: " + ce.message }, { status: 502 });
  const cycleRows = Array.from(new Set((cycles ?? [])
    .map(c => String(c.delivery_date).slice(0, 10))))
    .map(d => ({ delivery_date: d }));

  // 2) rendelés-sorok (lapozva)
  type OrderRow = {
    id: number;
    work_points: { company: string | null; nexus_id_client: string | null } | { company: string | null; nexus_id_client: string | null }[] | null;
    delivery_cycles: { delivery_date: string } | { delivery_date: string }[] | null;
    order_items: { den_produs: string | null; quantity: number | null; unit_price: number | null;
                   category: string | null; is_extra: boolean | null;
                   products: { subcategory: string | null } | { subcategory: string | null }[] | null }[] | null;
  };
  const orders: OrderRow[] = [];
  for (let off = 0; off < 100000; off += 1000) {
    const { data, error } = await ws.from("orders")
      .select("id, work_points(company, nexus_id_client), delivery_cycles(delivery_date)," +
              "order_items(den_produs, quantity, unit_price, category, is_extra, products(subcategory))")
      .order("id", { ascending: true }).range(off, off + 999);
    if (error) return NextResponse.json({ error: "webshop rendelések: " + error.message }, { status: 502 });
    orders.push(...((data as unknown as OrderRow[]) ?? []));
    if (!data || data.length < 1000) break;
  }

  const rows: Record<string, unknown>[] = [];
  for (const o of orders) {
    const wp = one(o.work_points);
    const dc = one(o.delivery_cycles);
    const date = String(dc?.delivery_date ?? "").slice(0, 10);
    if (!date) continue;
    for (const it of o.order_items ?? []) {
      const q = Number(it.quantity) || 0;
      if (q <= 0) continue;
      const price = Number(it.unit_price) || 0;
      const prod = one(it.products);
      rows.push({
        order_id: o.id,
        delivery_date: date,
        company: (wp?.company ?? "").trim() || null,
        nexus_id_client: wp?.nexus_id_client != null ? String(wp.nexus_id_client).trim() : null,
        den_produs: (it.den_produs ?? "").trim() || null,
        quantity: q,
        unit_price: price,
        value: Math.round(q * price * 100) / 100,
        category: (it.category ?? "").trim() || null,
        subcategory: (prod?.subcategory ?? "").trim() || null,
        is_extra: !!it.is_extra,
      });
    }
  }

  // 3) teljes csere
  const d1 = await db.from("webshop_cycles").delete().neq("delivery_date", "1900-01-01");
  if (d1.error) return NextResponse.json({ error: "ciklus-törlés: " + d1.error.message }, { status: 500 });
  if (cycleRows.length) {
    const i1 = await db.from("webshop_cycles").insert(cycleRows);
    if (i1.error) return NextResponse.json({ error: "ciklus-írás: " + i1.error.message }, { status: 500 });
  }
  const d2 = await db.from("webshop_order_lines").delete().neq("id", 0);
  if (d2.error) return NextResponse.json({ error: "sor-törlés: " + d2.error.message }, { status: 500 });
  for (let i = 0; i < rows.length; i += 1000) {
    const ins = await db.from("webshop_order_lines").insert(rows.slice(i, i + 1000));
    if (ins.error) return NextResponse.json({ error: "sor-írás: " + ins.error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    ciklusok: cycleRows.length,
    rendelesek: orders.length,
    sorok: rows.length,
  });
}
