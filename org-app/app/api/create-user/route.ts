import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Belépési fiók létrehozása egy kollégának (csak admin indíthatja).
// A fiók a person emailjével + ideiglenes jelszóval jön létre, és
// összekapcsolódik a persons sorral (user_id).

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

  const body = await req.json().catch(() => null) as
    { person_id?: string; email?: string; password?: string; invite?: boolean } | null;
  const personId = (body?.person_id ?? "").trim();
  const email = (body?.email ?? "").trim().toLowerCase();
  const password = body?.password ?? "";
  if (!personId || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Hiányzó vagy hibás email." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "A jelszó legalább 8 karakter legyen." }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: person, error: pe } = await db.from("persons")
    .select("id, name, user_id, lang").eq("id", personId).maybeSingle();
  if (pe) return NextResponse.json({ error: pe.message }, { status: 500 });
  if (!person) return NextResponse.json({ error: "Nincs ilyen személy." }, { status: 404 });
  if (person.user_id) return NextResponse.json({ error: "Ennek a kollégának már van fiókja." }, { status: 409 });

  const { data: created, error: ce } = await db.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (ce) return NextResponse.json({ error: "Fiók-létrehozás hiba: " + ce.message }, { status: 500 });

  const { error: ue } = await db.from("persons")
    .update({ user_id: created.user.id, email }).eq("id", personId);
  if (ue) {
    // a fiók létrejött, de a kapcsolás nem — takarítsunk, hogy újrapróbálható legyen
    await db.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: "Összekapcsolási hiba: " + ue.message }, { status: 500 });
  }

  // Meghívó e-mail (ha a Resend be van állítva és kérték)
  let emailed = false;
  const resendKey = clean(process.env.RESEND_API_KEY);
  const resendFrom = clean(process.env.RESEND_FROM);
  if (resendKey && resendFrom && body?.invite !== false) {
    const ro = person.lang === "ro";
    const subject = ro ? "Datele tale de acces — Flower Solutions"
                       : "Belépési adataid — Flower Solutions";
    const html = `
      <div style="font-family:'Segoe UI',sans-serif;font-size:15px;color:#1b2420;max-width:520px">
        <h2 style="color:#2f7a4f">Flower Solutions — org</h2>
        <p>${ro ? `Salut, ${person.name}!` : `Szia, ${person.name}!`}</p>
        <p>${ro ? "Ți-am creat cont în sistemul intern al firmei."
                 : "Létrehoztuk a fiókodat a cég belső rendszerében."}</p>
        <table style="border-collapse:collapse;font-size:15px">
          <tr><td style="padding:4px 12px 4px 0;color:#66707d">${ro ? "Adresă" : "Cím"}:</td>
              <td><a href="https://org.flowersolutions.ro">org.flowersolutions.ro</a></td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#66707d">${ro ? "Utilizator" : "Belépés"}:</td>
              <td><b>${email}</b></td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#66707d">${ro ? "Parolă temporară" : "Ideiglenes jelszó"}:</td>
              <td><b style="font-family:Consolas,monospace">${password}</b></td></tr>
        </table>
        <p style="color:#66707d;font-size:13px">${ro
          ? "Poți intra și cu numărul tău de telefon. După prima autentificare îți poți schimba parola cu butonul „Am uitat parola”."
          : "A telefonszámoddal is beléphetsz. Az első belépés után a jelszavadat az „Elfelejtett jelszó” gombbal bármikor lecserélheted."}</p>
      </div>`;
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: resendFrom, to: email, subject, html }),
      });
      emailed = r.ok;
    } catch { emailed = false; }
  }

  return NextResponse.json({ ok: true, emailed });
}
