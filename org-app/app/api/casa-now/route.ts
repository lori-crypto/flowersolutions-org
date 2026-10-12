import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Kézi Casa-szinkron a lerakat felületéről: pénztáros vagy HR/admin indíthatja.

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
  const [a, b] = await Promise.all([
    sb.rpc("app_has_cap", { cap: "penztar" }),
    sb.rpc("app_has_cap", { cap: "hr" }),
  ]);
  if ((a.error || !a.data) && (b.error || !b.data)) {
    return NextResponse.json({ error: "nincs jogosultság" }, { status: 403 });
  }

  const secret = clean(process.env.CRON_SECRET);
  const r = await fetch(`${req.nextUrl.origin}/api/casa-sync`, {
    headers: { Authorization: `Bearer ${secret}` },
    cache: "no-store",
  });
  const j = await r.json();
  return NextResponse.json(j, { status: r.ok ? 200 : 502 });
}
