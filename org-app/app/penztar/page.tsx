"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase, withAuthRetry } from "@/lib/supabaseClient";
import { useI18n } from "@/lib/i18n";
import {
  CashUnit, CashCategory, CashVehicle, CashQuicklabel, DayPayload, LedgerEntry, OverviewDay,
  cashContext, cashSaveDay, cashCloseDay, cashMeta, DENOMS,
  cashBalance, cashLedger, cashQuickAdd, uploadReceipt, receiptUrl,
  cashOverview, cashMonetarOf, cashReview, CashExpense,
  cashClients, cashPendingResolve, PendingItem,
  cashReopenDay, cashDayDetail, cashBalanceAt,
} from "@/lib/penztar";

const fmt = (n: number) =>
  n.toLocaleString("hu-HU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (s: string) => {
  const n = parseFloat((s || "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

type ExpenseDraft = {
  amount: string; category_id: string; vehicle_id: string;
  client_name: string; description: string;
};

export default function PenztarPage() {
  const { t, lang, setLang, pick } = useI18n();
  const router = useRouter();
  const [ctx, setCtx] = useState<{ today: string; units: CashUnit[] } | null>(null);
  const [meta, setMeta] = useState<{ categories: CashCategory[]; vehicles: CashVehicle[]; quicklabels: CashQuicklabel[] } | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [isHr, setIsHr] = useState(false);
  const [tab, setTab] = useState<"zaras" | "naplo" | "havi" | "ellenorzes" | "kategoriak">("zaras");
  const [editing, setEditing] = useState<{ unit: CashUnit; day: string } | null>(null);
  const [err, setErr] = useState("");
  const [denied, setDenied] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [c, m] = [await withAuthRetry(() => cashContext()), await withAuthRetry(() => cashMeta())];
      setCtx(c); setMeta(m);
      setUnitId(prev => prev && c.units.some(u => u.id === prev) ? prev : (c.units[0]?.id ?? null));
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("jogosult")) setDenied(true); else setErr(msg);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      const { data: me } = await supabase.from("persons")
        .select("id").eq("user_id", session.user.id).maybeSingle();
      const { data: caps } = await supabase.from("person_capabilities")
        .select("person_id, capability");
      const mine = new Set((caps ?? [])
        .filter(c => c.person_id === me?.id).map(c => c.capability));
      setIsHr(mine.has("hr") || mine.has("admin"));
      await reload();
    })();
  }, [router, reload]);

  const unit = ctx?.units.find(u => u.id === unitId) ?? null;

  const loadPast = useCallback(async (u: CashUnit, day: string) => {
    const det = await withAuthRetry(() => cashDayDetail(u.id, day));
    const pseudo: CashUnit = {
      ...u, today_day: det.day, monetar: det.monetar, expenses: det.expenses,
      pending_today: det.pending, pending_open: [], nexus_today: det.nexus,
      nexus_synced_at: null, history: [],
    };
    setEditing({ unit: pseudo, day });
  }, []);

  async function openPast(u: CashUnit, day: string, status: string) {
    try {
      if (status === "lezart" || status === "elfogadva") {
        await withAuthRetry(() => cashReopenDay(u.id, day));
      }
      await loadPast(u, day);
    } catch (e) { alert((e as Error).message); }
  }

  return (
    <>
      <header className="appbar">
        <span className="t">{t("pz_title")}</span>
        <nav className="topnav">
          <Link href="/tabla">{t("nav_tabla")}</Link>
          <Link href="/szabadsag">{t("nav_leave")}</Link>
          <Link href="/kollegak">{t("nav_people")}</Link>
          <Link href="/statisztika">{t("nav_stat")}</Link>
          <Link href="/penztar" className="active">{t("nav_penztar")}</Link>
        </nav>
        <span className="sp" />
        <button className="lang-btn" onClick={() => window.location.reload()}>↻</button>
        <select className="lang-select" value={lang}
                onChange={e => setLang(e.target.value as "hu" | "ro")}>
          <option value="hu">HU — magyar</option>
          <option value="ro">RO — română</option>
        </select>
        <button className="lang-btn" onClick={() => supabase.auth.signOut()}>{t("sign_out")}</button>
      </header>

      {denied ? (
        <div className="center-msg">{t("pz_no_access")}</div>
      ) : err ? (
        <div className="leave-err" style={{ margin: 14 }}>{err}</div>
      ) : !ctx || !meta ? (
        <div className="center-msg">{t("loading")}</div>
      ) : ctx.units.length === 0 && !isHr ? (
        <div className="center-msg">{t("pz_no_unit")}</div>
      ) : (
        <div className="pz-wrap" style={tab !== "zaras" ? { maxWidth: 1060 } : undefined}>
          {isHr && (
            <div className="board-chips" style={{ marginBottom: 12 }}>
              <button className={"bchip" + (tab === "zaras" ? " on" : "")}
                      onClick={() => setTab("zaras")}>{t("pz_tab_zaras")}</button>
              <button className={"bchip" + (tab === "naplo" ? " on" : "")}
                      onClick={() => setTab("naplo")}>{t("pz_tab_naplo")}</button>
              <button className={"bchip" + (tab === "havi" ? " on" : "")}
                      onClick={() => setTab("havi")}>{t("pz_tab_havi")}</button>
              <button className={"bchip" + (tab === "ellenorzes" ? " on" : "")}
                      onClick={() => setTab("ellenorzes")}>{t("pz_tab_ellenorzes")}</button>
              <button className={"bchip" + (tab === "kategoriak" ? " on" : "")}
                      onClick={() => setTab("kategoriak")}>{t("pz_tab_kategoriak")}</button>
            </div>
          )}
          {tab === "naplo" && isHr ? (
            <NaploTab meta={meta} units={ctx.units} />
          ) : tab === "havi" && isHr ? (
            <HaviTab units={ctx.units} />
          ) : tab === "ellenorzes" && isHr ? (
            <EllenorzesTab meta={meta} units={ctx.units} />
          ) : tab === "kategoriak" && isHr ? (
            <KategoriakTab meta={meta} onChanged={reload} />
          ) : (<>
          {ctx.units.length > 1 && (
            <div className="board-chips" style={{ marginBottom: 12 }}>
              {ctx.units.map(u => (
                <button key={u.id} className={"bchip" + (u.id === unitId ? " on" : "")}
                        onClick={() => setUnitId(u.id)}>{pick(u.name_hu, u.name_ro ?? u.name_hu)}</button>
              ))}
            </div>
          )}
          {editing ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="stat-card" style={{ display: "flex", alignItems: "center", gap: 10,
                                                  borderColor: "#f0ddbb", background: "#fdf8ee" }}>
                <b style={{ fontSize: 13.5, color: "#9a6c10" }}>✎ {t("pz_editing_past")}: {editing.day}</b>
                <span style={{ flex: 1 }} />
                <button className="mini-btn" onClick={() => { setEditing(null); reload(); }}>
                  ← {t("pz_back_today")}
                </button>
              </div>
              <ClosingForm key={"past" + editing.unit.id + editing.day + (editing.unit.today_day?.status ?? "")}
                           unit={editing.unit} meta={meta} today={editing.day}
                           editDay={editing.day}
                           onChanged={async () => { await loadPast(editing.unit, editing.day); }} />
            </div>
          ) : unit && (
            <ClosingForm key={unit.id + (unit.today_day?.status ?? "")} unit={unit} meta={meta}
                         today={ctx.today} onChanged={reload} />
          )}
          {!editing && unit && unit.kind === "lerakat" && unit.history.length > 0 && (
            <div className="stat-card" style={{ marginTop: 14 }}>
              <b style={{ fontSize: 14 }}>{t("pz_history_title")}</b>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                {unit.history.map(h => (
                  <div key={h.day} className="pz-hist">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <b>{h.day}</b>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {h.closed_by_name ?? "—"} · {t("pz_expenses")}: {fmt(h.expenses_total)} · NEXUS: {h.nexus_revenue != null ? fmt(h.nexus_revenue) : "—"}
                      </div>
                      {h.expl_cash && <div className="muted" style={{ fontSize: 12 }}>„{h.expl_cash}"</div>}
                    </div>
                    {h.status === "nyitott"
                      ? <span className="acct-tag">{t("pz_st_nyitott")}</span>
                      : h.cash_diff != null && Math.abs(h.cash_diff) > 1
                        ? <span className="pct-tag neg">{h.cash_diff > 0 ? "+" : ""}{fmt(h.cash_diff)}</span>
                        : <span className="pct-tag pos">{fmt(h.cash_diff ?? 0)} ✓</span>}
                    <button className="mini-btn" onClick={() => openPast(unit, h.day, h.status)}>
                      ✎ {t("pz_open_day")}
                    </button>
                  </div>
                ))}
              </div>
              <div className="fhint" style={{ marginTop: 10 }}>{t("pz_history_note")}</div>
            </div>
          )}
          </>)}
        </div>
      )}
    </>
  );
}

/* ══════════ NAPLÓ + EGYENLEG (vezetői) ══════════ */
function isoWeek(ds: string): number {
  const d = new Date(ds + "T12:00:00");
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dn = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - dn + 3);
  const f = new Date(Date.UTC(x.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((x.getTime() - f.getTime()) / 86400000 - 3 + ((f.getUTCDay() + 6) % 7)) / 7);
}

