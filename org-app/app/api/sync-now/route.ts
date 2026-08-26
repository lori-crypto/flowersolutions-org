import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Kézi adatfrissítés a felületről: belépett HR/admin felhasználó indíthatja.
// A tényleges munkát a meglévő sync-végpontok végzik (CRON_SECRET-tel, szerveroldalon).

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const clean = (v?: string) => (v ?? "").trim().replace(/^["']+|["']+$/g, "");

export async function POST(req: NextRequest) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anon = clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!url || !anon) return NextResponse.json({ error: "hiányzó Supabase env" }, { status: 500 });
  const sb = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: allowed, error: capErr } = await sb.rpc("app_has_cap", { cap: "hr" });
  if (capErr || !allowed) return NextResponse.json({ error: "nincs jogosultság" }, { status: 403 });

  const secret = clean(process.env.CRON_SECRET);
  if (!secret) return NextResponse.json({ error: "hiányzó CRON_SECRET" }, { status: 500 });

  // GYORS frissítés: csak a mai számlák + a futó hónap rendelései + webshop.
  // (A teljes 2 hónapos újratöltést az éjszakai szinkron végzi.)
  const origin = req.nextUrl.origin;
  const out: Record<string, unknown> = {};
  const errs: string[] = [];
  for (const ep of ["orders-sync?quick=1", "webshop-sync", "sales-sync?today=1"]) {
    const name = ep.split("?")[0];
    try {
      const r = await fetch(`${origin}/api/${ep}`, {
        headers: { Authorization: `Bearer ${secret}` },
        cache: "no-store",
      });
      const j = await r.json();
      out[name] = j;
      if (!r.ok) errs.push(`${name}: ${j?.error ?? r.status}`);
    } catch (e) {
      out[name] = { error: String(e) };
      errs.push(`${name}: ${String(e)}`);
    }
  }
  const ok = errs.length === 0;
  return NextResponse.json({ ok, error: ok ? undefined : errs.join(" • "), ...out },
                           { status: ok ? 200 : 502 });
}
