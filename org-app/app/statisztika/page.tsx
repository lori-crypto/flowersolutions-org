"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase, withAuthRetry } from "@/lib/supabaseClient";
import { useI18n } from "@/lib/i18n";
import { StatRow, CompareRow, ProgressRow, statSales, statCompare, statOptions, statProgress, getCycles } from "@/lib/stats";

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtInt = (n: number) => Math.round(n).toLocaleString("hu-HU");
const fmtMoney = (n: number) =>
  Math.round(n).toLocaleString("hu-HU");
const fmtShort = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1_000_000) return (n / 1_000_000).toLocaleString("hu-HU", { maximumFractionDigits: 2 }) + "M";
  if (a >= 10_000) return Math.round(n / 1000).toLocaleString("hu-HU") + "e";
  return Math.round(n).toLocaleString("hu-HU");
};
const YEAR_PALETTE = ["#2f7a4f", "#3b82f6", "#9ca3af", "#f59e0b", "#8b5cf6"];
const HONAPOK = ["jan", "febr", "márc", "ápr", "máj", "jún", "júl", "aug", "szept", "okt", "nov", "dec"];
const PIE_COLORS = ["#2f7a4f", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6",
  "#ec4899", "#84cc16", "#6366f1", "#f97316", "#06b6d4", "#a855f7"];

const DIMS = [
  { k: "day", l: "Nap" }, { k: "month", l: "Hónap" }, { k: "year", l: "Év" },
  { k: "client", l: "Ügyfél" },
  { k: "grupa", l: "Termékcsoport" }, { k: "clasa", l: "Osztály (clasa)" },
  { k: "subclasa", l: "Alosztály (subclasa)" }, { k: "product", l: "Termék" },
];
const MEASURES = [
  { k: "net", l: "Nettó (RON)" }, { k: "gross", l: "Bruttó (RON)" },
  { k: "qty", l: "Mennyiség (db)" }, { k: "invoices", l: "Számlaszám" },
  { k: "margin", l: "Árrés (RON)*" },
];
const TYPES = [{ k: "line", l: "📈 Vonal" }, { k: "bar", l: "📊 Oszlop" }, { k: "pie", l: "🥧 Kör" }];

export default function StatisztikaPage() {
  const { t, lang, setLang } = useI18n();
  const router = useRouter();
  const [isHr, setIsHr] = useState<boolean | null>(null);
  const [tab, setTab] = useState<"haladas" | "elado" | "compare">("haladas");

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      const { data: caps } = await supabase.from("person_capabilities").select("capability");
      const s = new Set((caps ?? []).map(c => c.capability));
      setIsHr(s.has("hr") || s.has("admin"));
    })();
  }, [router]);

  if (isHr === null) return <div className="center-msg">{t("loading")}</div>;

  return (
    <>
      <header className="appbar">
        <span className="t">{t("stat_title")}</span>
        <nav className="topnav">
          <Link href="/tabla">{t("nav_tabla")}</Link>
          <Link href="/szabadsag">{t("nav_leave")}</Link>
          <Link href="/kollegak">{t("nav_people")}</Link>
          <Link href="/posztleirasok">{t("nav_desc")}</Link>
          <Link href="/statisztika" className="active">{t("nav_stat")}</Link>
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

      {!isHr ? (
        <div className="center-msg">{t("stat_no_access")}</div>
      ) : (
        <>
          <div className="leave-toolbar">
            <div className="board-chips">
              <button className={"bchip" + (tab === "haladas" ? " on" : "")}
                      onClick={() => setTab("haladas")}>{t("stat_tab_progress")}</button>
              <button className={"bchip" + (tab === "elado" ? " on" : "")}
                      onClick={() => setTab("elado")}>{t("stat_tab_sales")}</button>
              <button className={"bchip" + (tab === "compare" ? " on" : "")}
                      onClick={() => setTab("compare")}>{t("stat_tab_compare")}</button>
            </div>
          </div>
          {tab === "haladas" ? <ProgressTab /> : tab === "elado" ? <SalesTab /> : <CompareTab />}
        </>
      )}
    </>
  );
}

