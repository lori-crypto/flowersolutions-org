import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Új ideiglenes jelszó beállítása egy kolléga fiókjához (csak admin).
// Olyan kollégákhoz is, akiknek nincs valódi email-címük.

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
  const { data: isAdmin, error: capErr } = await sb.rpc("app_is_admin");
  if (capErr || !isAdmin) return NextResponse.json({ error: "nincs jogosultság" }, { status: 403 });

  const body = await req.json().catch(() => null) as { person_id?: string; password?: string } | null;
  const personId = (body?.person_id ?? "").trim();
  const password = body?.password ?? "";
  if (!personId) return NextResponse.json({ error: "Hiányzó személy." }, { status: 400 });
  if (password.length < 8) {
    return NextResponse.json({ error: "A jelszó legalább 8 karakter legyen." }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: person, error: pe } = await db.from("persons")
    .select("id, user_id").eq("id", personId).maybeSingle();
  if (pe) return NextResponse.json({ error: pe.message }, { status: 500 });
  if (!person?.user_id) return NextResponse.json({ error: "Ennek a kollégának nincs fiókja." }, { status: 404 });

  const { error: ue } = await db.auth.admin.updateUserById(person.user_id, { password });
  if (ue) return NextResponse.json({ error: ue.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
