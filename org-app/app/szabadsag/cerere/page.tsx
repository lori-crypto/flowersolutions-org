"use client";
// Nyomtatható szabadság-kérvény (román, Codul muncii szerint).
//  /szabadsag/cerere?ids=<bejegyzés-id,…>
//   - szabadsag      → Cerere de concediu de odihnă (art. 144 și urm. Codul muncii)
//   - unnepnap_kivet → Cerere zi liberă pt. sărbătoare legală (art. 139–142) — mindig külön lap
//  Iktatószám: első nyomtatáskor automatikus (SQL 40, app_leave_request_no), újranyomtatáskor ugyanaz.
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { LeaveEntry, Holiday } from "@/lib/leave";

// A munkáltató minden táblánál az FSS (a Magnolia beolvad)
const CEG = {
  nev: "FLOWER SHOP SOLUTIONS S.R.L.",
  cui: "35975113",
  j: "J26/599/2016",
  sediu: "Municipiul Târgu Mureș, Str. Băneasa nr. 8, jud. Mureș",
  admin: "KOVÁCS LORÁND",
};
const UNNEP = "unnepnap_kivet";

type Row = LeaveEntry & { board: { name_hu: string; name_ro: string | null } | null };

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const ro = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const partRo = (p: string) => p === "de" ? "jumătate de zi (prima parte a zilei)"
  : p === "du" ? "jumătate de zi (a doua parte a zilei)" : "";
const weight = (p: string) => (p === "egesz" ? 1 : 0.5);
const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : String(n).replace(".", ","));
const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86400000);

type Reg = { no: number; date: string } | null;

function Header({ reg }: { reg: Reg }) {
  return (
    <div className="c-head">
      <b>{CEG.nev}</b><br />
      CUI {CEG.cui} · Nr. Reg. Com. {CEG.j}<br />
      {CEG.sediu}
      <div className="c-reg">
        {reg ? <>Nr. înregistrare: <b>{reg.no}</b> / Data: <b>{ro(reg.date)}</b></>
             : <>Nr. înregistrare: ............ / Data: ....................</>}
      </div>
    </div>
  );
}

function Signatures() {
  return (
    <div className="c-sign">
      <div>
        Data: ....................<br /><br />
        Semnătura salariatului,<br /><br />
        ...................................
      </div>
      <div className="c-appr">
        <b>APROBAT</b><br />
        Administrator,<br />
        {CEG.admin}<br /><br />
        ...................................<br />
        <span className="c-small">(semnătura și ștampila)</span>
      </div>
    </div>
  );
}

function Odihna({ rows, reg, holMap }: { rows: Row[]; reg: Reg; holMap: Map<string, Holiday> }) {
  const p = rows[0];
  const total = rows.reduce((s, r) => s + weight(r.part), 0);
  const from = rows[0].day, to = rows[rows.length - 1].day;
  const halves = rows.filter(r => r.part !== "egesz");
  // az időszakba eső, munkanapra eső ünnepnapok (nem számítanak a szabadságba)
  const inHol: Holiday[] = [];
  for (const d = new Date(from + "T00:00:00"); iso(d) < to; d.setDate(d.getDate() + 1)) {
    const h = holMap.get(iso(d));
    if (h && ![0, 6].includes(d.getDay())) inHol.push(h);
  }
  return (
    <section className="c-page">
      <Header reg={reg} />
      <h1>CERERE DE CONCEDIU DE ODIHNĂ</h1>
      <p className="c-to">Către conducerea {CEG.nev},</p>
      <p>
        Subsemnatul/Subsemnata <b>{p.person?.name ?? "...................................."}</b>,
        angajat/ă în cadrul societății, compartimentul <b>{p.board?.name_ro || p.board?.name_hu || "..............."}</b>,
        în funcția de ....................................., vă rog să-mi aprobați efectuarea
        concediului de odihnă aferent anului <b>{from.slice(0, 4)}</b>, în număr
        de <b>{fmtNum(total)}</b> {total === 1 ? "zi lucrătoare" : "zile lucrătoare"},
        {from === to ? <> în data de <b>{ro(from)}</b>.</> : <> în perioada <b>{ro(from)} – {ro(to)}</b>.</>}
      </p>
      {(rows.length > 1 || halves.length > 0) && (
        <p>
          Zilele solicitate:{" "}
          {rows.map((r, i) => (
            <span key={r.id}>{ro(r.day)}{r.part !== "egesz" ? ` (${partRo(r.part)})` : ""}{i < rows.length - 1 ? ", " : "."}</span>
          ))}
        </p>
      )}
      {inHol.length > 0 && (
        <p>
          {inHol.length === 1 ? "Ziua de sărbătoare legală " : "Zilele de sărbătoare legală "}
          {inHol.map((h, i) => (
            <span key={h.day}><b>{ro(h.day)}</b> ({h.name_ro || h.name_hu}){i < inHol.length - 1 ? ", " : ""}</span>
          ))}
          {inHol.length === 1 ? " nu se include" : " nu se includ"} în concediul de odihnă; pentru
          {inHol.length === 1 ? " aceasta se depune cerere separată." : " acestea se depun cereri separate."}
        </p>
      )}
      <p>Pe perioada concediului, atribuțiile mele vor fi preluate de: .....................................................</p>
      <p className="c-legal">
        Cererea este formulată în temeiul art. 144 și următoarele din Legea nr. 53/2003 – Codul muncii,
        republicată, cu modificările și completările ulterioare, privind concediul de odihnă anual.
      </p>
      <Signatures />
    </section>
  );
}