/* ══════════ HALADÁS (ösztönző kártyák) ══════════ */
function ProgressTab() {
  const { t } = useI18n();
  const [rows, setRows] = useState<ProgressRow[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try { setRows(await withAuthRetry(() => statProgress())); }
      catch (e) { setErr((e as Error).message); }
    })();
  }, []);

  if (err) return <div className="leave-err" style={{ margin: 14 }}>{err}</div>;
  if (!rows) return <div className="center-msg">{t("loading")}</div>;

  const fd = (s: string) =>
    new Date(s + "T12:00:00").toLocaleDateString("hu-HU", { month: "short", day: "numeric" });
  const addDays = (s: string, n: number) => {
    const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const HK: Record<string, { icon: string; title: (r: ProgressRow) => string }> = {
    year: { icon: "🗓", title: r => r.cur_from.slice(0, 4) + ". " + t("prog_year") },
    month: {
      icon: "📅",
      title: r => new Date(r.cur_from + "T12:00:00").toLocaleDateString("hu-HU", { year: "numeric", month: "long" }),
    },
    week: {
      icon: "🚚",
      title: r => t("prog_week") + " (" + fd(r.cur_from) + " – " + fd(addDays(r.prev_full_to, 364)) + ")",
    },
  };
  const order: ProgressRow["k"][] = ["week", "month", "year"];
  const sorted = order.map(k => rows.find(r => r.k === k)).filter((r): r is ProgressRow => !!r);

  return (
    <div className="stat-wrap">
      <div className="prog-grid">
        {sorted.map(r => {
          const pctSame = r.prev_same > 0 ? Math.round(((r.cur - r.prev_same) / r.prev_same) * 100) : null;
          const pctFull = r.prev_full > 0 ? Math.round((r.cur / r.prev_full) * 100) : null;
          const beat = pctFull != null && pctFull >= 100;
          return (
            <div className="prog-card" key={r.k}>
              <div className="prog-title">{HK[r.k].icon} {HK[r.k].title(r)}</div>
              <div className="prog-big">{fmtMoney(r.cur)} <span>RON</span></div>

              <div className="prog-vs">
                {pctSame != null && (
                  <span className={"prog-pct" + (pctSame >= 0 ? " pos" : " neg")}>
                    {pctSame >= 0 ? "▲ +" : "▼ "}{pctSame}%
                  </span>
                )}
                <span className="muted">
                  {t("prog_vs_same")} ({fd(r.prev_from)} – {fd(r.prev_same_to)}): <b>{fmtMoney(r.prev_same)}</b>
                </span>
              </div>

              {pctFull != null && (() => {
                const scale = Math.max(r.cur, r.prev_full, 1);
                const fillPct = (r.cur / scale) * 100;
                const markerPct = (r.prev_full / scale) * 100;
                const greenPct = Math.min(fillPct, markerPct);
                const goldPct = Math.max(0, fillPct - markerPct);
                return (
                  <>
                    <div className="prog-bar">
                      <div className="prog-fill" style={{ width: greenPct + "%" }} />
                      {goldPct > 0 && (
                        <div className="prog-fill beat"
                             style={{ left: markerPct + "%", width: goldPct + "%" }} />
                      )}
                      <div className="prog-marker" style={{ left: markerPct + "%" }}
                           title={`${t("prog_of_full")}: ${fmtMoney(r.prev_full)}`} />
                    </div>
                    <div className="prog-scale">
                      <span>0</span>
                      <span style={{ position: "absolute", left: markerPct + "%", transform: "translateX(-50%)" }}>
                        ⯆ {fmtShort(r.prev_full)}
                      </span>
                    </div>
                    <div className="prog-foot">
                      {beat
                        ? <b className="prog-beat">🎉 {t("prog_beat")} — túlhaladás: +{fmtMoney(r.cur - r.prev_full)} ({pctFull - 100}%)</b>
                        : <>
                            <b>{pctFull}%</b> {t("prog_of_full")} ({fmtMoney(r.prev_full)}) ·{" "}
                            {t("prog_left")}: <b>{fmtMoney(r.prev_full - r.cur)}</b>
                          </>}
                    </div>
                  </>
                );
              })()}
            </div>
          );
        })}
      </div>
      <div className="fhint">{t("prog_hint")}</div>
    </div>
  );
}