function NaploTab({ meta, units }: {
  meta: { categories: CashCategory[]; vehicles: CashVehicle[]; quicklabels: CashQuicklabel[] };
  units: CashUnit[];
}) {
  const { t, pick } = useI18n();
  const now = new Date();
  const [ym, setYm] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [bal, setBal] = useState<{ opening_balance: number; opening_date: string; balance: number; pending_open?: number } | null>(null);
  const [rows, setRows] = useState<LedgerEntry[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setErr("");
    try {
      const [y, m] = ym.split("-").map(Number);
      const from = `${ym}-01`;
      const to = `${y}-${String(m).padStart(2, "0")}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
      const [b, l] = [await withAuthRetry(() => cashBalance()), await withAuthRetry(() => cashLedger(from, to))];
      setBal(b); setRows(l);
    } catch (e) { setErr((e as Error).message); }
  }, [ym]);
  useEffect(() => { load(); }, [load]);

  const shift = (d: number) => {
    const [y, m] = ym.split("-").map(Number);
    const n = new Date(y, m - 1 + d, 1);
    setYm(`${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`);
  };

  const weeks = useMemo(() => {
    const map = new Map<number, LedgerEntry[]>();
    for (const r of rows ?? []) {
      const w = isoWeek(r.entry_date);
      map.set(w, [...(map.get(w) ?? []), r]);
    }
    return [...map.entries()].sort((a, b) => b[0] - a[0]);
  }, [rows]);

  const monthIn = (rows ?? []).filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0);
  const monthOut = (rows ?? []).filter(r => r.amount < 0).reduce((s, r) => s + r.amount, 0);

  async function showReceipt(path: string) {
    try { window.open(await receiptUrl(path), "_blank"); }
    catch (e) { alert((e as Error).message); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {err && <div className="leave-err">{err}</div>}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-l">{t("pz_opening")} — {bal?.opening_date ?? ""}</div>
          <div className="kpi-v">{bal ? fmt(bal.opening_balance) : "…"}</div>
        </div>
        <div className="kpi-card" style={{ background: "#1d5a33", borderColor: "#1d5a33" }}>
          <div className="kpi-l" style={{ color: "#bfdcc9" }}>{t("pz_balance")}</div>
          <div className="kpi-v" style={{ color: "#fff" }}>{bal ? fmt(bal.balance) : "…"}</div>
          {bal != null && (bal.pending_open ?? 0) > 0 && (
            <div style={{ fontSize: 11.5, color: "#f5c6b8", marginTop: 2 }}>
              + {fmt(bal.pending_open!)} {t("pz_pending_bal")}
            </div>
          )}
        </div>
        <div className="kpi-card">
          <div className="kpi-l">{t("pz_month_in")}</div>
          <div className="kpi-v" style={{ color: "#1d5a33" }}>+{fmt(monthIn)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-l">{t("pz_month_out")}</div>
          <div className="kpi-v" style={{ color: "#b3431f" }}>{fmt(monthOut)}</div>
        </div>
      </div>

      <QuickAdd meta={meta} units={units} onSaved={load} />

      <div className="stat-card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="stat-thead">
          <button className="mini-btn" onClick={() => shift(-1)}>‹</button>
          <span style={{ flex: 1, textAlign: "center" }}>{ym}</span>
          <button className="mini-btn" onClick={() => shift(1)}>›</button>
        </div>
        <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {!rows ? <div className="muted">{t("loading")}</div> :
            weeks.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>{t("stat_no_data")}</div> :
            weeks.map(([w, es]) => {
              const win = es.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0);
              const wout = es.filter(r => r.amount < 0).reduce((s, r) => s + r.amount, 0);
              const o = open === w;
              return (
                <div key={w} style={{ border: "1px solid #e2e8e3", borderRadius: 12, overflow: "hidden" }}>
                  <button onClick={() => setOpen(o ? null : w)}
                          style={{ width: "100%", border: "none", background: o ? "#eef6f0" : "none",
                                   padding: "11px 14px", display: "flex", alignItems: "center", gap: 12,
                                   cursor: "pointer", font: "inherit", textAlign: "left" }}>
                    <b style={{ fontSize: 13.5 }}>{o ? "▾" : "▸"} {w}. {t("pz_week")}</b>
                    <span style={{ flex: 1 }} />
                    <span className="muted" style={{ fontSize: 12.5 }}>
                      +{fmt(win)} · {fmt(wout)}
                    </span>
                  </button>
                  {o && es.map((r, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10,
                                          padding: "8px 14px", borderTop: "1px solid #f0f3f1", fontSize: 13 }}>
                      <b style={{ width: 78 }}>{r.entry_date.slice(5)}</b>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span>{r.etype === "zaras" ? `${r.unit_name ?? ""} — ${t("pz_e_zaras")}` : r.label}</span>
                        <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>
                          {r.who ?? ""}{r.status === "nyitott" ? ` · ${t("pz_st_nyitott")}` : ""}
                        </span>
                        {r.expl && <div className="muted" style={{ fontSize: 12 }}>„{r.expl}"</div>}
                      </div>
                      {r.receipt_path && (
                        <button className="mini-btn" onClick={() => showReceipt(r.receipt_path!)}>📎</button>
                      )}
                      <b style={{ fontVariantNumeric: "tabular-nums",
                                  color: r.amount >= 0 ? "#1d5a33" : "#b3431f" }}>
                        {r.amount >= 0 ? "+" : ""}{fmt(r.amount)}
                      </b>
                    </div>
                  ))}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}

function QuickAdd({ meta, units, onSaved }: {
  meta: { categories: CashCategory[]; vehicles: CashVehicle[]; quicklabels: CashQuicklabel[] };
  units: CashUnit[];
  onSaved: () => Promise<void>;
}) {
  const { t, pick } = useI18n();
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const [day, setDay] = useState(iso);
  const [kind, setKind] = useState<"letet" | "koltseg" | "korrekcio">("letet");
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState("");
  const [cat, setCat] = useState("");
  const [desc, setDesc] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function save() {
    setBusy(true); setErr(""); setMsg("");
    try {
      const amt = num(amount);
      if (!amt) throw new Error(t("pz_err_amount"));
      let receipt: string | null = null;
      if (file) receipt = await withAuthRetry(() => uploadReceipt(file));
      await withAuthRetry(() => cashQuickAdd({
        day, kind, amount: amt, unit: unit || null, category: cat || null,
        desc: desc || null, note: note || null, receipt,
      }));
      setAmount(""); setDesc(""); setNote(""); setFile(null);
      setMsg(t("pz_saved"));
      await onSaved();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  return (
    <div className="stat-card" style={{ borderColor: "#cfdfd5" }}>
      <b style={{ fontSize: 14 }}>{t("pz_quick_title")}</b>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
        <label className="pz-field" style={{ width: 150 }}>
          <span>{t("f_from")}</span>
          <input type="date" value={day} onChange={e => setDay(e.target.value)} />
        </label>
        <label className="pz-field" style={{ flex: 1, minWidth: 180 }}>
          <span>{t("f_type")}</span>
          <select className="sel" value={kind}
                  onChange={e => setKind(e.target.value as "letet" | "koltseg" | "korrekcio")}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1.5px solid #cfd9d1" }}>
            <option value="letet">{t("pz_k_letet")}</option>
            <option value="koltseg">{t("pz_k_koltseg")}</option>
            <option value="korrekcio">{t("pz_k_korrekcio")}</option>
          </select>
        </label>
        <label className="pz-field" style={{ width: 140 }}>
          <span>{t("pz_amount")}</span>
          <input type="text" inputMode="decimal" value={amount} placeholder="0,00"
                 onChange={e => setAmount(e.target.value)} style={{ textAlign: "right", fontWeight: 700 }} />
        </label>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
        {kind === "koltseg" && (
          <label className="pz-field" style={{ minWidth: 170 }}>
            <span>{t("pz_category")}</span>
            <select className="sel" value={cat} onChange={e => setCat(e.target.value)}
                    style={{ padding: "10px 12px", borderRadius: 10, border: "1.5px solid #cfd9d1" }}>
              <option value="">—</option>
              {meta.categories.map(c => <option key={c.id} value={c.id}>{pick(c.name_hu, c.name_ro ?? c.name_hu)}</option>)}
            </select>
          </label>
        )}
        <label className="pz-field" style={{ minWidth: 150 }}>
          <span>{t("pz_unit_opt")}</span>
          <select className="sel" value={unit} onChange={e => setUnit(e.target.value)}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1.5px solid #cfd9d1" }}>
            <option value="">—</option>
            {units.map(u => <option key={u.id} value={u.id}>{pick(u.name_hu, u.name_ro ?? u.name_hu)}</option>)}
          </select>
        </label>
        <label className="pz-field" style={{ flex: 1, minWidth: 180 }}>
          <span>{t("pz_desc")}</span>
          <input type="text" value={desc} onChange={e => setDesc(e.target.value)}
                 placeholder={t("pz_quick_ph")} />
        </label>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10, alignItems: "flex-end" }}>
        <label className="pz-field" style={{ flex: 1, minWidth: 200 }}>
          <span>{t("f_note")}</span>
          <input type="text" value={note} onChange={e => setNote(e.target.value)} />
        </label>
        <label className="mini-btn" style={{ cursor: "pointer", padding: "10px 14px" }}>
          📎 {file ? file.name.slice(0, 22) : t("pz_receipt")}
          <input type="file" accept="image/*,.pdf" style={{ display: "none" }}
                 onChange={e => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <button className="pz-close-btn" style={{ flex: "0 0 auto", padding: "11px 24px" }}
                disabled={busy} onClick={save}>{busy ? "⏳" : t("pz_record")}</button>
      </div>
      {err && <div className="leave-err" style={{ marginTop: 10 }}>{err}</div>}
      {msg && <div className="fhint" style={{ marginTop: 10, background: "#e6f2ea", color: "#1d5a33" }}>{msg}</div>}
      <div className="fhint" style={{ marginTop: 10 }}>{t("pz_quick_hint")}</div>
    </div>
  );
}

function ClosingForm({ unit, meta, today, editDay, onChanged }: {
  unit: CashUnit;
  meta: { categories: CashCategory[]; vehicles: CashVehicle[]; quicklabels: CashQuicklabel[] };
  today: string;
  editDay?: string;
  onChanged: () => Promise<void>;
}) {
  const { t, lang, pick } = useI18n();
  const d = unit.today_day;
  const locked = d?.status === "lezart" || d?.status === "elfogadva";

  const [qty, setQty] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const m of unit.monetar) o[String(m.denom)] = String(m.qty);
    return o;
  });
  const [floatM, setFloatM] = useState(d?.float_morning != null ? String(d.float_morning) : "100");
  const [floatE, setFloatE] = useState(d?.float_evening != null ? String(d.float_evening) : "100");
  const [zCash, setZCash] = useState(d?.z_cash != null ? String(d.z_cash) : "");
  const [zCard, setZCard] = useState(d?.z_card != null ? String(d.z_card) : "");
  const [pos, setPos] = useState(d?.pos_settlement != null ? String(d.pos_settlement) : "");
  const [nexusRev, setNexusRev] = useState(d?.nexus_revenue != null ? String(d.nexus_revenue) : "");
  const [explCash, setExplCash] = useState(d?.expl_cash ?? "");
  const [explCard, setExplCard] = useState(d?.expl_card ?? "");
  const [expenses, setExpenses] = useState(unit.expenses.map(e => ({
    amount: String(e.amount), category_id: e.category_id ?? "", vehicle_id: e.vehicle_id ?? "",
    client_name: e.client_name ?? "", description: e.description ?? "",
  })));
  const [pending, setPending] = useState<{ amount: string; note: string }[]>(
    unit.pending_today.map(p => ({ amount: String(p.amount), note: p.note ?? "" })));
  const [pAmount, setPAmount] = useState("");
  const [pNote, setPNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function syncCasa() {
    setSyncing(true); setErr("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Nincs bejelentkezés. / Nu ești autentificat.");
      const r = await fetch("/api/casa-now", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Szinkron hiba");
      await onChanged();
    } catch (e) { setErr((e as Error).message); }
    setSyncing(false);
  }

  const counted = useMemo(() =>
    DENOMS.reduce((s, dn) => s + dn * (parseInt(qty[String(dn)] || "0", 10) || 0), 0), [qty]);
  const expTotal = useMemo(() =>
    expenses.reduce((s, e) => s + num(e.amount), 0), [expenses]);
  const pendTotal = useMemo(() =>
    pending.reduce((s, p) => s + num(p.amount), 0), [pending]);

  const effNexus = unit.kind === "lerakat"
    ? (unit.nexus_today != null ? unit.nexus_today : (nexusRev ? num(nexusRev) : null))
    : null;
  const cashDiff = useMemo(() => {
    if (unit.kind === "bolt") {
      if (!zCash) return null;
      return Math.round((counted + pendTotal - (num(zCash) - expTotal + num(floatM) - num(floatE))) * 100) / 100;
    }
    if (effNexus == null) return null;
    return Math.round((counted + expTotal + pendTotal - effNexus) * 100) / 100;
  }, [unit.kind, counted, expTotal, pendTotal, zCash, floatM, floatE, effNexus]);
  const cardDiff = useMemo(() =>
    zCard && pos ? Math.round((num(zCard) - num(pos)) * 100) / 100 : null, [zCard, pos]);

  function payload(): DayPayload {
    return {
      float_morning: unit.kind === "bolt" ? floatM : "",
      float_evening: unit.kind === "bolt" ? floatE : "",
      z_cash: zCash, z_card: zCard, pos_settlement: pos,
      nexus_revenue: unit.nexus_today != null ? String(unit.nexus_today) : nexusRev,
      expl_cash: explCash, expl_card: explCard,
      monetar: DENOMS.map(dn => ({ denom: dn, qty: parseInt(qty[String(dn)] || "0", 10) || 0 })),
      expenses: expenses.map(e => ({
        amount: num(e.amount), category_id: e.category_id || null,
        vehicle_id: e.vehicle_id || null, client_name: e.client_name || null,
        description: e.description || null,
      })),
      pending: pending.map(p => ({ amount: num(p.amount), note: p.note || null })),
    };
  }

  async function resolvePending(id: string) {
    try { await withAuthRetry(() => cashPendingResolve(id)); await onChanged(); }
    catch (e) { alert((e as Error).message); }
  }

  async function save(closeToo: boolean) {
    setBusy(true); setErr(""); setMsg("");
    try {
      await withAuthRetry(() => cashSaveDay(unit.id, payload(), editDay));
      if (closeToo) {
        await withAuthRetry(() => cashCloseDay(unit.id, editDay));
      }
      setMsg(closeToo ? t("pz_closed_ok") : t("pz_saved"));
      await onChanged();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  const diffChip = (v: number | null) => {
    if (v == null) return null;
    const ok = Math.abs(v) <= 1;
    return (
      <span className={"pct-tag " + (ok ? "pos" : "neg")}>
        {v > 0 ? "+" : ""}{fmt(v)}{ok ? " ✓" : ""}
      </span>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="stat-card" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <b style={{ fontSize: 15 }}>{pick(unit.name_hu, unit.name_ro ?? unit.name_hu)}</b>
        <span className="muted">{today}</span>
        <span className="sp" style={{ flex: 1 }} />
        {locked
          ? <span className="pct-tag pos">{t("pz_st_lezart")} ✓</span>
          : d?.status === "visszakuldve"
            ? <span className="pct-tag neg">{t("pz_st_visszakuldve")}</span>
            : <span className="acct-tag">{t("pz_st_nyitott")}</span>}
      </div>

      {d?.status === "visszakuldve" && d.review_note && (
        <div className="leave-err">{t("pz_review_note")}: {d.review_note}</div>
      )}

      {unit.kind === "lerakat" && (
        <div className="stat-card" style={{ borderColor: "#bcd8c6" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <b style={{ fontSize: 13, color: "#5c6b61", flex: 1 }}>{t("pz_nexus_rev")}</b>
            {unit.nexus_today != null && (
              <span className="acct-tag ok">NEXUS · {unit.nexus_synced_at ?? ""}</span>
            )}
            {!locked && (
              <button className="mini-btn" disabled={syncing} onClick={syncCasa}>
                {syncing ? "⏳" : "⟳"} {t("pz_casa_sync")}
              </button>
            )}
          </div>
          {unit.nexus_today != null ? (
            <div style={{ marginTop: 8, fontSize: 28, fontWeight: 800, color: "#1d5a33",
                          fontVariantNumeric: "tabular-nums" }}>
              {fmt(unit.nexus_today)} <span style={{ fontSize: 14, color: "#6b7a70", fontWeight: 600 }}>RON</span>
            </div>
          ) : (
            <>
              <div className="fhint" style={{ marginTop: 8 }}>{t("pz_nexus_missing")}</div>
              <input type="text" inputMode="decimal" value={nexusRev} disabled={locked}
                     onChange={e => setNexusRev(e.target.value)} placeholder="0,00"
                     style={{ marginTop: 8, width: 180, border: "1.5px solid #cfd9d1", borderRadius: 10,
                              padding: "10px 12px", fontSize: 18, fontWeight: 700, textAlign: "right" }} />
            </>
          )}
        </div>
      )}

      {unit.kind === "bolt" && (
        <div className="stat-card">
          <b style={{ fontSize: 13, color: "#5c6b61" }}>{t("pz_float")}</b>
          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <label className="pz-field" style={{ flex: 1 }}>
              <span>{t("pz_float_morning")}</span>
              <input type="text" inputMode="decimal" value={floatM} disabled={locked}
                     onChange={e => setFloatM(e.target.value)} />
            </label>
            <label className="pz-field" style={{ flex: 1 }}>
              <span>{t("pz_float_evening")}</span>
              <input type="text" inputMode="decimal" value={floatE} disabled={locked}
                     onChange={e => setFloatE(e.target.value)} />
            </label>
          </div>
        </div>
      )}

      <div className="stat-card">
        <b style={{ fontSize: 13, color: "#5c6b61" }}>{t("pz_monetar")}</b>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
          {DENOMS.map(dn => {
            const q = parseInt(qty[String(dn)] || "0", 10) || 0;
            return (
              <div key={dn} className="pz-mrow">
                <input type="text" inputMode="numeric" value={qty[String(dn)] ?? ""} disabled={locked}
                       placeholder="0" aria-label={`${dn} db`}
                       onChange={e => setQty(s => ({ ...s, [String(dn)]: e.target.value.replace(/[^0-9]/g, "") }))} />
                <span className="muted">×</span>
                <b style={{ width: 48 }}>{dn.toLocaleString("hu-HU")}</b>
                <span className="pz-dots" />
                <span className={q ? "" : "muted"} style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                  {fmt(dn * q)}
                </span>
              </div>
            );
          })}
        </div>
        <div className="pz-total">
          <span>{t("pz_counted")}</span>
          <b>{fmt(counted)}</b>
        </div>
      </div>

      <div className="stat-card">
        <div style={{ display: "flex", alignItems: "center" }}>
          <b style={{ fontSize: 13, color: "#5c6b61", flex: 1 }}>{t("pz_expenses")}</b>
          <b style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(expTotal)}</b>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 8 }}>
          {expenses.length === 0 && <div className="muted" style={{ fontSize: 13 }}>{t("pz_no_expenses")}</div>}
          {expenses.map((e, i) => {
            const cat = meta.categories.find(c => c.id === e.category_id);
            const veh = meta.vehicles.find(v => v.id === e.vehicle_id);
            return (
              <div key={i} className="pz-exp">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{e.description || (cat ? pick(cat.name_hu, cat.name_ro ?? cat.name_hu) : "—")}</div>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 2 }}>
                    {cat && <span className="pz-chip">{pick(cat.name_hu, cat.name_ro ?? cat.name_hu)}</span>}
                    {veh && <span className="pz-chip">{veh.plate}</span>}
                    {e.client_name && <span className="pz-chip">{e.client_name}</span>}
                  </div>
                </div>
                <b style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(num(e.amount))}</b>
                {!locked && (
                  <button className="del" onClick={() => setExpenses(xs => xs.filter((_, j) => j !== i))}>✕</button>
                )}
              </div>
            );
          })}
        </div>
        {!locked && (
          <button className="add-btn" onClick={() => setAdding(true)}>{t("pz_add_expense")}</button>
        )}
      </div>

      <div className="stat-card" style={pending.length || unit.pending_open.length ? { borderColor: "#eec6bd" } : undefined}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <b style={{ fontSize: 13, color: "#5c6b61", flex: 1 }}>{t("pz_pending_title")}</b>
          {pendTotal > 0 && <b style={{ fontVariantNumeric: "tabular-nums", color: "#b3431f" }}>{fmt(pendTotal)}</b>}
        </div>
        {unit.pending_open.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {unit.pending_open.map(p => (
              <div key={p.id} className="pz-exp" style={{ borderColor: "#eec6bd", background: "#fdf1ee" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ fontSize: 13.5, color: "#b3431f" }}>{p.day} · {fmt(p.amount)}</b>
                  {p.note && <div className="muted" style={{ fontSize: 12 }}>{p.note}</div>}
                </div>
                <button className="mini-btn" onClick={() => p.id && resolvePending(p.id)}>✓ {t("pz_arrived")}</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
          {pending.map((p, i) => (
            <div key={i} className="pz-exp">
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontSize: 13.5 }}>{fmt(num(p.amount))}</b>
                {p.note && <span className="muted" style={{ fontSize: 12.5, marginLeft: 8 }}>{p.note}</span>}
              </div>
              {!locked && (
                <button className="del" onClick={() => setPending(xs => xs.filter((_, j) => j !== i))}>✕</button>
              )}
            </div>
          ))}
        </div>
        {!locked && (
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <input type="text" inputMode="decimal" value={pAmount} placeholder={t("pz_amount")}
                   onChange={e => setPAmount(e.target.value)}
                   style={{ width: 110, border: "1.5px solid #cfd9d1", borderRadius: 10, padding: "9px 10px",
                            font: "inherit", fontWeight: 700, textAlign: "right" }} />
            <input type="text" value={pNote} placeholder={t("pz_driver_note")}
                   onChange={e => setPNote(e.target.value)}
                   style={{ flex: 1, minWidth: 140, border: "1.5px solid #cfd9d1", borderRadius: 10,
                            padding: "9px 10px", font: "inherit" }} />
            <button className="mini-btn" onClick={() => {
              if (!num(pAmount)) return;
              setPending(xs => [...xs, { amount: pAmount, note: pNote.trim() }]);
              setPAmount(""); setPNote("");
            }}>{t("add")}</button>
          </div>
        )}
        <div className="fhint" style={{ marginTop: 8 }}>{t("pz_pending_hint")}</div>
      </div>

      {unit.kind === "bolt" && (
        <>
          <div className="stat-card">
            <b style={{ fontSize: 13, color: "#5c6b61" }}>{t("pz_z_cash")}</b>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
              <input type="text" inputMode="decimal" value={zCash} disabled={locked} placeholder="0,00"
                     onChange={e => setZCash(e.target.value)}
                     style={{ width: 160, border: "1.5px solid #cfd9d1", borderRadius: 10,
                              padding: "10px 12px", fontSize: 16, fontWeight: 700, textAlign: "right" }} />
              {cashDiff != null && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="muted" style={{ fontSize: 13 }}>{t("pz_diff")}:</span>
                  {diffChip(cashDiff)}
                </div>
              )}
            </div>
            {cashDiff != null && Math.abs(cashDiff) > 1 && (
              <label className="pz-field" style={{ marginTop: 10 }}>
                <span>{t("pz_expl_cash")} *</span>
                <textarea value={explCash} disabled={locked} rows={2}
                          onChange={e => setExplCash(e.target.value)} />
              </label>
            )}
          </div>

          <div className="stat-card">
            <b style={{ fontSize: 13, color: "#5c6b61" }}>{t("pz_card")}</b>
            <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
              <label className="pz-field" style={{ flex: 1, minWidth: 140 }}>
                <span>{t("pz_z_card")}</span>
                <input type="text" inputMode="decimal" value={zCard} disabled={locked} placeholder="0,00"
                       onChange={e => setZCard(e.target.value)} style={{ textAlign: "right", fontWeight: 700 }} />
              </label>
              <label className="pz-field" style={{ flex: 1, minWidth: 140 }}>
                <span>{t("pz_pos")}</span>
                <input type="text" inputMode="decimal" value={pos} disabled={locked} placeholder="0,00"
                       onChange={e => setPos(e.target.value)} style={{ textAlign: "right", fontWeight: 700 }} />
              </label>
            </div>
            {cardDiff != null && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                <span className="muted" style={{ fontSize: 13 }}>{t("pz_diff")}:</span>
                {diffChip(cardDiff)}
              </div>
            )}
            {cardDiff != null && Math.abs(cardDiff) > 1 && (
              <label className="pz-field" style={{ marginTop: 10 }}>
                <span>{t("pz_expl_card")} *</span>
                <textarea value={explCard} disabled={locked} rows={2}
                          onChange={e => setExplCard(e.target.value)} />
              </label>
            )}
          </div>
        </>
      )}

      {unit.kind === "lerakat" && cashDiff != null && (
        <div className="stat-card">
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
            <span className="muted">{t("pz_counted")}</span><b>{fmt(counted)}</b>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginTop: 4 }}>
            <span className="muted">{t("pz_expenses")}</span><b>+ {fmt(expTotal)}</b>
          </div>
          {pendTotal > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginTop: 4 }}>
              <span className="muted">{t("pz_pending_title")}</span>
              <b style={{ color: "#b3431f" }}>+ {fmt(pendTotal)}</b>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginTop: 4, borderTop: "1px solid #edf1ee", paddingTop: 6 }}>
            <span className="muted">{t("pz_nexus_rev")}</span><b>{fmt(effNexus ?? 0)}</b>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
            <b style={{ fontSize: 13 }}>{t("pz_diff")}</b>
            {diffChip(cashDiff)}
          </div>
          {Math.abs(cashDiff) > 1 && (
            <label className="pz-field" style={{ marginTop: 10 }}>
              <span>{t("pz_expl_cash")} *</span>
              <textarea value={explCash} disabled={locked} rows={2}
                        onChange={e => setExplCash(e.target.value)} />
            </label>
          )}
        </div>
      )}

      {err && <div className="leave-err">{err}</div>}
      {msg && <div className="fhint" style={{ background: "#e6f2ea", color: "#1d5a33" }}>{msg}</div>}

      {!locked && (
        <div style={{ display: "flex", gap: 10 }}>
          <button className="mini-btn" style={{ flex: 1, padding: 13, fontSize: 15 }}
                  disabled={busy} onClick={() => save(false)}>{t("pz_save")}</button>
          <button className="pz-close-btn" disabled={busy} onClick={() => {
            if (confirm(t("pz_close_confirm"))) save(true);
          }}>{t("pz_close_day")}</button>
        </div>
      )}
      <button className="mini-btn" style={{ padding: 12, fontSize: 14.5 }} onClick={() => {
        const pseudo = {
          id: d?.id ?? "", unit_id: unit.id, day: editDay ?? today,
          status: d?.status ?? "nyitott", closed_by: null,
          float_morning: num(floatM), float_evening: num(floatE),
          counted_cash: counted, z_cash: zCash ? num(zCash) : null,
          z_card: zCard ? num(zCard) : null, pos_settlement: pos ? num(pos) : null,
          nexus_revenue: effNexus, cash_diff: cashDiff, card_diff: cardDiff,
          expl_cash: explCash || null, expl_card: explCard || null, review_note: null,
          cash_units: { name_hu: unit.name_hu, name_ro: unit.name_ro, kind: unit.kind },
        } as unknown as OverviewDay;
        const mon = DENOMS.map(dn => ({ denom: dn, qty: parseInt(qty[String(dn)] || "0", 10) || 0 }))
          .filter(m => m.qty > 0);
        const exps = expenses.map(e => ({
          amount: num(e.amount), category_id: e.category_id || null,
          vehicle_id: e.vehicle_id || null, client_name: e.client_name || null,
          description: e.description || null, id: "", day: editDay ?? today,
        })) as unknown as (CashExpense & { day: string })[];
        printDay(pseudo, mon, exps, meta, new Map(), lang,
                 pending.map(p => ({ amount: num(p.amount), note: p.note || null })));
      }}>🖨 {t("pz_print")}</button>

      {adding && (
        <ExpenseModal meta={meta} unitKind={unit.kind} onClose={() => setAdding(false)}
                      onAdd={e => { setExpenses(xs => [...xs, e]); setAdding(false); }} />
      )}
    </div>
  );
}

function ExpenseModal({ meta, unitKind, onClose, onAdd }: {
  meta: { categories: CashCategory[]; vehicles: CashVehicle[]; quicklabels: CashQuicklabel[] };
  unitKind: "bolt" | "lerakat";
  onClose: () => void;
  onAdd: (e: ExpenseDraft) => void;
}) {
  const { t, pick } = useI18n();
  const cats = meta.categories.filter(c =>
    c.staff_can_use && c.approved && (c.scope === "mind" || c.scope === unitKind));
  const [cat, setCat] = useState(cats[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [client, setClient] = useState("");
  const [desc, setDesc] = useState("");
  const [err, setErr] = useState("");
  const [clientOpts, setClientOpts] = useState<string[]>([]);
  const c = cats.find(x => x.id === cat);
  const labels = meta.quicklabels.filter(q => q.category_id === cat);

  // ügyfél-javaslatok a NEXUS-törzsből, gépelés közben
  useEffect(() => {
    if (client.trim().length < 2) { setClientOpts([]); return; }
    const h = setTimeout(async () => {
      try { setClientOpts(await withAuthRetry(() => cashClients(client.trim()))); }
      catch { /* javaslatok nélkül is megy */ }
    }, 300);
    return () => clearTimeout(h);
  }, [client]);

  function add() {
    if (!num(amount)) { setErr(t("pz_err_amount")); return; }
    if (c?.req_vehicle && !vehicle) { setErr(t("pz_err_vehicle")); return; }
    if (c?.req_client && !client.trim()) { setErr(t("pz_err_client")); return; }
    if (c?.req_desc && !desc.trim()) { setErr(t("pz_err_desc")); return; }
    onAdd({ amount, category_id: cat, vehicle_id: vehicle, client_name: client.trim(), description: desc.trim() });
  }

  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h3>{t("pz_add_expense")}</h3>
        <label>{t("pz_category")}</label>
        <select className="sel" value={cat} onChange={e => { setCat(e.target.value); setErr(""); }}>
          {cats.map(x => <option key={x.id} value={x.id}>{pick(x.name_hu, x.name_ro ?? x.name_hu)}</option>)}
        </select>
        <label>{t("pz_amount")}</label>
        <input type="text" inputMode="decimal" value={amount} placeholder="0,00"
               onChange={e => setAmount(e.target.value)} />
        {c?.req_vehicle && (
          <>
            <label>{t("pz_vehicle")} *</label>
            <select className="sel" value={vehicle} onChange={e => setVehicle(e.target.value)}>
              <option value="">—</option>
              {meta.vehicles.map(v => <option key={v.id} value={v.id}>{v.plate}</option>)}
            </select>
          </>
        )}
        {c?.req_client && (
          <>
            <label>{t("pz_client")} *</label>
            <input type="text" list="pz-client-list" value={client}
                   placeholder={"🔍 " + t("pz_client_hint")}
                   onChange={e => setClient(e.target.value)} />
            <datalist id="pz-client-list">
              {clientOpts.map(x => <option key={x} value={x} />)}
            </datalist>
          </>
        )}
        <label>{t("pz_desc")}{c?.req_desc ? " *" : ""}</label>
        <input type="text" value={desc} onChange={e => setDesc(e.target.value)} />
        {labels.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {labels.map(l => (
              <button key={l.id} className="bchip" style={{ padding: "4px 11px" }}
                      onClick={() => setDesc(l.label)}>{l.label}</button>
            ))}
          </div>
        )}
        {err && <div className="err">{err}</div>}
        <div className="btns">
          <button className="btn-cancel" onClick={onClose}>{t("cancel")}</button>
          <button className="btn-save" onClick={add}>{t("add")}</button>
        </div>
      </div>
    </div>
  );
}

/* ══════════ ELLENŐRZÉS (vezetői) ══════════ */
function EllenorzesTab({ meta, units }: {
  meta: { categories: CashCategory[]; vehicles: CashVehicle[]; quicklabels: CashQuicklabel[] };
  units: CashUnit[];
}) {
  const { t, lang, pick } = useI18n();
  const now = new Date();
  const [ym, setYm] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [unitF, setUnitF] = useState("");
  const [days, setDays] = useState<OverviewDay[] | null>(null);
  const [expenses, setExpenses] = useState<(CashExpense & { day_id: string | null; day: string; kind: string })[]>([]);
  const [persons, setPersons] = useState<Map<string, string>>(new Map());
  const [open, setOpen] = useState<string | null>(null);
  const [monetar, setMonetar] = useState<{ denom: number; qty: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setErr("");
    try {
      const [y, m] = ym.split("-").map(Number);
      const from = `${ym}-01`;
      const to = `${y}-${String(m).padStart(2, "0")}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
      const o = await withAuthRetry(() => cashOverview(from, to));
      setDays(o.days); setExpenses(o.expenses); setPersons(o.persons);
    } catch (e) { setErr((e as Error).message); }
  }, [ym]);
  useEffect(() => { load(); }, [load]);

  const shift = (d: number) => {
    const [y, m] = ym.split("-").map(Number);
    const n = new Date(y, m - 1 + d, 1);
    setYm(`${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`);
  };

  async function expand(d: OverviewDay) {
    if (open === d.id) { setOpen(null); return; }
    setOpen(d.id);
    try { setMonetar(await withAuthRetry(() => cashMonetarOf(d.id))); }
    catch { setMonetar([]); }
  }

  async function review(d: OverviewDay, action: "elfogad" | "visszakuld") {
    let note: string | null = null;
    if (action === "visszakuld") {
      note = prompt(t("pz_return_note"));
      if (!note) return;
    }
    setBusy(true);
    try { await withAuthRetry(() => cashReview(d.id, action, note ?? undefined)); await load(); }
    catch (e) { alert((e as Error).message); }
    setBusy(false);
  }

  const statusChip = (st: string) =>
    st === "elfogadva" ? <span className="pct-tag pos">{t("pz_st_elfogadva")}</span>
    : st === "lezart" ? <span className="acct-tag ok">{t("pz_st_lezart")}</span>
    : st === "visszakuldve" ? <span className="pct-tag neg">{t("pz_st_visszakuldve")}</span>
    : <span className="acct-tag">{t("pz_st_nyitott")}</span>;

  function doPrint(d: OverviewDay) {
    const exps = expenses.filter(e => e.day_id === d.id);
    printDay(d, monetar, exps, meta, persons, lang);
  }

  const shown = (days ?? []).filter(d => !unitF || d.unit_id === unitF);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {err && <div className="leave-err">{err}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div className="board-chips">
          <button className={"bchip" + (!unitF ? " on" : "")} onClick={() => setUnitF("")}>{t("stat_all")}</button>
          {units.map(u => (
            <button key={u.id} className={"bchip" + (unitF === u.id ? " on" : "")}
                    onClick={() => setUnitF(u.id)}>{pick(u.name_hu, u.name_ro ?? u.name_hu)}</button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <button className="mini-btn" onClick={() => shift(-1)}>‹</button>
        <b style={{ fontSize: 14 }}>{ym}</b>
        <button className="mini-btn" onClick={() => shift(1)}>›</button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {!days ? <div className="muted">{t("loading")}</div> :
          shown.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>{t("stat_no_data")}</div> :
          shown.map(d => {
            const exps = expenses.filter(e => e.day_id === d.id);
            const expSum = exps.reduce((s, e) => s + Number(e.amount || 0), 0);
            const o = open === d.id;
            const warn = (d.cash_diff != null && Math.abs(d.cash_diff) > 1 && !d.expl_cash) ||
                         (d.card_diff != null && Math.abs(d.card_diff) > 1 && !d.expl_card);
            return (
              <div key={d.id} className="stat-card"
                   style={{ padding: 0, overflow: "hidden",
                            borderColor: warn ? "#f0ddbb" : d.status === "visszakuldve" ? "#eec6bd" : undefined }}>
                <button onClick={() => expand(d)}
                        style={{ width: "100%", border: "none", background: "none", padding: "12px 14px",
                                 display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
                                 font: "inherit", textAlign: "left", flexWrap: "wrap" }}>
                  <b style={{ fontSize: 14 }}>{o ? "▾" : "▸"} {d.day}</b>
                  <span className="pz-chip">{pick(d.cash_units?.name_hu ?? "", d.cash_units?.name_ro ?? d.cash_units?.name_hu ?? "")}</span>
                  <span className="muted" style={{ fontSize: 12.5 }}>{d.closed_by ? persons.get(d.closed_by) ?? "" : ""}</span>
                  <span style={{ flex: 1 }} />
                  {d.cash_diff != null && (
                    <span className={"pct-tag " + (Math.abs(d.cash_diff) <= 1 ? "pos" : "neg")}>
                      KP {d.cash_diff > 0 ? "+" : ""}{fmt(d.cash_diff)}
                    </span>
                  )}
                  {d.card_diff != null && (
                    <span className={"pct-tag " + (Math.abs(d.card_diff) <= 1 ? "pos" : "neg")}>
                      {t("pz_card")} {d.card_diff > 0 ? "+" : ""}{fmt(d.card_diff)}
                    </span>
                  )}
                  {statusChip(d.status)}
                </button>
                {o && (
                  <div style={{ borderTop: "1px solid #edf1ee", padding: "12px 14px",
                                display: "flex", flexWrap: "wrap", gap: 18 }}>
                    <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                      <div className="kpi-l">{t("pz_monetar")}</div>
                      {monetar.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>—</div> :
                        monetar.map(m => (
                          <div key={m.denom} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                            <span>{m.qty} × {m.denom.toLocaleString("hu-HU")}</span>
                            <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(m.denom * m.qty)}</span>
                          </div>
                        ))}
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5,
                                    fontWeight: 700, borderTop: "1px solid #edf1ee", marginTop: 4, paddingTop: 4 }}>
                        <span>{t("pz_counted")}</span>
                        <span>{fmt(d.counted_cash ?? 0)}</span>
                      </div>
                    </div>
                    <div style={{ flex: "1 1 240px", minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                      <div className="kpi-l">{t("pz_values")}</div>
                      {d.cash_units?.kind === "bolt" ? (
                        <>
                          <Row l={t("pz_float_morning") + " / " + t("pz_float_evening")}
                               v={fmt(d.float_morning ?? 0) + " / " + fmt(d.float_evening ?? 0)} />
                          <Row l="Z — KP" v={fmt(d.z_cash ?? 0)} />
                          <Row l="Z — card" v={fmt(d.z_card ?? 0)} />
                          <Row l="POS" v={fmt(d.pos_settlement ?? 0)} />
                        </>
                      ) : (
                        <Row l={t("pz_nexus_rev")} v={fmt(d.nexus_revenue ?? 0)} />
                      )}
                      <Row l={t("pz_expenses")} v={fmt(expSum)} />
                      {exps.map((e, i) => {
                        const cat = meta.categories.find(c => c.id === e.category_id);
                        const veh = meta.vehicles.find(v => v.id === e.vehicle_id);
                        return (
                          <div key={i} className="muted" style={{ fontSize: 12.5, paddingLeft: 8 }}>
                            • {e.description || "—"} ({[cat && pick(cat.name_hu, cat.name_ro ?? cat.name_hu), veh?.plate, e.client_name]
                                .filter(Boolean).join(" · ")}) — {fmt(Number(e.amount))}
                          </div>
                        );
                      })}
                      {d.expl_cash && <div style={{ fontSize: 12.5, background: "#f6f8fb", borderRadius: 8, padding: "6px 9px" }}>KP: „{d.expl_cash}"</div>}
                      {d.expl_card && <div style={{ fontSize: 12.5, background: "#f6f8fb", borderRadius: 8, padding: "6px 9px" }}>{t("pz_card")}: „{d.expl_card}"</div>}
                      {d.review_note && <div style={{ fontSize: 12.5, color: "#b3431f" }}>{t("pz_review_note")}: {d.review_note}</div>}
                    </div>
                    <div style={{ flex: "0 1 180px", display: "flex", flexDirection: "column", gap: 8, justifyContent: "center" }}>
                      {d.status === "lezart" && (
                        <button className="pz-close-btn" style={{ padding: "10px 14px", fontSize: 14 }}
                                disabled={busy} onClick={() => review(d, "elfogad")}>{t("pz_accept")}</button>
                      )}
                      {(d.status === "lezart" || d.status === "elfogadva") && (
                        <button className="mini-btn" style={{ padding: "10px 14px" }}
                                disabled={busy} onClick={() => review(d, "visszakuld")}>{t("pz_return")}</button>
                      )}
                      <button className="mini-btn" style={{ padding: "10px 14px" }}
                              onClick={() => doPrint(d)}>🖨 {t("pz_print")}</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

function Row({ l, v }: { l: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
      <span className="muted">{l}</span>
      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{v}</span>
    </div>
  );
}

function printDay(
  d: OverviewDay,
  monetar: { denom: number; qty: number }[],
  exps: (CashExpense & { day: string })[],
  meta: { categories: CashCategory[]; vehicles: CashVehicle[] },
  persons: Map<string, string>,
  lang: string,
  pending: { amount: number; note: string | null }[] = [],
) {
  const ro = lang === "ro";
  const uname = ro ? (d.cash_units?.name_ro ?? d.cash_units?.name_hu) : d.cash_units?.name_hu;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const expSum = exps.reduce((s, e) => s + Number(e.amount || 0), 0);
  const rows = monetar.map(m =>
    `<tr><td style="text-align:right">${m.qty}</td><td>×</td><td style="text-align:right">${m.denom.toLocaleString("hu-HU")}</td><td style="text-align:right">${fmt(m.denom * m.qty)}</td></tr>`).join("");
  const expRows = exps.map(e => {
    const cat = meta.categories.find(c => c.id === e.category_id);
    const veh = meta.vehicles.find(v => v.id === e.vehicle_id);
    const tags = [cat ? (ro ? cat.name_ro ?? cat.name_hu : cat.name_hu) : null, veh?.plate, e.client_name].filter(Boolean).join(" · ");
    return `<tr><td>${esc(e.description ?? "—")}</td><td>${esc(tags)}</td><td style="text-align:right">${fmt(Number(e.amount))}</td></tr>`;
  }).join("");
  const vals = d.cash_units?.kind === "bolt"
    ? `<tr><td>${ro ? "Schimb dimineața / seara" : "Váltó reggel / este"}</td><td style="text-align:right">${fmt(d.float_morning ?? 0)} / ${fmt(d.float_evening ?? 0)}</td></tr>
       <tr><td>Raport Z — numerar</td><td style="text-align:right">${fmt(d.z_cash ?? 0)}</td></tr>
       <tr><td>Raport Z — card</td><td style="text-align:right">${fmt(d.z_card ?? 0)}</td></tr>
       <tr><td>Settlement POS</td><td style="text-align:right">${fmt(d.pos_settlement ?? 0)}</td></tr>`
    : `<tr><td>${ro ? "Vânzarea conform casei (NEXUS)" : "A gép szerinti árulás (NEXUS)"}</td><td style="text-align:right">${fmt(d.nexus_revenue ?? 0)}</td></tr>`;
  const w = window.open("", "_blank", "width=720,height=900");
  if (!w) { alert("Engedélyezd a felugró ablakot. / Permite fereastra pop-up."); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(uname ?? "")} — ${d.day}</title>
  <style>body{font-family:'Segoe UI',sans-serif;font-size:13px;color:#111;margin:28px;max-width:640px}
  h1{font-size:17px;margin:0 0 2px}h2{font-size:13px;margin:16px 0 6px;text-transform:uppercase;letter-spacing:.05em;color:#555}
  table{border-collapse:collapse;width:100%}td{padding:3px 8px;border-bottom:1px solid #eee}
  .tot{font-weight:700;border-top:1.5px solid #333}
  .sig{margin-top:40px;display:flex;gap:40px}.sig div{flex:1;border-top:1px solid #333;padding-top:4px;font-size:12px;text-align:center}
  </style></head><body>
  <h1>${ro ? "FOAIE DE EVIDENȚĂ" : "KASSZAZÁRÁS"} — ${esc(uname ?? "")}</h1>
  <div>${d.day} · ${esc(d.closed_by ? persons.get(d.closed_by) ?? "" : "")} · ${esc(d.status)}</div>
  <h2>Monetar</h2><table>${rows}<tr class="tot"><td colspan="3">${ro ? "Numerar numărat" : "Megszámolt készpénz"}</td><td style="text-align:right">${fmt(d.counted_cash ?? 0)}</td></tr></table>
  <h2>${ro ? "Valori" : "Értékek"}</h2><table>${vals}
  <tr><td>${ro ? "Diferență numerar" : "Készpénz-eltérés"}</td><td style="text-align:right">${d.cash_diff != null ? fmt(d.cash_diff) : "—"}</td></tr>
  ${d.card_diff != null ? `<tr><td>${ro ? "Diferență card" : "Kártya-eltérés"}</td><td style="text-align:right">${fmt(d.card_diff)}</td></tr>` : ""}</table>
  <h2>${ro ? "Cheltuieli" : "Költségek"}</h2><table>${expRows || `<tr><td>—</td></tr>`}<tr class="tot"><td colspan="2">Total</td><td style="text-align:right">${fmt(expSum)}</td></tr></table>
  ${pending.length ? `<h2>${ro ? "Bani rămași la șofer" : "Sofőrnél maradt pénz"}</h2><table>${pending.map(p =>
    `<tr><td>${esc(p.note ?? "—")}</td><td style="text-align:right">${fmt(p.amount)}</td></tr>`).join("")}</table>` : ""}
  ${d.expl_cash ? `<h2>${ro ? "Explicație numerar" : "Készpénz-indoklás"}</h2><div>${esc(d.expl_cash)}</div>` : ""}
  ${d.expl_card ? `<h2>${ro ? "Explicație card" : "Kártya-indoklás"}</h2><div>${esc(d.expl_card)}</div>` : ""}
  <div class="sig"><div>${ro ? "Predat (semnătura)" : "Átadta (aláírás)"}</div><div>${ro ? "Preluat (semnătura)" : "Átvette (aláírás)"}</div></div>
  <script>window.print()</script></body></html>`);
  w.document.close();
}

/* ══════════ KATEGÓRIÁK (admin) ══════════ */
function KategoriakTab({ meta, onChanged }: {
  meta: { categories: CashCategory[]; vehicles: CashVehicle[]; quicklabels: CashQuicklabel[] };
  onChanged: () => Promise<void>;
}) {
  const { t, pick } = useI18n();
  const [edit, setEdit] = useState<CashCategory | null>(null);
  const [creating, setCreating] = useState(false);
  const [newVeh, setNewVeh] = useState("");

  async function saveVehicle() {
    if (!newVeh.trim()) return;
    const { error } = await supabase.from("cash_vehicles").insert({ plate: newVeh.trim().toUpperCase() });
    if (error) { alert(error.message); return; }
    setNewVeh("");
    await onChanged();
  }
  async function dropVehicle(id: string) {
    const { error } = await supabase.from("cash_vehicles").update({ active: false }).eq("id", id);
    if (error) alert(error.message);
    await onChanged();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="stat-card">
        <div style={{ display: "flex", alignItems: "center" }}>
          <b style={{ fontSize: 14, flex: 1 }}>{t("pz_tab_kategoriak")}</b>
          <button className="mini-btn" onClick={() => setCreating(true)}>＋ {t("pz_new_cat")}</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
          {meta.categories.map(c => (
            <div key={c.id} className="pz-exp" style={!c.approved ? { borderColor: "#f0ddbb", background: "#fdf8ee" } : undefined}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontSize: 14 }}>{pick(c.name_hu, c.name_ro ?? c.name_hu)}</b>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 3 }}>
                  {c.req_vehicle && <span className="pz-chip">{t("pz_req")}: {t("pz_vehicle")}</span>}
                  {c.req_client && <span className="pz-chip">{t("pz_req")}: {t("pz_client")}</span>}
                  {c.req_desc && <span className="pz-chip">{t("pz_req")}: {t("pz_desc")}</span>}
                  {c.scope !== "mind" && <span className="pz-chip" style={{ background: "#e8f0fe", color: "#1a4fbc" }}>
                    {c.scope === "bolt" ? t("pz_scope_bolt") : t("pz_scope_lerakat")}</span>}
                  {!c.staff_can_use && <span className="pz-chip">{t("pz_admin_only")}</span>}
                  {!c.approved && <span className="pz-chip" style={{ background: "#fbeccb", color: "#9a6c10" }}>{t("pz_pending")}</span>}
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    {meta.quicklabels.filter(q => q.category_id === c.id).map(q => q.label).join(", ")}
                  </span>
                </div>
              </div>
              <button className="pencil" onClick={() => setEdit(c)}>✎</button>
            </div>
          ))}
        </div>
      </div>

      <div className="stat-card">
        <b style={{ fontSize: 14 }}>{t("pz_vehicles")}</b>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
          {meta.vehicles.map(v => (
            <span key={v.id} className="pz-chip" style={{ fontSize: 13, padding: "5px 11px" }}>
              {v.plate}
              <button className="del" style={{ marginLeft: 2 }} onClick={() => {
                if (confirm(t("pz_veh_del"))) dropVehicle(v.id);
              }}>✕</button>
            </span>
          ))}
          <input type="text" value={newVeh} placeholder="FSS21"
                 onChange={e => setNewVeh(e.target.value)}
                 style={{ border: "1.5px solid #cfd9d1", borderRadius: 9, padding: "7px 10px", width: 110, font: "inherit" }} />
          <button className="mini-btn" onClick={saveVehicle}>{t("add")}</button>
        </div>
      </div>

      {(edit || creating) && (
        <CategoryModal cat={edit} quicklabels={meta.quicklabels.filter(q => edit && q.category_id === edit.id)}
                       onClose={() => { setEdit(null); setCreating(false); }}
                       onSaved={async () => { setEdit(null); setCreating(false); await onChanged(); }} />
      )}
    </div>
  );
}

function CategoryModal({ cat, quicklabels, onClose, onSaved }: {
  cat: CashCategory | null;
  quicklabels: CashQuicklabel[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [hu, setHu] = useState(cat?.name_hu ?? "");
  const [ro, setRo] = useState(cat?.name_ro ?? "");
  const [reqV, setReqV] = useState(cat?.req_vehicle ?? false);
  const [reqC, setReqC] = useState(cat?.req_client ?? false);
  const [reqD, setReqD] = useState(cat?.req_desc ?? false);
  const [staff, setStaff] = useState(cat?.staff_can_use ?? true);
  const [scope, setScope] = useState<"mind" | "bolt" | "lerakat">(cat?.scope ?? "mind");
  const [approved, setApproved] = useState(cat?.approved ?? true);
  const [active, setActive] = useState(cat?.active ?? true);
  const [labels, setLabels] = useState(quicklabels.map(q => q.label).join(", "));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    if (!hu.trim()) return;
    setBusy(true); setErr("");
    try {
      const row = { name_hu: hu.trim(), name_ro: ro.trim() || null, req_vehicle: reqV,
                    req_client: reqC, req_desc: reqD, staff_can_use: staff, approved, active, scope };
      let catId = cat?.id;
      if (cat) {
        const { error } = await supabase.from("cash_categories").update(row).eq("id", cat.id);
        if (error) throw new Error(error.message);
      } else {
        const { data, error } = await supabase.from("cash_categories").insert(row).select("id").single();
        if (error) throw new Error(error.message);
        catId = (data as { id: string }).id;
      }
      if (catId) {
        const want = labels.split(",").map(s => s.trim()).filter(Boolean);
        const { error: de } = await supabase.from("cash_quicklabels").delete().eq("category_id", catId);
        if (de) throw new Error(de.message);
        if (want.length) {
          const { error: ie } = await supabase.from("cash_quicklabels")
            .insert(want.map(label => ({ category_id: catId, label })));
          if (ie) throw new Error(ie.message);
        }
      }
      await onSaved();
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h3>{cat ? t("pz_edit_cat") : t("pz_new_cat")}</h3>
        <label>{t("f_name_hu")}</label>
        <input type="text" value={hu} onChange={e => setHu(e.target.value)} autoFocus />
        <label>{t("f_name_ro")}</label>
        <input type="text" value={ro} onChange={e => setRo(e.target.value)} />
        <label>{t("pz_scope")}</label>
        <select className="sel" value={scope} onChange={e => setScope(e.target.value as "mind" | "bolt" | "lerakat")}>
          <option value="mind">{t("pz_scope_mind")}</option>
          <option value="bolt">{t("pz_scope_bolt")}</option>
          <option value="lerakat">{t("pz_scope_lerakat")}</option>
        </select>
        <label>{t("pz_req_fields")}</label>
        <div className="chk"><input id="rv" type="checkbox" checked={reqV} onChange={e => setReqV(e.target.checked)} /><label htmlFor="rv" style={{ textTransform: "none", margin: 0 }}>{t("pz_vehicle")}</label></div>
        <div className="chk"><input id="rc" type="checkbox" checked={reqC} onChange={e => setReqC(e.target.checked)} /><label htmlFor="rc" style={{ textTransform: "none", margin: 0 }}>{t("pz_client")}</label></div>
        <div className="chk"><input id="rd" type="checkbox" checked={reqD} onChange={e => setReqD(e.target.checked)} /><label htmlFor="rd" style={{ textTransform: "none", margin: 0 }}>{t("pz_desc")}</label></div>
        <label>{t("pz_settings")}</label>
        <div className="chk"><input id="st" type="checkbox" checked={staff} onChange={e => setStaff(e.target.checked)} /><label htmlFor="st" style={{ textTransform: "none", margin: 0 }}>{t("pz_staff_use")}</label></div>
        <div className="chk"><input id="ap" type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)} /><label htmlFor="ap" style={{ textTransform: "none", margin: 0 }}>{t("pz_approved")}</label></div>
        <div className="chk"><input id="ac" type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /><label htmlFor="ac" style={{ textTransform: "none", margin: 0 }}>{t("pz_active")}</label></div>
        <label>{t("pz_labels")}</label>
        <input type="text" value={labels} placeholder="olaj, mosás, verificare"
               onChange={e => setLabels(e.target.value)} />
        {err && <div className="err">{err}</div>}
        <div className="btns">
          <button className="btn-cancel" onClick={onClose}>{t("cancel")}</button>
          <button className="btn-save" onClick={save} disabled={busy || !hu.trim()}>{t("save")}</button>
        </div>
      </div>
    </div>
  );
}

/* ══════════ HAVI NÉZET (a régi táblázat mintájára) ══════════ */
function HaviTab({ units }: { units: CashUnit[] }) {
  const { t, pick } = useI18n();
  const now = new Date();
  const [ym, setYm] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [days, setDays] = useState<OverviewDay[] | null>(null);
  const [expenses, setExpenses] = useState<(CashExpense & { day_id: string | null; day: string; kind: string })[]>([]);
  const [balStart, setBalStart] = useState<number | null>(null);
  const [balEnd, setBalEnd] = useState<number | null>(null);
  const [expDay, setExpDay] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setErr("");
    try {
      const [y, m] = ym.split("-").map(Number);
      const from = `${ym}-01`;
      const to = `${y}-${String(m).padStart(2, "0")}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
      const nextFirst = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
      const o = await withAuthRetry(() => cashOverview(from, to));
      setDays(o.days); setExpenses(o.expenses);
      setBalStart(await withAuthRetry(() => cashBalanceAt(from)));
      setBalEnd(await withAuthRetry(() => cashBalanceAt(nextFirst)));
    } catch (e) { setErr((e as Error).message); }
  }, [ym]);
  useEffect(() => { load(); }, [load]);

  const shift = (d: number) => {
    const [y, m] = ym.split("-").map(Number);
    const n = new Date(y, m - 1 + d, 1);
    setYm(`${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`);
  };

  const bolts = units.filter(u => u.kind === "bolt").sort((a, b) => a.sort - b.sort);
  const lerakats = units.filter(u => u.kind === "lerakat").sort((a, b) => a.sort - b.sort);
  const [y, m] = ym.split("-").map(Number);
  const dayCount = new Date(y, m, 0).getDate();
  const dayList = Array.from({ length: dayCount }, (_, i) =>
    `${ym}-${String(i + 1).padStart(2, "0")}`);

  const dmap = useMemo(() => {
    const mm = new Map<string, OverviewDay>();
    for (const d of days ?? []) mm.set(d.unit_id + "|" + d.day, d);
    return mm;
  }, [days]);
  const expByDay = useMemo(() => {
    const mm = new Map<string, number>();
    for (const e of expenses) {
      if (e.kind !== "koltseg") continue;
      mm.set(e.day, (mm.get(e.day) ?? 0) + Number(e.amount || 0));
    }
    return mm;
  }, [expenses]);
  // egység+nap → kasszából fizetett költségek (a zárás tételei)
  const attachedExp = useMemo(() => {
    const mm = new Map<string, number>();
    for (const e of expenses) {
      if (!e.day_id || e.kind !== "koltseg") continue;
      const u = (e as unknown as { unit_id: string | null }).unit_id;
      if (!u) continue;
      mm.set(u + "|" + e.day, (mm.get(u + "|" + e.day) ?? 0) + Number(e.amount || 0));
    }
    return mm;
  }, [expenses]);

  // INKASSZÁLT érték: megszámolt pénz + aznap kasszából fizetett költségek
  const cashOf = (u: CashUnit, day: string) => {
    const d = dmap.get(u.id + "|" + day);
    if (!d || d.counted_cash == null) return null;
    return d.counted_cash + (attachedExp.get(u.id + "|" + day) ?? 0);
  };
  const cardOf = (u: CashUnit, day: string) => dmap.get(u.id + "|" + day)?.pos_settlement ?? null;

  const colTotals = useMemo(() => {
    const tot: Record<string, number> = {};
    for (const u of bolts) {
      tot[u.id + "c"] = dayList.reduce((s, d) => s + (cashOf(u, d) ?? 0), 0);
      tot[u.id + "k"] = dayList.reduce((s, d) => s + (cardOf(u, d) ?? 0), 0);
    }
    for (const u of lerakats) {
      tot[u.id + "c"] = dayList.reduce((s, d) => s + (cashOf(u, d) ?? 0), 0);
    }
    tot["exp"] = dayList.reduce((s, d) => s + (expByDay.get(d) ?? 0), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return tot;
  }, [dmap, expByDay, ym]);

  const grand = bolts.reduce((s, u) => s + (colTotals[u.id + "c"] ?? 0) + (colTotals[u.id + "k"] ?? 0), 0)
    + lerakats.reduce((s, u) => s + (colTotals[u.id + "c"] ?? 0), 0);

  const monthExpenses = expenses
    .filter(e => e.kind === "koltseg" || e.day_id === null)
    .sort((a, b) => a.day.localeCompare(b.day));

  const td: React.CSSProperties = { padding: "5px 9px", textAlign: "right",
    fontVariantNumeric: "tabular-nums", borderTop: "1px solid #f0f3f1", whiteSpace: "nowrap" };
  const th: React.CSSProperties = { padding: "7px 9px", fontSize: 10.5, textTransform: "uppercase",
    letterSpacing: "0.04em", color: "#8a968d", textAlign: "right", whiteSpace: "nowrap" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {err && <div className="leave-err">{err}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button className="mini-btn" onClick={() => shift(-1)}>‹</button>
        <b style={{ fontSize: 15 }}>{ym}</b>
        <button className="mini-btn" onClick={() => shift(1)}>›</button>
        <span style={{ flex: 1 }} />
        <span className="muted" style={{ fontSize: 12.5 }}>
          {t("pz_havi_total")}: <b style={{ color: "#1d5a33" }}>{fmt(grand)}</b> · {t("pz_expenses")}: <b style={{ color: "#b3431f" }}>{fmt(colTotals["exp"] ?? 0)}</b>
        </span>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-l">{t("pz_month_open")} — {ym}-01</div>
          <div className="kpi-v">{balStart != null ? fmt(balStart) : "…"}</div>
        </div>
        <div className="kpi-card" style={{ background: "#1d5a33", borderColor: "#1d5a33" }}>
          <div className="kpi-l" style={{ color: "#bfdcc9" }}>{t("pz_month_close")}</div>
          <div className="kpi-v" style={{ color: "#fff" }}>{balEnd != null ? fmt(balEnd) : "…"}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-l">{t("pz_month_change")}</div>
          <div className="kpi-v" style={{ color: (balEnd ?? 0) - (balStart ?? 0) >= 0 ? "#1d5a33" : "#b3431f" }}>
            {balStart != null && balEnd != null ? (balEnd - balStart >= 0 ? "+" : "") + fmt(balEnd - balStart) : "…"}
          </div>
        </div>
      </div>

      <div className="stat-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, minWidth: 760 }}>
            <thead>
              <tr style={{ background: "#f4f7f5" }}>
                <th style={{ ...th, textAlign: "left" }}>{t("pz_day")}</th>
                {bolts.map(u => (
                  <th key={u.id} colSpan={2} style={{ ...th, textAlign: "center", borderLeft: "1px solid #e2e8e3" }}>
                    {pick(u.name_hu, u.name_ro ?? u.name_hu)}
                  </th>
                ))}
                {lerakats.map(u => (
                  <th key={u.id} style={{ ...th, borderLeft: "1px solid #e2e8e3" }}>
                    {pick(u.name_hu, u.name_ro ?? u.name_hu)}
                  </th>
                ))}
                <th style={{ ...th, borderLeft: "1px solid #e2e8e3" }}>{t("pz_expenses")}</th>
                <th style={{ ...th, borderLeft: "1px solid #e2e8e3" }}>Σ</th>
              </tr>
              <tr style={{ background: "#f4f7f5" }}>
                <th style={th}></th>
                {bolts.map(u => (
                  <React.Fragment key={u.id}>
                    <th style={{ ...th, borderLeft: "1px solid #e2e8e3" }}>KP</th>
                    <th style={th}>{t("pz_card")}</th>
                  </React.Fragment>
                ))}
                {lerakats.map(u => <th key={u.id} style={{ ...th, borderLeft: "1px solid #e2e8e3" }}>KP</th>)}
                <th style={{ ...th, borderLeft: "1px solid #e2e8e3" }}></th>
                <th style={{ ...th, borderLeft: "1px solid #e2e8e3" }}></th>
              </tr>
              <tr style={{ background: "#eef6f0", fontWeight: 700 }}>
                <td style={{ ...td, textAlign: "left", borderTop: "none" }}>Σ</td>
                {bolts.map(u => (
                  <React.Fragment key={u.id}>
                    <td style={{ ...td, borderLeft: "1px solid #e2e8e3", borderTop: "none" }}>{fmt(colTotals[u.id + "c"] ?? 0)}</td>
                    <td style={{ ...td, borderTop: "none" }}>{fmt(colTotals[u.id + "k"] ?? 0)}</td>
                  </React.Fragment>
                ))}
                {lerakats.map(u => (
                  <td key={u.id} style={{ ...td, borderLeft: "1px solid #e2e8e3", borderTop: "none" }}>{fmt(colTotals[u.id + "c"] ?? 0)}</td>
                ))}
                <td style={{ ...td, borderLeft: "1px solid #e2e8e3", borderTop: "none", color: "#b3431f" }}>{fmt(colTotals["exp"] ?? 0)}</td>
                <td style={{ ...td, borderLeft: "1px solid #e2e8e3", borderTop: "none", color: "#1d5a33" }}>{fmt(grand - (colTotals["exp"] ?? 0))}</td>
              </tr>
            </thead>
            <tbody>
              {!days ? (
                <tr><td colSpan={99} style={{ ...td, textAlign: "center" }}>{t("loading")}</td></tr>
              ) : dayList.map(day => {
                const exp = expByDay.get(day) ?? 0;
                let rowSum = 0;
                for (const u of bolts) rowSum += (cashOf(u, day) ?? 0) + (cardOf(u, day) ?? 0);
                for (const u of lerakats) rowSum += cashOf(u, day) ?? 0;
                const empty = rowSum === 0 && exp === 0;
                return (
                  <tr key={day} style={empty ? { color: "#b6beb9" } : undefined}>
                    <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{Number(day.slice(8))}</td>
                    {bolts.map(u => {
                      const c = cashOf(u, day); const k = cardOf(u, day);
                      return (
                        <React.Fragment key={u.id}>
                          <td style={{ ...td, borderLeft: "1px solid #f0f3f1" }}>{c != null ? fmt(c) : ""}</td>
                          <td style={td}>{k != null ? fmt(k) : ""}</td>
                        </React.Fragment>
                      );
                    })}
                    {lerakats.map(u => {
                      const c = cashOf(u, day);
                      return <td key={u.id} style={{ ...td, borderLeft: "1px solid #f0f3f1" }}>{c != null ? fmt(c) : ""}</td>;
                    })}
                    <td style={{ ...td, borderLeft: "1px solid #f0f3f1" }}>
                      {exp ? (
                        <button onClick={() => setExpDay(day)}
                                style={{ border: "none", background: "none", cursor: "pointer",
                                         font: "inherit", color: "#b3431f", fontWeight: 600,
                                         textDecoration: "underline", textDecorationStyle: "dotted",
                                         padding: 0, fontVariantNumeric: "tabular-nums" }}>
                          {fmt(exp)}
                        </button>
                      ) : ""}
                    </td>
                    <td style={{ ...td, borderLeft: "1px solid #f0f3f1", fontWeight: 700 }}>
                      {empty ? "" : fmt(rowSum - exp)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="stat-card">
        <b style={{ fontSize: 14 }}>{t("pz_havi_exp_list")}</b>
        <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 8 }}>
          {monthExpenses.length === 0 && <div className="muted" style={{ fontSize: 13 }}>{t("stat_no_data")}</div>}
          {monthExpenses.map((e, i) => (
            <div key={i} style={{ display: "flex", gap: 10, fontSize: 13, alignItems: "baseline" }}>
              <b style={{ width: 44 }}>{e.day.slice(8)}.</b>
              <span style={{ flex: 1 }}>
                {e.description || (e.kind === "letet" ? t("pz_k_letet") : e.kind)}
                {e.client_name ? ` · ${e.client_name}` : ""}
              </span>
              <b style={{ fontVariantNumeric: "tabular-nums", color: e.kind === "koltseg" ? "#b3431f" : "#33528a" }}>
                {fmt(Number(e.amount))}
              </b>
            </div>
          ))}
        </div>
      </div>

      {expDay && (
        <div className="overlay" onClick={e => { if (e.target === e.currentTarget) setExpDay(null); }}>
          <div className="modal">
            <h3>{t("pz_expenses")} — {expDay}</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 4 }}>
              {expenses.filter(e => e.day === expDay).map((e, i) => {
                const uid = (e as unknown as { unit_id: string | null }).unit_id;
                const un = units.find(u => u.id === uid);
                return (
                  <div key={i} style={{ display: "flex", gap: 10, fontSize: 13.5, alignItems: "baseline",
                                        borderBottom: "1px solid #f0f3f1", paddingBottom: 6 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>
                        {e.description || (e.kind === "letet" ? t("pz_k_letet") : e.kind === "korrekcio" ? t("pz_k_korrekcio") : "—")}
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {[un ? pick(un.name_hu, un.name_ro ?? un.name_hu) : t("pz_quick_title"),
                          e.client_name].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <b style={{ fontVariantNumeric: "tabular-nums",
                                color: e.kind === "koltseg" ? "#b3431f" : "#33528a" }}>
                      {fmt(Number(e.amount))}
                    </b>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontWeight: 800 }}>
              <span>{t("pz_expenses")}</span>
              <span style={{ fontVariantNumeric: "tabular-nums", color: "#b3431f" }}>
                {fmt(expByDay.get(expDay) ?? 0)}
              </span>
            </div>
            <div className="btns">
              <button className="btn-cancel" onClick={() => setExpDay(null)}>{t("close")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