function Compensatorie({ r, hol, reg }: { r: Row; hol: Holiday | undefined; reg: Reg }) {
  const onDay = !!r.holiday_day && r.holiday_day === r.day;
  const holTxt = r.holiday_day
    ? <b>{ro(r.holiday_day)}{hol ? ` – ${hol.name_ro || hol.name_hu}` : ""}</b>
    : <>....................................................</>;
  return (
    <section className="c-page">
      <Header reg={reg} />
      <h1>CERERE PENTRU ACORDAREA ZILEI LIBERE<br />CORESPUNZĂTOARE SĂRBĂTORII LEGALE</h1>
      <p className="c-to">Către conducerea {CEG.nev},</p>
      {onDay ? (
        <p>
          Subsemnatul/Subsemnata <b>{r.person?.name ?? "...................................."}</b>,
          angajat/ă în cadrul societății, compartimentul <b>{r.board?.name_ro || r.board?.name_hu || "..............."}</b>,
          în funcția de ....................................., vă rog să-mi aprobați să nu desfășor activitate
          în ziua de sărbătoare legală {holTxt}{r.part !== "egesz" ? `, ${partRo(r.part)}` : ""}, zi liberă potrivit
          art. 139 din Legea nr. 53/2003 – Codul muncii.
        </p>
      ) : (
        <p>
          Subsemnatul/Subsemnata <b>{r.person?.name ?? "...................................."}</b>,
          angajat/ă în cadrul societății, compartimentul <b>{r.board?.name_ro || r.board?.name_hu || "..............."}</b>,
          în funcția de ....................................., vă rog să-mi aprobați acordarea unei zile libere
          plătite{r.part !== "egesz" ? ` (${partRo(r.part)})` : ""} în data de <b>{ro(r.day)}</b>, ca timp liber
          corespunzător zilei de sărbătoare legală {holTxt}, în care am desfășurat activitate la locul de muncă.
        </p>
      )}
      {!onDay && (
        <p className="c-legal">
          Cererea este formulată în temeiul art. 139–142 din Legea nr. 53/2003 – Codul muncii, republicată,
          cu modificările și completările ulterioare, privind sărbătorile legale și compensarea cu timp liber
          a activității desfășurate în aceste zile.
        </p>
      )}
      <Signatures />
    </section>
  );
}

/** egymás utáni napok (közte csak hétvége/ünnep) → egy kérvény */
function groupOdihna(rows: Row[], holSet: Set<string>): Row[][] {
  const out: Row[][] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    const prev = last?.[last.length - 1];
    let contiguous = false;
    if (prev && prev.person_id === r.person_id) {
      contiguous = true;
      const d = new Date(prev.day + "T00:00:00"); d.setDate(d.getDate() + 1);
      const end = new Date(r.day + "T00:00:00");
      while (d < end) {
        const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        if (![0, 6].includes(d.getDay()) && !holSet.has(k)) { contiguous = false; break; }
        d.setDate(d.getDate() + 1);
      }
    }
    if (contiguous) last.push(r); else out.push([r]);
  }
  return out;
}