/* ══════════ ELADÁSOK (BI) ══════════ */
function SalesTab() {
  const { t } = useI18n();
  const now = new Date();
  const [from, setFrom] = useState(`${now.getFullYear()}-01-01`);
  const [to, setTo] = useState(iso(now));
  const [client, setClient] = useState("");
  const [grupa, setGrupa] = useState("");
  const [q, setQ] = useState("");
  const [dim, setDim] = useState("month");
  const [measure, setMeasure] = useState("net");
  const [ctype, setCtype] = useState("bar");

  const [rows, setRows] = useState<StatRow[]>([]);
  const [total, setTotal] = useState<StatRow | null>(null);
  const [clientOpts, setClientOpts] = useState<string[]>([]);
  const [grupaOpts, setGrupaOpts] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const multiYear = Number(to.slice(0, 4)) > Number(from.slice(0, 4));
  const effDim = dim === "client" && multiYear ? "client_year" : dim;

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      // szándékosan egymás után (nem párhuzamosan): a kis DB-gépen így stabilabb
      const r = await withAuthRetry(() => statSales({ from, to, dim: effDim, client, grupa, q, inv: measure === "invoices" }));
      setRows(r);
      const tot = await withAuthRetry(() => statSales({ from, to, dim: "total", client, grupa, q, inv: true }));
      setTotal(tot[0] ?? null);
    } catch (e) { setErr((e as Error).message); }
    setLoading(false);
  }, [from, to, effDim, client, grupa, q, measure]);

  useEffect(() => { load(); }, [load]);

  // szűrő-opciók (könnyű lekérdezés, egyszer)
  useEffect(() => {
    (async () => {
      try {
        const o = await withAuthRetry(() => statOptions());
        setClientOpts(o.clients);
        setGrupaOpts(o.grupak);
      } catch { /* opciók nélkül is működik */ }
    })();
  }, []);

  const valOf = useCallback((r: StatRow): number =>
    measure === "net" ? r.net : measure === "gross" ? r.gross :
    measure === "qty" ? r.qty : measure === "invoices" ? r.invoices :
    r.cost != null && r.cost > 0 ? r.net - r.cost : 0, [measure]);

  const chartData = useMemo(() => {
    let arr = rows.map(r => ({ label: r.label, value: valOf(r) }));
    if (measure === "margin") arr = arr.filter(x => x.value !== 0);
    if (dim === "day" || dim === "month" || dim === "year") arr.sort((a, b) => a.label.localeCompare(b.label));
    else { arr.sort((a, b) => b.value - a.value); arr = arr.slice(0, 30); }
    return arr;
  }, [rows, dim, measure, valOf]);

  const isMoney = measure !== "qty" && measure !== "invoices";
  const fmtVal = (v: number) => (isMoney ? fmtMoney(v) : fmtInt(v));
  const dimLabel = DIMS.find(d => d.k === dim)?.l ?? "";
  const measureLabel = MEASURES.find(m => m.k === measure)?.l ?? "";

  // év/év sorozatok (hónap dimenziónál): év → 12 havi érték
  const yoySeries = useMemo(() => {
    if (dim !== "month") return [];
    const byYear = new Map<number, (number | null)[]>();
    for (const r of rows) {
      const y = Number(r.label.slice(0, 4)), m = Number(r.label.slice(5, 7));
      if (!y || !m) continue;
      let arr = byYear.get(y);
      if (!arr) { arr = Array(12).fill(null); byYear.set(y, arr); }
      arr[m - 1] = valOf(r);
    }
    return Array.from(byYear.entries()).sort((a, b) => a[0] - b[0])
      .map(([year, vals], i, all) => ({
        name: String(year), vals,
        color: YEAR_PALETTE[(all.length - 1 - i) % YEAR_PALETTE.length],
      }));
  }, [rows, dim, valOf]);
  const yoy = dim === "month" && yoySeries.length > 1;

  // ügyfél × év pivot (több éves időszaknál, Ügyfél dimenzióval)
  const clientPivot = useMemo(() => {
    if (effDim !== "client_year") return null;
    const years = Array.from(new Set(rows.map(r => r.label.split("¦")[0]))).sort();
    const byClient = new Map<string, (number | null)[]>();
    for (const r of rows) {
      const [y, ...rest] = r.label.split("¦");
      const cli = rest.join("¦") || "—";
      let arr = byClient.get(cli);
      if (!arr) { arr = Array(years.length).fill(null); byClient.set(cli, arr); }
      arr[years.indexOf(y)] = valOf(r);
    }
    const list = Array.from(byClient.entries())
      .map(([cli, vals]) => ({ cli, vals, last: vals[vals.length - 1] ?? 0 }))
      .sort((a, b) => (b.last || 0) - (a.last || 0));
    const series = years.map((y, yi) => ({
      name: y,
      color: YEAR_PALETTE[(years.length - 1 - yi) % YEAR_PALETTE.length],
      vals: list.slice(0, 12).map(c => c.vals[yi]),
    }));
    return { years, list: list.slice(0, 50), series,
             cats: list.slice(0, 12).map(c => c.cli) };
  }, [rows, effDim, valOf]);

  return (
    <div className="stat-wrap">
      {/* szűrők */}
      <div className="stat-card stat-filters">
        <div><label>Év</label>
          <div style={{ display: "flex", gap: 4 }}>
            {Array.from({ length: now.getFullYear() - 2023 }, (_, i) => 2024 + i).map(y => {
              const yf = `${y}-01-01`;
              const yt = y === now.getFullYear() ? iso(now) : `${y}-12-31`;
              const on = from === yf && to === yt;
              return (
                <button key={y} className={"bchip" + (on ? " on" : "")}
                        style={{ padding: "5px 10px" }}
                        onClick={() => { setFrom(yf); setTo(yt); }}>{y}</button>
              );
            })}
            <button className={"bchip" + (from === "2024-01-01" && to === iso(now) ? " on" : "")}
                    style={{ padding: "5px 10px" }}
                    onClick={() => { setFrom("2024-01-01"); setTo(iso(now)); }}>Mind</button>
          </div>
        </div>
        <div><label>{t("f_from")}</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div><label>{t("f_to")}</label>
          <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} /></div>
        <div style={{ position: "relative" }}><label>{t("stat_client")}</label>
          <input type="text" list="stat-client-list" value={client}
                 placeholder={"🔍 " + t("stat_all")}
                 onChange={e => setClient(e.target.value)}
                 style={{ paddingRight: 26 }} />
          {client && (
            <button onClick={() => setClient("")}
                    style={{ position: "absolute", right: 6, bottom: 7, border: "none",
                             background: "none", cursor: "pointer", color: "var(--muted)" }}>×</button>
          )}
          <datalist id="stat-client-list">
            {clientOpts.map(c => <option key={c} value={c} />)}
          </datalist></div>
        <div><label>{t("stat_grupa")}</label>
          <select value={grupa} onChange={e => setGrupa(e.target.value)}>
            <option value="">{t("stat_all")}</option>
            {grupaOpts.map(g => <option key={g} value={g}>{g}</option>)}
          </select></div>
        <div style={{ flex: 1, minWidth: 140 }}><label>{t("stat_product")}</label>
          <input type="text" value={q} placeholder="🔍" onChange={e => setQ(e.target.value)} /></div>
        <button className="mini-btn" onClick={() => {
          setClient(""); setGrupa(""); setQ("");
        }}>{t("stat_clear")}</button>
        <span className="muted" style={{ marginLeft: "auto", fontSize: 12 }}>
          {loading ? t("loading") : `${rows.length} ${t("stat_groups")}`}
        </span>
      </div>

      {err && <div className="leave-err">{err}</div>}

      {/* KPI-k */}
      {total && (
        <div className="kpi-grid">
          {[
            { l: t("stat_kpi_net"), v: fmtMoney(total.net), c: "#2f7a4f" },
            { l: t("stat_kpi_gross"), v: fmtMoney(total.gross), c: "#3b82f6" },
            { l: t("stat_kpi_qty"), v: fmtInt(total.qty), c: "#f59e0b" },
            { l: t("stat_kpi_inv"), v: fmtInt(total.invoices), c: "#8b5cf6" },
          ].map(k => (
            <div className="kpi-card" key={k.l}>
              <div className="kpi-l">{k.l}</div>
              <div className="kpi-v" style={{ color: k.c }}>{k.v}</div>
            </div>
          ))}
        </div>
      )}

      {/* diagram-építő */}
      <div className="stat-card">
        <div className="stat-filters" style={{ marginBottom: 10 }}>
          <div><label>{t("stat_dim")}</label>
            <select value={dim} onChange={e => setDim(e.target.value)}>
              {DIMS.map(d => <option key={d.k} value={d.k}>{d.l}</option>)}
            </select></div>
          <div><label>{t("stat_measure")}</label>
            <select value={measure} onChange={e => setMeasure(e.target.value)}>
              {MEASURES.map(m => <option key={m.k} value={m.k}>{m.l}</option>)}
            </select></div>
          <div><label>{t("stat_type")}</label>
            <select value={ctype} onChange={e => setCtype(e.target.value)}>
              {TYPES.map(x => <option key={x.k} value={x.k}>{x.l}</option>)}
            </select></div>
          <span className="muted" style={{ marginLeft: "auto", fontSize: 12, alignSelf: "center" }}>
            {measureLabel} · {dimLabel}{dim !== "day" && dim !== "month" ? " (top 30)" : ""}
          </span>
        </div>
        {measure === "margin" && (
          <div className="fhint" style={{ marginBottom: 8 }}>{t("stat_margin_note")}</div>
        )}
        {yoy ? <GroupedBarChart cats={HONAPOK} series={yoySeries} />
         : clientPivot ? <GroupedBarChart cats={clientPivot.cats} series={clientPivot.series} catAngle={-32} />
         : dim === "year" && ctype !== "pie" ? <YearChart data={chartData} fmtVal={fmtVal} />
         : <Chart data={chartData} type={ctype} fmtVal={fmtVal} />}
      </div>

      {/* adattábla */}
      <div className="stat-card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="stat-thead">
          <span>{dimLabel} / {measureLabel}</span>
          <button className="mini-btn" onClick={() => printTable(chartData, dimLabel, measureLabel, fmtVal)}>
            🖨 {t("stat_print")}
          </button>
        </div>
        <div style={{ maxHeight: 380, overflow: "auto" }}>
          {yoy ? (
            <table className="stat-table">
              <thead><tr>
                <th>Hónap</th>
                {yoySeries.map(s => (
                  <th key={s.name} style={{ textAlign: "right", color: s.color }}>{s.name}</th>
                ))}
                <th style={{ textAlign: "right" }}>Δ% ({yoySeries[yoySeries.length - 2]?.name}→{yoySeries[yoySeries.length - 1]?.name})</th>
              </tr></thead>
              <tbody>
                {HONAPOK.map((hn, mi) => {
                  const prev = yoySeries[yoySeries.length - 2]?.vals[mi];
                  const cur = yoySeries[yoySeries.length - 1]?.vals[mi];
                  const pct = prev && cur != null ? Math.round(((cur - prev) / prev) * 100) : null;
                  return (
                    <tr key={hn}>
                      <td style={{ textTransform: "capitalize" }}>{hn}</td>
                      {yoySeries.map(s => (
                        <td key={s.name} style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                          {s.vals[mi] != null ? fmtVal(s.vals[mi]!) : "—"}
                        </td>
                      ))}
                      <td style={{ textAlign: "right" }}>
                        {pct != null
                          ? <span className={"pct-tag" + (pct >= 0 ? " pos" : " neg")}>{pct >= 0 ? "+" : ""}{pct}%</span>
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : clientPivot ? (
            <table className="stat-table">
              <thead><tr>
                <th>{t("stat_client")}</th>
                {clientPivot.years.map((y, yi) => (
                  <th key={y} style={{ textAlign: "right", color: clientPivot.series[yi]?.color }}>{y}</th>
                ))}
                <th style={{ textAlign: "right" }}>
                  Δ% ({clientPivot.years[clientPivot.years.length - 2]}→{clientPivot.years[clientPivot.years.length - 1]})
                </th>
              </tr></thead>
              <tbody>
                {clientPivot.list.map(c => {
                  const prev = c.vals[c.vals.length - 2];
                  const cur = c.vals[c.vals.length - 1];
                  const pct = prev && cur != null ? Math.round(((cur - prev) / prev) * 100) : null;
                  return (
                    <tr key={c.cli}>
                      <td style={{ maxWidth: 340, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.cli}</td>
                      {c.vals.map((v, vi) => (
                        <td key={vi} style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                          {v != null ? fmtVal(v) : "—"}
                        </td>
                      ))}
                      <td style={{ textAlign: "right" }}>
                        {pct != null
                          ? <span className={"pct-tag" + (pct >= 0 ? " pos" : " neg")}>{pct >= 0 ? "+" : ""}{pct}%</span>
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <table className="stat-table">
              <thead><tr><th>{dimLabel}</th><th style={{ textAlign: "right" }}>{measureLabel}</th></tr></thead>
              <tbody>
                {chartData.map(r => (
                  <tr key={r.label}>
                    <td>{r.label}</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtVal(r.value)}</td>
                  </tr>
                ))}
                {chartData.length === 0 && (
                  <tr><td colSpan={2} className="muted" style={{ textAlign: "center", padding: 20 }}>
                    {loading ? t("loading") : t("stat_no_data")}</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════ ELŐRENDELÉS vs SZÁMLÁZOTT ══════════ */
function CompareTab() {
  const { t } = useI18n();
  const now = new Date();
  const [from, setFrom] = useState("2026-07-22");
  const [to, setTo] = useState(iso(now));
  const [rows, setRows] = useState<CompareRow[]>([]);
  const [cycles, setCycles] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true); setErr("");
      try {
        const [r, c] = await Promise.all([
          withAuthRetry(() => statCompare(from, to)),
          withAuthRetry(() => getCycles()),
        ]);
        setRows(r); setCycles(c);
      } catch (e) { setErr((e as Error).message); }
      setLoading(false);
    })();
  }, [from, to]);

  const weeks = useMemo(() => {
    const m = new Map<string, { clients: CompareRow[]; order: number; net: number; gross: number }>();
    for (const r of rows) {
      let w = m.get(r.week);
      if (!w) { w = { clients: [], order: 0, net: 0, gross: 0 }; m.set(r.week, w); }
      w.clients.push(r);
      w.order += r.order_ron; w.net += r.nexus_net; w.gross += r.nexus_gross;
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  const weekEnd = (start: string): string => {
    const i = cycles.indexOf(start);
    if (i >= 0 && i < cycles.length - 1) {
      const d = new Date(cycles[i + 1] + "T12:00:00");
      d.setDate(d.getDate() - 1);
      return iso(d);
    }
    return to;
  };
  const diffPct = (order: number, net: number) =>
    order > 0 ? Math.round(((net - order) / order) * 100) : null;

  return (
    <div className="stat-wrap">
      <div className="stat-card stat-filters">
        <div><label>{t("f_from")}</label>
          <input type="date" value={from} min="2026-07-22" onChange={e => setFrom(e.target.value)} /></div>
        <div><label>{t("f_to")}</label>
          <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} /></div>
        <span className="muted" style={{ marginLeft: "auto", fontSize: 12, alignSelf: "center" }}>
          {loading ? t("loading") : `${weeks.length} ${t("stat_weeks")}`}
        </span>
      </div>
      <div className="fhint">{t("stat_compare_hint")}</div>
      {err && <div className="leave-err">{err}</div>}

      {weeks.map(([wk, w]) => {
        const pct = diffPct(w.order, w.net);
        return (
          <div className="stat-card" key={wk} style={{ padding: 0, overflow: "hidden" }}>
            <button className="week-head" onClick={() => setOpen(open === wk ? null : wk)}>
              <b>{wk} → {weekEnd(wk)}</b>
              <span className="wh-cell">{t("stat_ordered")}: <b>{fmtMoney(w.order)}</b></span>
              <span className="wh-cell">{t("stat_invoiced_net")}: <b>{fmtMoney(w.net)}</b></span>
              <span className="wh-cell">{t("stat_invoiced_gross")}: <b>{fmtMoney(w.gross)}</b></span>
              {pct != null && (
                <span className={"pct-tag" + (pct >= 0 ? " pos" : " neg")}>
                  {pct >= 0 ? "+" : ""}{pct}%
                </span>
              )}
              <span className="muted">{open === wk ? "▴" : "▾"}</span>
            </button>
            {open === wk && (
              <table className="stat-table">
                <thead><tr>
                  <th>{t("stat_client")}</th>
                  <th style={{ textAlign: "right" }}>{t("stat_ordered")}</th>
                  <th style={{ textAlign: "right" }}>{t("stat_invoiced_net")}</th>
                  <th style={{ textAlign: "right" }}>{t("stat_invoiced_gross")}</th>
                  <th style={{ textAlign: "right" }}>Δ%</th>
                </tr></thead>
                <tbody>
                  {w.clients.sort((a, b) => b.nexus_net - a.nexus_net).map(c => {
                    const p = diffPct(c.order_ron, c.nexus_net);
                    return (
                      <tr key={c.client}>
                        <td>{c.client}</td>
                        <td style={{ textAlign: "right" }}>{c.order_ron ? fmtMoney(c.order_ron) : "—"}</td>
                        <td style={{ textAlign: "right", fontWeight: 600 }}>{c.nexus_net ? fmtMoney(c.nexus_net) : "—"}</td>
                        <td style={{ textAlign: "right" }}>{c.nexus_gross ? fmtMoney(c.nexus_gross) : "—"}</td>
                        <td style={{ textAlign: "right" }}>
                          {p != null ? <span className={"pct-tag" + (p >= 0 ? " pos" : " neg")}>{p >= 0 ? "+" : ""}{p}%</span> : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
      {weeks.length === 0 && !loading && <div className="center-msg">{t("stat_no_data")}</div>}
    </div>
  );
}

/* ══════════ Éves összesítő: szoros oszlopok, nagy számokkal ══════════ */
function YearChart({ data, fmtVal }: {
  data: { label: string; value: number }[]; fmtVal: (v: number) => string;
}) {
  const n = Math.max(data.length, 1);
  const bw = 110, gap = 46, padL = 24, padR = 24, padT = 56, padB = 44;
  const W = padL + padR + n * bw + (n - 1) * gap;
  const H = 360, ih = H - padT - padB;
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`}
         style={{ display: "block", margin: "0 auto", width: "100%", maxWidth: W * 1.35 }}>
      {data.map((d, i) => {
        const x = padL + i * (bw + gap);
        const h = (Math.max(0, d.value) / max) * ih;
        const y = padT + ih - h;
        return (
          <g key={d.label}>
            <rect x={x} y={y} width={bw} height={h} rx={6} fill="#2f7a4f">
              <title>{d.label}: {fmtVal(d.value)}</title>
            </rect>
            <text x={x + bw / 2} y={y - 14} fontSize={19} fontWeight={800}
                  textAnchor="middle" fill="#1d5a33">{fmtVal(d.value)}</text>
            <text x={x + bw / 2} y={H - padB + 26} fontSize={16} fontWeight={700}
                  textAnchor="middle" fill="#3a4a57">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

/* ══════════ Csoportosított oszlopdiagram (év/év és ügyfél/év) ══════════ */
function GroupedBarChart({ cats, series, catAngle = 0 }: {
  cats: string[];
  series: { name: string; vals: (number | null)[]; color: string }[];
  catAngle?: number;
}) {
  const W = 1300, H = catAngle ? 470 : 430, padL = 70, padR = 16, padT = 66,
        padB = catAngle ? 86 : 40;
  const iw = W - padL - padR, ih = H - padT - padB;
  const allVals = series.flatMap(s => s.vals.filter((v): v is number => v != null));
  const max = Math.max(...allVals, 1);
  const yOf = (v: number) => padT + ih - (v / max) * ih;
  const ticks = 4;
  const nSlots = Math.max(cats.length, 1);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxHeight: H + 40 }}>
      {/* jelmagyarázat */}
      {series.map((s, i) => (
        <g key={s.name} transform={`translate(${padL + i * 90}, 12)`}>
          <line x1={0} y1={0} x2={22} y2={0} stroke={s.color} strokeWidth={2.5} />
          <text x={28} y={4} fontSize={13} fontWeight={700} fill={s.color}>{s.name}</text>
        </g>
      ))}
      {/* rács */}
      {Array.from({ length: ticks + 1 }).map((_, i) => {
        const v = (max / ticks) * i;
        const y = padT + ih - (i / ticks) * ih;
        return (
          <g key={i}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#eef2f5" />
            <text x={padL - 8} y={y + 4} fontSize={11} textAnchor="end" fill="#9ca3af">{fmtShort(v)}</text>
          </g>
        );
      })}
      {/* csoportosított oszlopok */}
      {cats.map((cat, m) => {
        const slotW = iw / nSlots;
        const slotX = padL + m * slotW;
        const gap = 2;
        const bw = Math.min(26, (slotW * 0.78 - gap * (series.length - 1)) / series.length);
        const groupW = bw * series.length + gap * (series.length - 1);
        const startX = slotX + (slotW - groupW) / 2;
        const catLabel = cat.length > 22 ? cat.slice(0, 21) + "…" : cat;
        return (
          <g key={cat}>
            {series.map((s, si) => {
              const v = s.vals[m];
              if (v == null) return null;
              const x = startX + si * (bw + gap);
              const y = yOf(v);
              return (
                <g key={s.name}>
                  <rect x={x} y={y} width={bw} height={padT + ih - y} rx={2} fill={s.color}>
                    <title>{s.name} · {cat}: {fmtMoney(v)}</title>
                  </rect>
                  <text x={x + bw / 2 + 3} y={y - 5} fontSize={8.5} fontWeight={700}
                        fill={s.color} textAnchor="start"
                        transform={`rotate(-90 ${x + bw / 2 + 3} ${y - 5})`}>
                    {fmtShort(v)}
                  </text>
                </g>
              );
            })}
            {catAngle ? (
              <text x={slotX + slotW / 2} y={H - padB + 16} fontSize={10.5} fill="#647686"
                    textAnchor="end"
                    transform={`rotate(${catAngle} ${slotX + slotW / 2} ${H - padB + 16})`}>
                {catLabel}
              </text>
            ) : (
              <text x={slotX + slotW / 2} y={H - padB + 18} fontSize={11}
                    textAnchor="middle" fill="#647686">{catLabel}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* ══════════ SVG diagram (a webshop BI-ból portolva) ══════════ */
function Chart({ data, type, fmtVal }: {
  data: { label: string; value: number }[]; type: string; fmtVal: (v: number) => string;
}) {
  if (!data.length) return <div style={{ height: 260, display: "grid", placeItems: "center", color: "var(--muted)", fontSize: 14 }}>—</div>;
  const W = 1300, H = 410, padL = 70, padR = 16, padT = 48, padB = 74;
  const iw = W - padL - padR, ih = H - padT - padB;

  if (type === "pie") {
    const total = data.reduce((s, d) => s + Math.max(0, d.value), 0) || 1;
    const top = data.slice(0, 12);
    let acc = 0; const cx = 170, cy = H / 2, r = 130;
    const slices = top.map((d, i) => {
      const v = Math.max(0, d.value);
      const a0 = (acc / total) * Math.PI * 2 - Math.PI / 2; acc += v;
      const a1 = (acc / total) * Math.PI * 2 - Math.PI / 2;
      const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      const large = a1 - a0 > Math.PI ? 1 : 0;
      return { path: `M${cx},${cy} L${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 ${large} 1 ${x1.toFixed(1)},${y1.toFixed(1)} Z`, color: PIE_COLORS[i % PIE_COLORS.length], d };
    });
    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxHeight: 420 }}>
        {slices.map((s, i) => (
          <path key={i} d={s.path} fill={s.color} stroke="#fff" strokeWidth={1.5}>
            <title>{s.d.label}: {fmtVal(s.d.value)}</title>
          </path>
        ))}
        {top.map((d, i) => (
          <g key={i} transform={`translate(${W - 400}, ${padT + i * 24})`}>
            <rect width={12} height={12} rx={2} fill={PIE_COLORS[i % PIE_COLORS.length]} />
            <text x={18} y={11} fontSize={12} fill="#3a4a57">
              {d.label.length > 36 ? d.label.slice(0, 35) + "…" : d.label} — {fmtVal(d.value)}
            </text>
          </g>
        ))}
      </svg>
    );
  }

  const max = Math.max(...data.map(d => d.value), 1);
  const min = Math.min(...data.map(d => d.value), 0);
  const range = max - min || 1;
  const n = data.length;
  const xOf = (i: number) => padL + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const yOf = (v: number) => padT + ih - ((v - min) / range) * ih;
  const ticks = 4;
  const showEvery = Math.ceil(n / 16);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxHeight: 420 }}>
      {Array.from({ length: ticks + 1 }).map((_, i) => {
        const v = min + (range / ticks) * i;
        const y = padT + ih - (i / ticks) * ih;
        return (
          <g key={i}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#eef2f5" />
            <text x={padL - 8} y={y + 4} fontSize={11} textAnchor="end" fill="#9ca3af">{fmtVal(v)}</text>
          </g>
        );
      })}
      {type === "bar" && data.map((d, i) => {
        const bw = Math.max(3, (iw / n) * 0.62);
        const x = xOf(i) - bw / 2;
        const y0 = yOf(0), y1 = yOf(d.value);
        return (
          <g key={i}>
            <rect x={x} y={Math.min(y0, y1)} width={bw} height={Math.abs(y0 - y1)} rx={2}
                  fill={d.value >= 0 ? "#2f7a4f" : "#c0392b"}>
              <title>{d.label}: {fmtVal(d.value)}</title>
            </rect>
            {n <= 40 && (
              <text x={xOf(i) + 3} y={Math.min(y0, y1) - 5} fontSize={8.5} fontWeight={700}
                    fill={d.value >= 0 ? "#2f7a4f" : "#c0392b"} textAnchor="start"
                    transform={`rotate(-90 ${xOf(i) + 3} ${Math.min(y0, y1) - 5})`}>
                {fmtShort(d.value)}
              </text>
            )}
          </g>
        );
      })}
      {type === "line" && (<>
        <polyline fill="none" stroke="#2f7a4f" strokeWidth={1.5}
                  points={data.map((d, i) => `${xOf(i)},${yOf(d.value)}`).join(" ")} />
        {data.map((d, i) => (
          <g key={i}>
            <circle cx={xOf(i)} cy={yOf(d.value)} r={2.8} fill="#2f7a4f">
              <title>{d.label}: {fmtVal(d.value)}</title>
            </circle>
            {n <= 20 && (
              <text x={xOf(i)} y={yOf(d.value) - 7} fontSize={8.5} textAnchor="middle"
                    fill="#2f7a4f" fontWeight={700}>{fmtShort(d.value)}</text>
            )}
          </g>
        ))}
      </>)}
      {data.map((d, i) => (i % showEvery === 0 || n <= 16) ? (
        <text key={i} x={xOf(i)} y={H - padB + 16} fontSize={10.5} fill="#647686"
              textAnchor="end" transform={`rotate(-40 ${xOf(i)} ${H - padB + 16})`}>
          {d.label.length > 16 ? d.label.slice(0, 15) + "…" : d.label}
        </text>
      ) : null)}
    </svg>
  );
}

function printTable(rows: { label: string; value: number }[], dimLabel: string,
                    measureLabel: string, fmtVal: (v: number) => string) {
  const w = window.open("", "_blank");
  if (!w) { alert("Engedélyezd a felugró ablakot."); return; }
  const esc = (s: string) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const body = rows.map(r =>
    `<tr><td>${esc(r.label)}</td><td style="text-align:right">${esc(fmtVal(r.value))}</td></tr>`).join("");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Statisztika</title>
<style>body{font-family:Arial;margin:18px;color:#182530}h1{font-size:16px}
table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #d7dee4;padding:5px 8px}
th{background:#f1f5f4;text-align:left}.tb{margin-bottom:10px}@media print{.tb{display:none}}</style></head>
<body><div class="tb"><button onclick="window.print()">🖨</button></div>
<h1>Flower Solutions — Statisztika</h1><p>${esc(dimLabel)} / ${esc(measureLabel)}</p>
<table><thead><tr><th>${esc(dimLabel)}</th><th style="text-align:right">${esc(measureLabel)}</th></tr></thead>
<tbody>${body}</tbody></table></body></html>`);
  w.document.close(); w.focus();
}
