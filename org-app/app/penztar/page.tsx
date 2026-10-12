"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase, withAuthRetry } from "@/lib/supabaseClient";
import { useI18n } from "@/lib/i18n";
import {
  CashUnit, CashCategory, CashVehicle, CashQuicklabel, DayPayload,
  cashContext, cashSaveDay, cashCloseDay, cashMeta, DENOMS,
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
      await reload();
    })();
  }, [router, reload]);

  const unit = ctx?.units.find(u => u.id === unitId) ?? null;

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
      ) : ctx.units.length === 0 ? (
        <div className="center-msg">{t("pz_no_unit")}</div>
      ) : (
        <div className="pz-wrap">
          {ctx.units.length > 1 && (
            <div className="board-chips" style={{ marginBottom: 12 }}>
              {ctx.units.map(u => (
                <button key={u.id} className={"bchip" + (u.id === unitId ? " on" : "")}
                        onClick={() => setUnitId(u.id)}>{pick(u.name_hu, u.name_ro ?? u.name_hu)}</button>
              ))}
            </div>
          )}
          {unit && (
            <ClosingForm key={unit.id + (unit.today_day?.status ?? "")} unit={unit} meta={meta}
                         today={ctx.today} onChanged={reload} />
          )}
          {unit && unit.kind === "lerakat" && unit.history.length > 0 && (
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
                  </div>
                ))}
              </div>
              <div className="fhint" style={{ marginTop: 10 }}>{t("pz_history_note")}</div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function ClosingForm({ unit, meta, today, onChanged }: {
  unit: CashUnit;
  meta: { categories: CashCategory[]; vehicles: CashVehicle[]; quicklabels: CashQuicklabel[] };
  today: string;
  onChanged: () => Promise<void>;
}) {
  const { t, pick } = useI18n();
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

  const effNexus = unit.kind === "lerakat"
    ? (unit.nexus_today != null ? unit.nexus_today : (nexusRev ? num(nexusRev) : null))
    : null;
  const cashDiff = useMemo(() => {
    if (unit.kind === "bolt") {
      if (!zCash) return null;
      return Math.round((counted - (num(zCash) - expTotal + num(floatM) - num(floatE))) * 100) / 100;
    }
    if (effNexus == null) return null;
    return Math.round((counted + expTotal - effNexus) * 100) / 100;
  }, [unit.kind, counted, expTotal, zCash, floatM, floatE, effNexus]);
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
    };
  }

  async function save(closeToo: boolean) {
    setBusy(true); setErr(""); setMsg("");
    try {
      await withAuthRetry(() => cashSaveDay(unit.id, payload()));
      if (closeToo) {
        await withAuthRetry(() => cashCloseDay(unit.id));
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

      {adding && (
        <ExpenseModal meta={meta} onClose={() => setAdding(false)}
                      onAdd={e => { setExpenses(xs => [...xs, e]); setAdding(false); }} />
      )}
    </div>
  );
}

function ExpenseModal({ meta, onClose, onAdd }: {
  meta: { categories: CashCategory[]; vehicles: CashVehicle[]; quicklabels: CashQuicklabel[] };
  onClose: () => void;
  onAdd: (e: ExpenseDraft) => void;
}) {
  const { t, pick } = useI18n();
  const cats = meta.categories.filter(c => c.staff_can_use && c.approved);
  const [cat, setCat] = useState(cats[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [client, setClient] = useState("");
  const [desc, setDesc] = useState("");
  const [err, setErr] = useState("");
  const c = cats.find(x => x.id === cat);
  const labels = meta.quicklabels.filter(q => q.category_id === cat);

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
            <input type="text" value={client} onChange={e => setClient(e.target.value)} />
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