function CererePage() {
  const q = useSearchParams();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [hols, setHols] = useState<Holiday[]>([]);
  const [err, setErr] = useState("");
  const [skipped, setSkipped] = useState(0); // függő / elutasított → nem nyomtatjuk

  useEffect(() => {
    // csak helyi fejlesztéskor: minta-adat a kinézet ellenőrzéséhez (?demo=1)
    if (process.env.NODE_ENV === "development" && q.get("demo")) {
      const P = { id: "p", name: "Muntyan Ferenc" } as unknown as Row["person"];
      const B = { name_hu: "Lerakat", name_ro: "Depozit" };
      const mk = (id: string, day: string, type: string, hol: string | null = null, part = "egesz") =>
        ({ id, board_id: "b", person_id: "p", day, part, type_code: type, note: null, person: P, board: B, holiday_day: hol }) as Row;
      setRows([mk("1", "2026-12-24", "szabadsag"), mk("2", "2026-12-28", "szabadsag"), mk("3", "2026-12-29", "szabadsag"),
               mk("6", "2026-12-25", UNNEP, "2026-12-25")]);
      setHols([{ day: "2026-12-01", name_hu: "Románia nemzeti ünnepe", name_ro: "Ziua Națională" },
               { day: "2026-12-25", name_hu: "Karácsony", name_ro: "Crăciunul" }]);
      return;
    }
    const ids = (q.get("ids") ?? "").split(",").filter(Boolean);
    if (!ids.length) { setErr("Nincs kiválasztott bejegyzés."); return; }
    (async () => {
      const [eq, hq] = await Promise.all([
        supabase.from("leave_entries").select("*, person:persons(*), board:leave_boards(name_hu, name_ro)")
          .in("id", ids).order("person_id").order("day"),
        supabase.from("holidays").select("*"),
      ]);
      if (eq.error || hq.error) { setErr((eq.error || hq.error)!.message); return; }
      const all = (eq.data as Row[]) ?? [];
      setSkipped(all.filter(r => r.status && r.status !== "ok").length);
      setRows(all.filter(r => !r.status || r.status === "ok"));
      setHols((hq.data as Holiday[]) ?? []);
    })();
  }, [q]);

  const holMap = useMemo(() => new Map(hols.map(h => [h.day, h])), [hols]);
  const odihna = useMemo(() => rows
    ? groupOdihna(rows.filter(r => r.type_code === "szabadsag"), new Set(hols.map(h => h.day))) : [], [rows, hols]);
  const comp = useMemo(() => (rows ?? []).filter(r => r.type_code === UNNEP), [rows]);

  // iktatószámok: dokumentumonként (az első bejegyzés id-je a kulcs)
  const [regs, setRegs] = useState<Record<string, Reg>>({});
  const [regErr, setRegErr] = useState("");
  useEffect(() => {
    if (!rows) return;
    const docs = [...odihna.map(g => g.map(r => r.id)), ...comp.map(r => [r.id])];
    if (process.env.NODE_ENV === "development" && q.get("demo")) {
      setRegs(Object.fromEntries(docs.map((d, i) => [d[0], { no: 41 + i, date: "2026-11-23" }]))); return;
    }
    (async () => {
      const out: Record<string, Reg> = {};
      for (const ids of docs) {
        const { data, error } = await supabase.rpc("app_leave_request_no", { p_ids: ids });
        if (error) { setRegErr(error.message); out[ids[0]] = null; continue; }
        const r = (data as { request_no: number; request_date: string }[])?.[0];
        out[ids[0]] = r ? { no: r.request_no, date: r.request_date } : null;
      }
      setRegs(out);
    })();
  }, [rows, odihna, comp, q]);

  if (err) return <div className="center-msg">Hiba: {err}</div>;
  if (!rows) return <div className="center-msg">Betöltés…</div>;
  const warn = comp.filter(r => r.holiday_day && r.holiday_day !== r.day &&
    (daysBetween(r.holiday_day, r.day) < 0 || daysBetween(r.holiday_day, r.day) > 30));
  const nothing = odihna.length === 0 && comp.length === 0;

  return (
    <div className="cerere">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="c-bar">
        <button className="btn-save" onClick={() => window.print()}
                disabled={nothing || Object.keys(regs).length === 0}>🖨 Nyomtatás</button>
        <button className="btn-cancel" onClick={() => window.close()}>Bezárás</button>
        <span className="muted">
          {odihna.length + comp.length} kérvény · a kivett ünnepnapok külön lapon
        </span>
        {regErr && (
          <div className="c-warn">⚠ Az iktatószámot nem sikerült kiosztani ({/schema cache|PGRST202|app_leave_request_no/i.test(regErr)
            ? "előbb a 40-es SQL-t kell lefuttatni" : regErr}) — a lapon üresen marad.</div>
        )}
        {warn.length > 0 && (
          <div className="c-warn">
            ⚠ Codul muncii 142. cikk: az ünnepnapon végzett munka helyett a szabadnapot <b>utána, 30 napon belül</b> kell kiadni (ha nem, legalább 100%-os bérpótlék jár).
            Ennél eltér: {warn.map(r => `${r.person?.name ?? "?"} ${ro(r.day)} (ünnep: ${ro(r.holiday_day!)})`).join("; ")}.
          </div>
        )}
        {comp.some(r => !r.holiday_day) && (
          <div className="c-warn">⚠ Van kivett ünnepnap, amelynél nincs megadva, melyik ünnep helyett — a lapon üresen marad, kézzel töltsd ki, vagy szerkeszd a bejegyzést.</div>
        )}
        {skipped > 0 && (
          <div className="c-warn">⏳ {skipped} nap még jóváhagyásra vár (vagy elutasították) — arra nem készül kérvény.</div>
        )}
        {rows.some(r => r.type_code !== "szabadsag" && r.type_code !== UNNEP) && (
          <div className="c-warn">Ügyeletre és betegszabadságra nem készül kérvény.</div>
        )}
      </div>
      {nothing && <div className="center-msg">Ezekhez a bejegyzésekhez nem készül kérvény.</div>}
      {odihna.map(g => <Odihna key={g[0].id} rows={g} reg={regs[g[0].id] ?? null} holMap={holMap} />)}
      {comp.map(r => <Compensatorie key={r.id} r={r} reg={regs[r.id] ?? null}
                                    hol={r.holiday_day ? holMap.get(r.holiday_day) : undefined} />)}
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<div className="center-msg">Betöltés…</div>}><CererePage /></Suspense>;
}

