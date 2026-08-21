"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/lib/i18n";
import {
  LeaveStatic, LeaveEntry, Blackout, Holiday, Quota, Part,
  loadLeaveStatic, loadLeaveYear, addLeave, deleteLeave,
  addBlackout, deleteBlackout, updateBlackout, setRule, setQuota, setMembership,
  generateHolidays,
  usedQuotaDays, partWeight,
} from "@/lib/leave";

// Helyi dátum → YYYY-MM-DD (NEM UTC! különben UTC+2-ben egy napot csúszna)
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const AV_COLORS = ["#2f6fed", "#0e7c86", "#b3541e", "#2e7d32", "#8e3b8e", "#c2851a", "#1565c0", "#5b5f97"];
const avColor = (s: string) => AV_COLORS[(s.charCodeAt(0) || 0) % AV_COLORS.length];
const initialsOf = (n: string) => n.trim().split(/\s+/).map(w => w[0] || "").join("").slice(0, 2);
const MIN_YEAR = 2027; // a modul 2027-től indul, korábbi év nem kell

export default function SzabadsagPage() {
  const { t, lang, setLang, pick } = useI18n();
  const router = useRouter();
  const locale = lang === "ro" ? "ro-RO" : "hu-HU";

  const [st, setSt] = useState<LeaveStatic | null>(null);
  const [boardId, setBoardId] = useState<string>("");
  const now = new Date();
  const [year, setYear] = useState(Math.max(now.getFullYear(), MIN_YEAR));
  const [month, setMonth] = useState(now.getFullYear() >= MIN_YEAR ? now.getMonth() : 0); // 0-11
  const [view, setView] = useState<"honap" | "ev">("ev");
  const [data, setData] = useState<{
    entries: LeaveEntry[]; blackouts: Blackout[]; holidays: Holiday[];
    quota: Quota | null; myEntries: LeaveEntry[];
  } | null>(null);
  const [showAdd, setShowAdd] = useState<null | { from: string; to: string }>(null);
  const [dayModal, setDayModal] = useState<string | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [quotasAll, setQuotasAll] = useState<Quota[]>([]);
  const [err, setErr] = useState("");

  const reloadYear = useCallback(async (b = boardId, y = year, meId = st?.me?.id ?? null) => {
    if (!b) return;
    try { setData(await loadLeaveYear(b, y, meId)); setErr(""); }
    catch (e) { setErr((e as Error).message); }
  }, [boardId, year, st]);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      try {
        const s = await loadLeaveStatic();
        setSt(s);
        const myBoard = s.members.find(m => m.person_id === s.me?.id)?.board_id;
        const b = myBoard ?? s.boards[0]?.id ?? "";
        setBoardId(b);
        if (b) setData(await loadLeaveYear(b, year, s.me?.id ?? null));
      } catch (e) { setErr((e as Error).message); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => { if (st && boardId) reloadYear(boardId, year); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boardId, year]);

  // ── származtatott adatok ──────────────────────────────────
  const lim = useMemo(() => {
    const r = st?.rules.find(r => r.board_id === boardId && r.key === "max_concurrent");
    return r ? parseInt(r.value) || 2 : 2;
  }, [st, boardId]);

  const typeMap = useMemo(() => new Map((st?.types ?? []).map(t => [t.code, t])), [st]);

  const entriesByDay = useMemo(() => {
    const m = new Map<string, LeaveEntry[]>();
    for (const e of data?.entries ?? []) {
      const arr = m.get(e.day) ?? []; arr.push(e); m.set(e.day, arr);
    }
    return m;
  }, [data]);

  const blockedDays = useMemo(() => {
    const m = new Map<string, string>(); // nap → indoklás(ok)
    for (const b of data?.blackouts ?? []) {
      const d = new Date(b.from_day + "T00:00:00");
      const end = new Date(b.to_day + "T00:00:00");
      while (d <= end) {
        const k = iso(d);
        const prev = m.get(k);
        const r = b.reason || "";
        m.set(k, prev ? (r && !prev.includes(r) ? prev + " · " + r : prev) : r);
        d.setDate(d.getDate() + 1);
      }
    }
    return m;
  }, [data]);

  const holidayMap = useMemo(() =>
    new Map((data?.holidays ?? []).map(h => [h.day, h])), [data]);

  const dayFull = (day: string) => {
    const ppl = new Set((entriesByDay.get(day) ?? [])
      .filter(e => typeMap.get(e.type_code)?.limit_szamit).map(e => e.person_id));
    return ppl.size >= lim;
  };

  if (err && !st) return <div className="center-msg">Hiba: {err}</div>;
  if (!st || !data) return <div className="center-msg">{t("loading")}</div>;

  const board = st.boards.find(b => b.id === boardId);
  const used = usedQuotaDays(data.myEntries, st.types);
  const quotaDays = data.quota?.days ?? null;

  const monthName = (m: number) =>
    new Date(year, m, 1).toLocaleDateString(locale, { month: "long" });
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // A szabályok mindenkire érvényesek (HR-re is): zárolt vagy betelt napra nem megy beírás
  const canWriteDay = (day: string) =>
    !blockedDays.has(day) && !dayFull(day);

  async function submitAdd(form: {
    person: string; from: string; to: string; part: Part; type: string;
    note: string; skipWeekend: boolean;
  }) {
    const days: string[] = [];
    const d = new Date(form.from + "T00:00:00");
    const end = new Date(form.to + "T00:00:00");
    if (end < d) throw new Error(t("err_range"));
    while (d <= end) {
      const dayIso = iso(d);
      const dow = d.getDay();
      if (!(form.skipWeekend && (dow === 0 || dow === 6 || holidayMap.has(dayIso)))) days.push(dayIso);
      d.setDate(d.getDate() + 1);
    }
    if (!days.length) throw new Error(t("err_range"));
    await addLeave(boardId, form.person, days, form.part, form.type, form.note);
    await reloadYear();
  }

  async function removeEntry(e: LeaveEntry) {
    if (!confirm(t("confirm_del_entry"))) return;
    try { await deleteLeave(e.id); await reloadYear(); }
    catch (ex) { alert((ex as Error).message); }
  }

  return (
    <>
      <header className="appbar">
        <span className="t">{t("leave_title")}</span>
        <nav className="topnav">
          <Link href="/tabla">{t("nav_tabla")}</Link>
          <Link href="/szabadsag" className="active">{t("nav_leave")}</Link>
        </nav>
        <span className="sp" />
        <button className="lang-btn" title="Frissítés" onClick={() => window.location.reload()}>↻</button>
        <select className="lang-select" value={lang}
                onChange={e => setLang(e.target.value as "hu" | "ro")}>
          <option value="hu">HU — magyar</option>
          <option value="ro">RO — română</option>
        </select>
        <button className="lang-btn" onClick={() => supabase.auth.signOut()}>{t("sign_out")}</button>
      </header>

      <div className="leave-toolbar">
        <div className="board-chips">
          {st.boards.map(b => (
            <button key={b.id} className={"bchip" + (b.id === boardId ? " on" : "")}
                    onClick={() => setBoardId(b.id)}>
              {pick(b.name_hu, b.name_ro)}
            </button>
          ))}
        </div>
        <div className="leave-nav">
          <button className="mini-btn" onClick={() => setView(view === "honap" ? "ev" : "honap")}>
            {view === "honap" ? t("view_year") : t("view_month")}
          </button>
          {view === "honap" ? (
            <>
              <button className="mini-btn" disabled={year <= MIN_YEAR && month === 0} onClick={() => {
                const m = month - 1; if (m < 0) { setMonth(11); setYear(year - 1); } else setMonth(m);
              }}>◀</button>
              <b className="period">{year}. {monthName(month)}</b>
              <button className="mini-btn" onClick={() => {
                const m = month + 1; if (m > 11) { setMonth(0); setYear(year + 1); } else setMonth(m);
              }}>▶</button>
            </>
          ) : (
            <>
              <button className="mini-btn" disabled={year <= MIN_YEAR}
                      onClick={() => setYear(year - 1)}>◀</button>
              <b className="period">{year}</b>
              <button className="mini-btn" onClick={() => setYear(year + 1)}>▶</button>
            </>
          )}
        </div>
      </div>

      {err && <div className="leave-err">{err}</div>}

      {/* saját összesítő */}
      <div className="my-quota">
        <b>{st.me?.name}</b> · {t("quota")}: {quotaDays ?? "—"} · {t("used")}: {used} ·{" "}
        {t("left")}: {quotaDays != null ? quotaDays - used : "—"}
      </div>

      {view === "honap" ? (
        <div className="month-list">
          {Array.from({ length: daysInMonth }, (_, i) => {
            const d = new Date(year, month, i + 1);
            const day = iso(d);
            const dow = d.getDay();
            const weekend = dow === 0 || dow === 6;
            const holiday = holidayMap.get(day);
            const blocked = blockedDays.has(day);
            const es = entriesByDay.get(day) ?? [];
            const full = dayFull(day);
            return (
              <div key={day} onClick={() => setDayModal(day)}
                   className={"dayrow" + (weekend ? " weekend" : "") + (blocked ? " blocked" : "")}>
                <div className="daycol">
                  <b>{i + 1}</b>
                  <span>{d.toLocaleDateString(locale, { weekday: "short" })}</span>
                </div>
                <div className="daymain">
                  {holiday && <span className="holiday-tag">★ {holiday.name_ro || holiday.name_hu}</span>}
                  {blocked && (
                    <span className="blocked-tag">
                      {t("blocked")}{blockedDays.get(day) ? " · " + blockedDays.get(day) : ""}
                    </span>
                  )}
                  {es.map(e => {
                    const ty = typeMap.get(e.type_code);
                    return (
                      <span key={e.id} className="entry-chip" style={{ background: ty?.color }}
                            title={pick(ty?.name_hu ?? "", ty?.name_ro) + (e.note ? " — " + e.note : "")}>
                        {e.person?.name ?? "?"}
                        {e.part !== "egesz" && <em>½{e.part === "de" ? "DE" : "DU"}</em>}
                        {(st.isHr || e.person_id === st.me?.id) && day >= iso(new Date()) && (
                          <button className="chip-del"
                                  onClick={ev => { ev.stopPropagation(); removeEntry(e); }}>✕</button>
                        )}
                      </span>
                    );
                  })}
                  {full && !blocked && <span className="full-tag">{t("full")} ({lim})</span>}
                </div>
                <button className="day-add" disabled={!canWriteDay(day)}
                        onClick={ev => { ev.stopPropagation(); setShowAdd({ from: day, to: day }); }}>＋</button>
              </div>
            );
          })}
        </div>
      ) : (
        /* falitábla-nézet: 12 függőleges hónap-oszlop, hétköznap-sorokba igazítva */
        <div className="wall"><div className="wall-inner">
          {Array.from({ length: 12 }, (_, m) => {
            const dim = new Date(year, m + 1, 0).getDate();
            return (
              <div className="wcol" key={m}>
                <div className="wmonth" onClick={() => { setMonth(m); setView("honap"); }}>
                  {monthName(m)}
                </div>
                {Array.from({ length: 31 }, (_, r) => {
                  const dnum = r + 1;
                  if (dnum > dim)
                    return <div key={r} className="wcell wempty" />;
                  const dt = new Date(year, m, dnum);
                  const day = iso(dt);
                  const we = dt.getDay() === 0 || dt.getDay() === 6;
                  const es = entriesByDay.get(day) ?? [];
                  const blocked = blockedDays.has(day);
                  const hol = holidayMap.get(day);
                  const tip = [
                    day,
                    hol ? "★ " + (hol.name_ro || hol.name_hu) : "",
                    ...es.map(e => {
                      const ty = typeMap.get(e.type_code);
                      return (e.person?.name ?? "?") +
                        (e.part !== "egesz" ? " (½" + (e.part === "de" ? "DE" : "DU") + ")" : "") +
                        " — " + pick(ty?.name_hu ?? "", ty?.name_ro);
                    }),
                  ].filter(Boolean).join("\n");
                  return (
                    <div key={r} title={tip} onClick={() => setDayModal(day)}
                         className={"wcell" + (we ? " wwe" : "") +
                           (hol ? " whol" : "") + (blocked ? " wblocked" : "")}>
                      <span className="wnum">{dnum}</span>
                      <span className="wdow">{dt.toLocaleDateString(locale, { weekday: "short" })}</span>
                      <span className="wtags">
                        {hol && <span className="wstar">★</span>}
                        {es.slice(0, 4).map(e => (
                          <i key={e.id} style={{ background: typeMap.get(e.type_code)?.color }}>
                            {initialsOf(e.person?.name ?? "?")}
                          </i>
                        ))}
                        {es.length > 4 && <span className="wmore">+{es.length - 4}</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div></div>
      )}

      {/* saját bejegyzések */}
      <div className="my-list">
        <h3>{t("my_leave")} · {year}</h3>
        {data.myEntries.length === 0 && <div className="muted">{t("no_entries")}</div>}
        {data.myEntries.map(e => {
          const ty = typeMap.get(e.type_code);
          const b = st.boards.find(x => x.id === e.board_id);
          return (
            <div className="my-row" key={e.id}>
              <span className="dot" style={{ background: ty?.color }} />
              <b>{e.day}</b>
              <span>{e.part === "egesz" ? "" : e.part === "de" ? "½ DE" : "½ DU"}</span>
              <span className="muted">{pick(ty?.name_hu ?? "", ty?.name_ro)} · {pick(b?.name_hu ?? "", b?.name_ro)}</span>
              <span className="muted">({partWeight(e.part)} {t("day_unit")})</span>
              {(st.isHr || e.day >= iso(new Date())) && (
                <button className="del" onClick={() => removeEntry(e)}>✕</button>
              )}
            </div>
          );
        })}
      </div>

      {/* HR beállítások */}
      {st.isHr && (
        <div className="admin-box">
          <button className="admin-toggle" onClick={async () => {
            const open = !showAdmin; setShowAdmin(open);
            if (open) {
              const { data: q } = await supabase.from("leave_quotas").select("*").eq("year", year);
              setQuotasAll((q as Quota[]) ?? []);
            }
          }}>
            ⚙ {t("admin_panel")} {showAdmin ? "▴" : "▾"}
          </button>
          {showAdmin && board && (
            <AdminPanel st={st} boardId={boardId} year={year} lim={lim}
                        blackouts={data.blackouts} quotas={quotasAll}
                        onChanged={async () => {
                          const s = await loadLeaveStatic(); setSt(s);
                          await reloadYear(boardId, year, s.me?.id ?? null);
                          const { data: q } = await supabase.from("leave_quotas").select("*").eq("year", year);
                          setQuotasAll((q as Quota[]) ?? []);
                        }} />
          )}
        </div>
      )}

      <button className="fab" onClick={() => setShowAdd({ from: iso(new Date()), to: iso(new Date()) })}>
        ＋ {t("add_leave")}
      </button>

      {showAdd && (
        <AddModal st={st} defaults={showAdd} onClose={() => setShowAdd(null)}
                  onSave={submitAdd} />
      )}

      {dayModal && (() => {
        const day = dayModal;
        const es = entriesByDay.get(day) ?? [];
        const hol = holidayMap.get(day);
        const blocked = blockedDays.has(day);
        const reason = blockedDays.get(day);
        const d = new Date(day + "T00:00:00");
        return (
          <div className="overlay" onClick={e => { if (e.target === e.currentTarget) setDayModal(null); }}>
            <div className="modal">
              <h3 style={{ textTransform: "capitalize" }}>
                {d.toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric", weekday: "long" })}
              </h3>
              {hol && <div className="holiday-tag" style={{ display: "inline-block", marginBottom: 8 }}>
                ★ {hol.name_ro || hol.name_hu}</div>}
              {blocked && <div className="blocked-banner">
                {t("blocked")}{reason ? " · " + reason : ""}</div>}
              {es.length === 0 && <div className="muted" style={{ margin: "8px 0" }}>{t("no_entries")}</div>}
              {es.map(e => {
                const ty = typeMap.get(e.type_code);
                return (
                  <div className="my-row" key={e.id}>
                    <span className="dot" style={{ background: ty?.color }} />
                    <b>{e.person?.name ?? "?"}</b>
                    <span>{e.part === "egesz" ? "" : e.part === "de" ? "½ DE" : "½ DU"}</span>
                    <span className="muted">{pick(ty?.name_hu ?? "", ty?.name_ro)}</span>
                    {e.note && <span className="muted">„{e.note}”</span>}
                    {(st.isHr || (e.person_id === st.me?.id && day >= iso(new Date()))) && (
                      <button className="del" onClick={() => removeEntry(e)}>✕</button>
                    )}
                  </div>
                );
              })}
              <div className="btns">
                <button className="btn-cancel" onClick={() => setDayModal(null)}>{t("close")}</button>
                <button className="btn-save" disabled={!canWriteDay(day)}
                        onClick={() => { setDayModal(null); setShowAdd({ from: day, to: day }); }}>
                  ＋ {t("add_leave")}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}

// ── Beíró modal ───────────────────────────────────────────────
function AddModal({ st, defaults, onClose, onSave }: {
  st: LeaveStatic;
  defaults: { from: string; to: string };
  onClose: () => void;
  onSave: (f: { person: string; from: string; to: string; part: Part; type: string; note: string; skipWeekend: boolean }) => Promise<void>;
}) {
  const { t, pick } = useI18n();
  const selectableTypes = st.types.filter(ty => st.isHr || ty.self_service);
  const [person, setPerson] = useState(st.me?.id ?? "");
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [part, setPart] = useState<Part>("egesz");
  const [type, setType] = useState(selectableTypes[0]?.code ?? "szabadsag");
  const [note, setNote] = useState("");
  const [skipWeekend, setSkipWeekend] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    setBusy(true); setErr("");
    try { await onSave({ person, from, to, part, type, note, skipWeekend }); onClose(); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h3>{t("add_leave")}</h3>
        {st.isHr && (
          <>
            <label>{t("f_person")}</label>
            <select className="sel" value={person} onChange={e => setPerson(e.target.value)}>
              {st.persons.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </>
        )}
        <div className="date-pair">
          <div><label>{t("f_from")}</label>
            <input type="date" value={from} onChange={e => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} /></div>
          <div><label>{t("f_to")}</label>
            <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} /></div>
        </div>
        <label>{t("f_part")}</label>
        <select className="sel" value={part} onChange={e => setPart(e.target.value as Part)}>
          <option value="egesz">{t("part_egesz")}</option>
          <option value="de">{t("part_de")}</option>
          <option value="du">{t("part_du")}</option>
        </select>
        <label>{t("f_type")}</label>
        <select className="sel" value={type} onChange={e => setType(e.target.value)}>
          {selectableTypes.map(ty => (
            <option key={ty.code} value={ty.code}>{pick(ty.name_hu, ty.name_ro)}</option>
          ))}
        </select>
        <label>{t("f_note")}</label>
        <input type="text" value={note} onChange={e => setNote(e.target.value)} />
        <div className="chk">
          <input type="checkbox" id="skipwe" checked={skipWeekend}
                 onChange={e => setSkipWeekend(e.target.checked)} />
          <label htmlFor="skipwe" style={{ margin: 0, textTransform: "none", fontSize: 13.5, color: "var(--ink)" }}>
            {t("skip_weekend")}
          </label>
        </div>
        {err && <div className="err">{err}</div>}
        <div className="btns">
          <button className="btn-cancel" onClick={onClose}>{t("cancel")}</button>
          <button className="btn-save" onClick={save} disabled={busy}>{t("save")}</button>
        </div>
      </div>
    </div>
  );
}

// ── HR beállító panel ────────────────────────────────────────
function AdminPanel({ st, boardId, year, lim, blackouts, quotas, onChanged }: {
  st: LeaveStatic; boardId: string; year: number; lim: number;
  blackouts: Blackout[]; quotas: Quota[];
  onChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [limVal, setLimVal] = useState(String(lim));
  const [bFrom, setBFrom] = useState(""); const [bTo, setBTo] = useState("");
  const [bReason, setBReason] = useState("");
  const [bEditId, setBEditId] = useState<string | null>(null);
  const [qEdit, setQEdit] = useState<Record<string, string>>({});
  const memberSet = useMemo(() =>
    new Set(st.members.filter(m => m.board_id === boardId).map(m => m.person_id)),
    [st, boardId]);

  const run = async (fn: () => Promise<void>) => {
    try { await fn(); await onChanged(); }
    catch (e) { alert((e as Error).message); }
  };

  return (
    <div className="admin-panel">
      <section>
        <h4>{t("members")}</h4>
        {st.persons.map(p => (
          <label className="person-row" key={p.id}>
            <input type="checkbox" checked={memberSet.has(p.id)}
                   onChange={e => run(() => setMembership(p.id, boardId, e.target.checked))} />
            <span className="avatar" style={{ background: avColor(p.name) }}>
              {p.name.split(/\s+/).map(w => w[0]).join("").slice(0, 2)}
            </span>
            {p.name}
          </label>
        ))}
      </section>
      <section>
        <h4>{t("rule_max")}</h4>
        <div className="inline-form">
          <input type="number" min={1} max={20} value={limVal}
                 onChange={e => setLimVal(e.target.value)} style={{ width: 70 }} />
          <button className="mini-btn"
                  onClick={() => run(() => setRule(boardId, "max_concurrent", limVal))}>
            {t("save")}
          </button>
        </div>
      </section>
      <section>
        <h4>{t("blackouts")}</h4>
        {blackouts.map(b => (
          <div className={"my-row" + (bEditId === b.id ? " editing-row" : "")} key={b.id}>
            <b>{b.from_day} → {b.to_day}</b>
            <span className="muted">{b.reason}</span>
            <button className="pencil" onClick={() => {
              setBEditId(b.id); setBFrom(b.from_day); setBTo(b.to_day); setBReason(b.reason ?? "");
            }}>✎</button>
            <button className="del" onClick={() => run(() => deleteBlackout(b.id))}>✕</button>
          </div>
        ))}
        <div className="inline-form">
          <input type="date" value={bFrom} onChange={e => setBFrom(e.target.value)} />
          <input type="date" value={bTo} min={bFrom} onChange={e => setBTo(e.target.value)} />
          <input type="text" placeholder={t("reason")} value={bReason}
                 onChange={e => setBReason(e.target.value)} />
          <button className="mini-btn" disabled={!bFrom || !bTo}
                  onClick={() => run(async () => {
                    if (bEditId) await updateBlackout(bEditId, bFrom, bTo, bReason);
                    else await addBlackout(boardId, bFrom, bTo, bReason);
                    setBEditId(null); setBFrom(""); setBTo(""); setBReason("");
                  })}>
            {bEditId ? t("save") : t("add")}
          </button>
          {bEditId && (
            <button className="mini-btn" onClick={() => {
              setBEditId(null); setBFrom(""); setBTo(""); setBReason("");
            }}>{t("cancel")}</button>
          )}
        </div>
      </section>
      <section>
        <h4>{t("holidays_admin")} · {year}</h4>
        <button className="mini-btn"
                onClick={() => run(async () => { await generateHolidays(year); })}>
          {t("gen_holidays")}
        </button>
        <div className="fhint" style={{ marginTop: 4 }}>{t("gen_holidays_hint")}</div>
      </section>
      <section>
        <h4>{t("quotas")} · {year}</h4>
        {st.persons.map(p => {
          const q = quotas.find(x => x.person_id === p.id);
          const val = qEdit[p.id] ?? (q ? String(q.days) : "");
          return (
            <div className="my-row" key={p.id}>
              <span style={{ flex: 1 }}>{p.name}</span>
              <input type="number" step="0.5" min={0} style={{ width: 80 }} value={val}
                     placeholder="—"
                     onChange={e => setQEdit(s => ({ ...s, [p.id]: e.target.value }))} />
              <button className="mini-btn" disabled={val === ""}
                      onClick={() => run(() => setQuota(p.id, year, parseFloat(val)))}>
                {t("save")}
              </button>
            </div>
          );
        })}
      </section>
    </div>
  );
}
