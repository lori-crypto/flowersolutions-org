"use client";
import React, { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import type { CashUnit, CashCategory, CashVehicle, CashExpense } from "@/lib/penztar";

/**
 * A hónap költségeinek rendezett összesítője (Havi nézet alja).
 *  - KPI-k: összes költség, tételszám, banki letét, korrekció
 *  - egységenkénti bontás részaránnyal
 *  - csoportosítás: kategória / egység / nap / partner — összecsukható csoportok,
 *    részösszeggel és aránysávval, a csoportok összeg szerint csökkenő sorrendben
 *  - szűrés egységre és típusra, szabadszavas keresés
 *  - CSV-export (Excel-barát: ; elválasztó, BOM)
 */

type Row = CashExpense & {
  day_id: string | null; day: string; kind: string;
  unit_id?: string | null; created_by?: string | null; note?: string | null;
};
type Meta = { categories: CashCategory[]; vehicles: CashVehicle[] };
type GroupBy = "cat" | "unit" | "day" | "client";

const fmt = (n: number) =>
  n.toLocaleString("hu-HU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function MonthExpenses({ expenses, units, meta, persons, ym }: {
  expenses: Row[]; units: CashUnit[]; meta: Meta; persons: Map<string, string>; ym: string;
}) {
  const { t, pick } = useI18n();
  const [groupBy, setGroupBy] = useState<GroupBy>("cat");
  const [unitF, setUnitF] = useState<string>("all");       // all | <unit id> | mgmt
  const [kindF, setKindF] = useState<string>("koltseg");   // koltseg | letet | korrekcio | all
  const [q, setQ] = useState("");
  const [closed, setClosed] = useState<Set<string>>(new Set());

  const catName = (id: string | null) => {
    const c = id ? meta.categories.find(x => x.id === id) : null;
    return c ? pick(c.name_hu, c.name_ro ?? c.name_hu) : t("pz_mx_nocat");
  };
  const unitName = (id: string | null | undefined) => {
    const u = id ? units.find(x => x.id === id) : null;
    return u ? pick(u.name_hu, u.name_ro ?? u.name_hu) : t("pz_mx_mgmt");
  };
  const plate = (id: string | null) => (id ? meta.vehicles.find(v => v.id === id)?.plate ?? "" : "");
  const kindLabel = (k: string) =>
    k === "letet" ? t("pz_k_letet") : k === "korrekcio" ? t("pz_k_korrekcio") : t("pz_k_koltseg");
  const title = (e: Row) => e.description || e.note || (e.kind !== "koltseg" ? kindLabel(e.kind) : catName(e.category_id));

  // ── Szűrés ─────────────────────────────────────────────────
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return expenses.filter(e => {
      if (kindF !== "all" && e.kind !== kindF) return false;
      if (unitF === "mgmt" ? !!e.unit_id : unitF !== "all" && e.unit_id !== unitF) return false;
      if (!needle) return true;
      const hay = [title(e), catName(e.category_id), unitName(e.unit_id), plate(e.vehicle_id),
                   e.client_name ?? "", e.created_by ? persons.get(e.created_by) ?? "" : "", e.day].join(" ").toLowerCase();
      return hay.includes(needle);
    }).sort((a, b) => a.day.localeCompare(b.day));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses, kindF, unitF, q, meta, units, persons]);

  // ── KPI-k (a teljes hónapra, szűréstől függetlenül) ────────
  const kpi = useMemo(() => {
    const sum = (k: string) => expenses.filter(e => e.kind === k).reduce((s, e) => s + Number(e.amount), 0);
    const perUnit = new Map<string, { sum: number; n: number }>();
    for (const e of expenses.filter(x => x.kind === "koltseg")) {
      const k = e.unit_id ?? "mgmt";
      const cur = perUnit.get(k) ?? { sum: 0, n: 0 };
      perUnit.set(k, { sum: cur.sum + Number(e.amount), n: cur.n + 1 });
    }
    return {
      total: sum("koltseg"), count: expenses.filter(e => e.kind === "koltseg").length,
      letet: sum("letet"), korr: sum("korrekcio"),
      perUnit: [...perUnit.entries()].sort((a, b) => b[1].sum - a[1].sum),
    };
  }, [expenses]);

  // ── Csoportok ──────────────────────────────────────────────
  const groups = useMemo(() => {
    const key = (e: Row) =>
      groupBy === "cat" ? catName(e.category_id)
      : groupBy === "unit" ? unitName(e.unit_id)
      : groupBy === "day" ? e.day
      : (e.client_name || t("pz_mx_noclient"));
    const m = new Map<string, Row[]>();
    for (const e of rows) { const k = key(e); m.set(k, [...(m.get(k) ?? []), e]); }
    const list = [...m.entries()].map(([name, items]) => ({
      name, items, sum: items.reduce((s, e) => s + Number(e.amount), 0),
    }));
    return groupBy === "day" ? list.sort((a, b) => a.name.localeCompare(b.name))
                             : list.sort((a, b) => b.sum - a.sum);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, groupBy, meta, units]);
  const filteredSum = rows.reduce((s, e) => s + Number(e.amount), 0);
  const maxGroup = Math.max(1, ...groups.map(g => Math.abs(g.sum)));

  const toggle = (name: string) =>
    setClosed(s => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  const allClosed = groups.length > 0 && groups.every(g => closed.has(g.name));

  // ── CSV ────────────────────────────────────────────────────
  const exportCsv = () => {
    const esc = (v: string | number | null | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = [t("pz_day"), t("pz_mx_unit"), t("pz_mx_type"), t("pz_desc"), t("pz_category"),
                  t("pz_vehicle"), t("pz_client"), t("pz_mx_by"), t("pz_amount")];
    const lines = rows.map(e => [
      e.day, unitName(e.unit_id), kindLabel(e.kind), title(e), e.kind === "koltseg" ? catName(e.category_id) : "",
      plate(e.vehicle_id), e.client_name ?? "", e.created_by ? persons.get(e.created_by) ?? "" : "",
      Number(e.amount).toFixed(2).replace(".", ","),
    ].map(esc).join(";"));
    const csv = "﻿" + [head.map(esc).join(";"), ...lines].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `koltsegek-${ym}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  // ── Stílusok ───────────────────────────────────────────────
  const th: React.CSSProperties = { padding: "7px 9px", fontSize: 10.5, textTransform: "uppercase",
    letterSpacing: "0.04em", color: "#8a968d", textAlign: "left", whiteSpace: "nowrap",
    borderBottom: "1px solid #e2e8e3", position: "sticky", top: 0, background: "#fff" };
  const td: React.CSSProperties = { padding: "6px 9px", borderTop: "1px solid #f0f3f1",
    fontSize: 13, verticalAlign: "top" };
  const tdR: React.CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap", fontWeight: 700 };
  const chip = (on: boolean): React.CSSProperties => ({
    border: "1.5px solid " + (on ? "#2f7a4f" : "#dde4df"), background: on ? "#2f7a4f" : "#fff",
    color: on ? "#fff" : "#2c3a31", borderRadius: 99, padding: "4px 11px", fontSize: 12.5,
    fontWeight: 600, cursor: "pointer",
  });
  const amountColor = (k: string) => k === "koltseg" ? "#b3431f" : k === "letet" ? "#33528a" : "#6b5a14";

  return (
    <div className="stat-card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <b style={{ fontSize: 14, flex: 1 }}>{t("pz_mx_title")}</b>
        <button className="mini-btn" onClick={exportCsv} disabled={rows.length === 0}>⬇ CSV</button>
      </div>

      {/* KPI-k */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-l">{t("pz_mx_total")}</div>
          <div className="kpi-v" style={{ color: "#b3431f" }}>{fmt(kpi.total)}</div>
          <div className="muted">{kpi.count} {t("pz_mx_items")}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-l">{t("pz_mx_avg")}</div>
          <div className="kpi-v">{fmt(kpi.count ? kpi.total / kpi.count : 0)}</div>
          <div className="muted">{t("pz_mx_per_item")}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-l">{t("pz_k_letet")}</div>
          <div className="kpi-v" style={{ color: "#33528a" }}>{fmt(kpi.letet)}</div>
          <div className="muted">{expenses.filter(e => e.kind === "letet").length} {t("pz_mx_items")}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-l">{t("pz_k_korrekcio")}</div>
          <div className="kpi-v" style={{ color: "#6b5a14" }}>{kpi.korr > 0 ? "+" : ""}{fmt(kpi.korr)}</div>
          <div className="muted">{expenses.filter(e => e.kind === "korrekcio").length} {t("pz_mx_items")}</div>
        </div>
      </div>

      {/* Egységenkénti bontás */}
      {kpi.perUnit.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 8 }}>
          {kpi.perUnit.map(([uid, v]) => {
            const share = kpi.total ? v.sum / kpi.total : 0;
            return (
              <div key={uid} style={{ border: "1px solid #e2e8e3", borderRadius: 10, padding: "8px 11px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <b>{uid === "mgmt" ? t("pz_mx_mgmt") : unitName(uid)}</b>
                  <b style={{ fontVariantNumeric: "tabular-nums", color: "#b3431f" }}>{fmt(v.sum)}</b>
                </div>
                <div style={{ height: 6, background: "#eef2ef", borderRadius: 99, marginTop: 6, overflow: "hidden" }}>
                  <div style={{ width: `${Math.round(share * 100)}%`, height: "100%", background: "#2f7a4f" }} />
                </div>
                <div className="muted" style={{ marginTop: 3 }}>{v.n} {t("pz_mx_items")} · {Math.round(share * 100)}%</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Vezérlők */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid #eef2ef", paddingTop: 10 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span className="muted" style={{ width: 92 }}>{t("pz_mx_groupby")}</span>
          {([["cat", t("pz_category")], ["unit", t("pz_mx_unit")], ["day", t("pz_day")], ["client", t("pz_client")]] as [GroupBy, string][])
            .map(([k, l]) => <button key={k} style={chip(groupBy === k)} onClick={() => { setGroupBy(k); setClosed(new Set()); }}>{l}</button>)}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span className="muted" style={{ width: 92 }}>{t("pz_mx_unit")}</span>
          <button style={chip(unitF === "all")} onClick={() => setUnitF("all")}>{t("pz_mx_all")}</button>
          {units.map(u => (
            <button key={u.id} style={chip(unitF === u.id)} onClick={() => setUnitF(u.id)}>{pick(u.name_hu, u.name_ro ?? u.name_hu)}</button>
          ))}
          <button style={chip(unitF === "mgmt")} onClick={() => setUnitF("mgmt")}>{t("pz_mx_mgmt")}</button>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span className="muted" style={{ width: 92 }}>{t("pz_mx_type")}</span>
          {([["koltseg", t("pz_k_koltseg")], ["letet", t("pz_k_letet")], ["korrekcio", t("pz_k_korrekcio")], ["all", t("pz_mx_all")]] as [string, string][])
            .map(([k, l]) => <button key={k} style={chip(kindF === k)} onClick={() => setKindF(k)}>{l}</button>)}
          <span style={{ flex: 1 }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={t("pz_mx_search")}
                 style={{ border: "1.5px solid #dde4df", borderRadius: 8, padding: "6px 10px", fontSize: 13, minWidth: 200 }} />
        </div>
      </div>

      {/* Csoportosított táblázat */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span className="muted">{rows.length} {t("pz_mx_items")} · {groups.length} {t("pz_mx_groups")}</span>
        <span style={{ flex: 1 }} />
        <button className="mini-btn" style={{ fontSize: 12 }}
                onClick={() => setClosed(allClosed ? new Set() : new Set(groups.map(g => g.name)))}>
          {allClosed ? t("pz_mx_expand") : t("pz_mx_collapse")}
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="muted" style={{ fontSize: 13 }}>{t("stat_no_data")}</div>
      ) : (
        <div style={{ overflowX: "auto", maxHeight: 640, overflowY: "auto", border: "1px solid #e2e8e3", borderRadius: 10 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 760 }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 56 }}>{t("pz_day")}</th>
                <th style={th}>{t("pz_desc")}</th>
                {groupBy !== "cat" && <th style={th}>{t("pz_category")}</th>}
                {groupBy !== "unit" && <th style={th}>{t("pz_mx_unit")}</th>}
                <th style={th}>{t("pz_vehicle")}</th>
                {groupBy !== "client" && <th style={th}>{t("pz_client")}</th>}
                <th style={th}>{t("pz_mx_by")}</th>
                <th style={{ ...th, textAlign: "right" }}>{t("pz_amount")}</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(g => {
                const isClosed = closed.has(g.name);
                const cols = 8 - (groupBy === "cat" || groupBy === "unit" || groupBy === "client" ? 1 : 0);
                return (
                  <React.Fragment key={g.name}>
                    <tr style={{ background: "#f3f7f4", cursor: "pointer" }} onClick={() => toggle(g.name)}>
                      <td colSpan={cols - 1} style={{ ...td, borderTop: "2px solid #dfe7e1", padding: "8px 9px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ width: 14, display: "inline-block", color: "#6b7a70" }}>{isClosed ? "▸" : "▾"}</span>
                          <b style={{ fontSize: 13.5 }}>{groupBy === "day" ? `${g.name.slice(8)}. (${g.name})` : g.name}</b>
                          <span className="muted">{g.items.length} {t("pz_mx_items")}</span>
                          <span style={{ flex: 1, maxWidth: 220, height: 6, background: "#e4ebe6", borderRadius: 99, overflow: "hidden" }}>
                            <span style={{ display: "block", width: `${Math.round(Math.abs(g.sum) / maxGroup * 100)}%`, height: "100%", background: "#2f7a4f" }} />
                          </span>
                          <span className="muted">{filteredSum ? Math.round(g.sum / filteredSum * 100) : 0}%</span>
                        </div>
                      </td>
                      <td style={{ ...tdR, borderTop: "2px solid #dfe7e1", fontSize: 13.5 }}>{fmt(g.sum)}</td>
                    </tr>
                    {!isClosed && g.items.map((e, i) => (
                      <tr key={e.id ?? i}>
                        <td style={{ ...td, fontWeight: 700, whiteSpace: "nowrap" }}>{e.day.slice(8)}.</td>
                        <td style={td}>
                          {title(e)}
                          {e.kind !== "koltseg" && <span className="acct-tag" style={{ marginLeft: 6 }}>{kindLabel(e.kind)}</span>}
                        </td>
                        {groupBy !== "cat" && <td style={td}>{e.kind === "koltseg" ? catName(e.category_id) : ""}</td>}
                        {groupBy !== "unit" && <td style={td}>{unitName(e.unit_id)}</td>}
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{plate(e.vehicle_id)}</td>
                        {groupBy !== "client" && <td style={td}>{e.client_name ?? ""}</td>}
                        <td style={{ ...td, whiteSpace: "nowrap" }} className="muted">{e.created_by ? persons.get(e.created_by) ?? "" : ""}</td>
                        <td style={{ ...tdR, color: amountColor(e.kind) }}>{fmt(Number(e.amount))}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
              <tr style={{ background: "#1f3d2b", color: "#fff" }}>
                <td colSpan={7 - (groupBy === "cat" || groupBy === "unit" || groupBy === "client" ? 1 : 0)}
                    style={{ ...td, color: "#fff", fontWeight: 800, borderTop: "none" }}>
                  Σ {t("pz_mx_filtered")}
                </td>
                <td style={{ ...tdR, color: "#fff", borderTop: "none" }}>{fmt(filteredSum)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