const CSS = `
.cerere { background:#e9ebe8; min-height:100vh; padding:16px 0 40px; }
.c-bar { max-width:210mm; margin:0 auto 14px; padding:0 12px; display:flex; flex-wrap:wrap; gap:10px; align-items:center; }
.c-warn { flex-basis:100%; background:#fff4d6; border:1px solid #e0b84a; border-radius:8px; padding:8px 10px; font-size:13.5px; color:#5a4300; }
.c-page { background:#fff; color:#111; width:210mm; min-height:297mm; margin:0 auto 16px; padding:22mm 22mm 20mm;
  box-sizing:border-box; font-family:"Times New Roman", Times, serif; font-size:12.5pt; line-height:1.55;
  box-shadow:0 1px 6px rgba(0,0,0,.15); }
.c-head { font-size:10.5pt; line-height:1.4; border-bottom:1px solid #444; padding-bottom:8px; }
.c-reg { margin-top:8px; }
.c-page h1 { text-align:center; font-size:14pt; margin:34px 0 26px; letter-spacing:.03em; line-height:1.35; }
.c-to { margin-bottom:18px; }
.c-page p { text-align:justify; margin:0 0 12px; }
.c-legal { font-size:10.5pt; color:#333; margin-top:18px !important; }
.c-sign { display:flex; justify-content:space-between; margin-top:48px; }
.c-appr { text-align:center; }
.c-small { font-size:9.5pt; color:#555; }
@media screen and (max-width: 820px) { .c-page { width:auto; min-height:0; margin:0 8px 16px; padding:16px; } }
@media print {
  @page { size:A4; margin:0; }
  body { background:#fff !important; }
  .cerere { background:#fff; padding:0; }
  .c-bar { display:none !important; }
  .c-page { box-shadow:none; margin:0; width:210mm; min-height:297mm; page-break-after:always; break-after:page; }
  .c-page:last-child { page-break-after:auto; break-after:auto; }
}
`;
