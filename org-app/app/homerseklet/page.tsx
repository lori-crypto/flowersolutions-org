"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, withAuthRetry, signOutAndGo } from "@/lib/supabaseClient";
import { useI18n } from "@/lib/i18n";
import { TopNav, fetchMyCaps, capHas, routeForCaps, NoAccessScreen } from "@/lib/TopNav";
import {
  Site, Device, Sensor, Alert, AlertKind, Kind, MinMax, Point, PRESETS,
  loadAll, loadAlertHistory, loadSeries, ackAlert, saveSensor, saveDevice,
  addSite, renameSite, newDevice, rekeyDevice,
} from "@/lib/temp";
import TempChart from "./TempChart";
import s from "./homerseklet.module.css";

type Data = { sites: Site[]; devices: Device[]; sensors: Sensor[]; open: Alert[]; minmax: MinMax };
type Tr = (hu: string, ro: string) => string;

const STALE_MS = 10 * 60_000;
const ago = (iso: string | null, now: number) => (iso ? now - new Date(iso).getTime() : Infinity);

const KIND_LABEL: Record<Kind, [string, string]> = {
  hutokamra: ["Hűtőkamra", "Cameră frigorifică"],
  viragos_huto: ["Virágos hűtő", "Vitrină frigorifică"],
  raktar: ["Raktár", "Depozit"],
  iroda: ["Iroda", "Birou"],
  egyeb: ["Egyéb", "Altele"],
};
const ALERT_LABEL: Record<AlertKind, [string, string]> = {
  high: ["Túl meleg", "Prea cald"],
  critical: ["Nagyon meleg", "Foarte cald"],
  low: ["Túl hideg", "Prea rece"],
  sensor_fault: ["Szonda hiba", "Eroare sondă"],
  device_offline: ["Panel elhallgatott", "Panou deconectat"],
  site_offline: ["Telephely kiesett", "Locație fără date"],
};

export default function HomersekletPage() {
  const { t, lang, setLang } = useI18n();
  const tr: Tr = useCallback((hu, ro) => (lang === "ro" ? ro : hu), [lang]);
  const locale = lang === "ro" ? "ro-RO" : "hu-HU";
  const router = useRouter();

  const [canView, setCanView] = useState<boolean | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [tab, setTab] = useState<"overview" | "alerts" | "settings">("overview");
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const reload = useCallback(async () => {
    try { setData(await withAuthRetry(loadAll)); setLoadedAt(new Date()); setErr(""); }
    catch (e) { setErr((e as Error).message); }
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      const caps = await fetchMyCaps();
      const view = capHas(caps, "homerseklet") || capHas(caps, "homerseklet.beallitas");
      if (!view) {
        const target = routeForCaps(caps);
        if (target && target !== "/homerseklet") { router.replace(target); return; }
        setCanView(false); return;
      }
      setCanView(true);
      setCanEdit(capHas(caps, "homerseklet.beallitas"));
      await reload();
    })();
  }, [router, reload]);

  // Élő frissítés: 30 mp-enként, és amikor a lap újra előtérbe kerül
  useEffect(() => {
    if (!canView) return;
    const id = setInterval(() => { if (document.visibilityState === "visible") reload(); }, 30_000);
    const onVis = () => { if (document.visibilityState === "visible") reload(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [canView, reload]);

  if (canView === false) return <NoAccessScreen active="temp" />;

  return (
    <>
      <header className="appbar">
        <span className="t">FS Org</span>
        <TopNav active="temp" />
        <span className="sp" />
        <select className="lang-select" value={lang}
                onChange={e => setLang(e.target.value as "hu" | "ro")}>
          <option value="hu">HU — magyar</option>
          <option value="ro">RO — română</option>
        </select>
        <button className="lang-btn" onClick={() => signOutAndGo()}>{t("sign_out")}</button>
      </header>

      <div className={s.page}>
        <div className={s.tabs}>
          <button className={`${s.tab} ${tab === "overview" ? s.on : ""}`} onClick={() => setTab("overview")}>
            🌡 {tr("Áttekintő", "Prezentare")}
          </button>
          <button className={`${s.tab} ${tab === "alerts" ? s.on : ""}`} onClick={() => setTab("alerts")}>
            🔔 {tr("Riasztásnapló", "Istoric alarme")}
          </button>
          {canEdit && (
            <button className={`${s.tab} ${tab === "settings" ? s.on : ""}`} onClick={() => setTab("settings")}>
              ⚙️ {tr("Beállítások", "Setări")}
            </button>
          )}
          <span className={s.spacer} />
          {loadedAt && (
            <span className={s.refreshed}>
              {tr("Frissítve", "Actualizat")}: {loadedAt.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
        </div>

        {err && <div className={s.err}>{tr("Hiba", "Eroare")}: {err}</div>}
        {!data ? <div className="center-msg">{t("loading")}</div> : (
          <>
            {tab === "overview" && (
              <Overview data={data} tr={tr} locale={locale} selected={selected}
                        onSelect={id => setSelected(selected === id ? null : id)}
                        onAck={async id => { await ackAlert(id); reload(); }}
                        canEdit={canEdit} goSettings={() => setTab("settings")}
                        now={loadedAt?.getTime() ?? 0} />
            )}
            {tab === "alerts" && <AlertLog data={data} tr={tr} locale={locale} />}
            {tab === "settings" && canEdit && <Settings data={data} tr={tr} locale={locale} reload={reload} />}
          </>
        )}
      </div>
    </>
  );
}

// ── Segédek ──────────────────────────────────────────────────
function fmtTemp(v: number | null | undefined, locale: string) {
  if (v == null || Number.isNaN(v)) return "–";
  return v.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " °C";
}
function fmtTime(iso: string | null, locale: string) {
  if (!iso) return "–";
  const d = new Date(iso), today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString(locale, today ? { hour: "2-digit", minute: "2-digit" }
    : { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtDur(ms: number, tr: Tr) {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${m} ${tr("perc", "min")}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ${tr("óra", "h")} ${m % 60} ${tr("perc", "min")}`;
  return `${Math.floor(h / 24)} ${tr("nap", "zile")} ${h % 24} ${tr("óra", "h")}`;
}

function placeOf(a: Alert, d: Data) {
  if (a.sensor_id) {
    const se = d.sensors.find(x => x.id === a.sensor_id);
    const dev = d.devices.find(x => x.id === se?.device_id);
    const site = d.sites.find(x => x.id === dev?.site_id);
    return `${site?.name ?? "?"} / ${se?.name ?? se?.hw_addr ?? "?"}`;
  }
  if (a.device_id) {
    const dev = d.devices.find(x => x.id === a.device_id);
    const site = d.sites.find(x => x.id === dev?.site_id);
    return `${site?.name ?? "?"} / ${dev?.name ?? "?"}`;
  }
  return d.sites.find(x => x.id === a.site_id)?.name ?? "?";
}

type Status = "ok" | "watch" | "hot" | "cold" | "gray";
function sensorStatus(se: Sensor, open: Alert[], now: number): { st: Status; label: [string, string] | null } {
  const mine = open.filter(a => a.sensor_id === se.id);
  if (mine.some(a => a.kind === "critical" || a.kind === "high")) return { st: "hot", label: ALERT_LABEL[mine.find(a => a.kind === "critical") ? "critical" : "high"] };
  if (mine.some(a => a.kind === "low")) return { st: "cold", label: ALERT_LABEL.low };
  if (mine.some(a => a.kind === "sensor_fault") || ago(se.last_at, now) > STALE_MS) return { st: "gray", label: ["Nincs friss adat", "Fără date recente"] };
  const v = se.last_temp;
  if (v != null && ((se.max_temp != null && v > se.max_temp) || (se.min_temp != null && v < se.min_temp)))
    return { st: "watch", label: ["Határon kívül — figyelés", "În afara limitei — monitorizare"] };
  return { st: "ok", label: null };
}
const ST_CLASS: Record<Status, string> = { ok: s.sOk, watch: s.sWatch, hot: s.sHot, cold: s.sCold, gray: s.sGray };
const BADGE_CLASS: Record<Status, string> = { ok: "", watch: s.bWatch, hot: s.bHot, cold: s.bCold, gray: s.bGray };

// ── Áttekintő ────────────────────────────────────────────────
function Overview({ data, tr, locale, selected, onSelect, onAck, canEdit, goSettings, now }: {
  data: Data; tr: Tr; locale: string; selected: number | null; now: number;
  onSelect: (id: number) => void; onAck: (id: number) => Promise<void>;
  canEdit: boolean; goSettings: () => void;
}) {
  const visible = data.sensors.filter(x => x.configured && x.active);
  const unnamed = data.sensors.filter(x => !x.configured && x.active).length;
  const sel = data.sensors.find(x => x.id === selected) ?? null;

  if (!data.devices.length) {
    return (
      <div className={s.empty}>
        {tr("Még nincs panel felvéve.", "Încă nu există panouri.")}
        {canEdit && <> <button className="mini-btn" onClick={goSettings}>{tr("Panel felvétele", "Adaugă panou")}</button></>}
      </div>
    );
  }

  return (
    <>
      {data.open.map(a => {
        const cls = a.kind === "low" ? s.aCold : (a.kind === "high" || a.kind === "critical") ? s.aHot : s.aWarn;
        return (
          <div key={a.id} className={`${s.alertBox} ${cls}`}>
            <div className={s.msg}>
              <b>{tr(...ALERT_LABEL[a.kind])}</b> — {placeOf(a, data)}
              {a.peak_temp != null && <> · {tr("csúcs", "vârf")}: {fmtTemp(Number(a.peak_temp), locale)}</>}
              <> · {tr("kezdete", "început")}: {fmtTime(a.started_at, locale)} ({fmtDur(now - new Date(a.started_at).getTime(), tr)})</>
            </div>
            {a.ack_at
              ? <span className={s.acked}>👀 {a.ack_by ?? ""} {fmtTime(a.ack_at, locale)}</span>
              : <button className="mini-btn" onClick={() => onAck(a.id)}>✅ {tr("Láttam", "Am văzut")}</button>}
          </div>
        );
      })}

      {unnamed > 0 && (
        <div className={s.note}>
          {tr(`${unnamed} új szonda jelentkezett, és elnevezésre vár. Amíg nincs elnevezve, nem riaszt.`,
              `${unnamed} sonde noi așteaptă denumire. Până atunci nu dau alarmă.`)}
          {canEdit && <> <button className="mini-btn" onClick={goSettings}>{tr("Elnevezem", "Denumesc")}</button></>}
        </div>
      )}

      {sel && <Detail se={sel} tr={tr} locale={locale} onClose={() => onSelect(sel.id)} />}

      {data.sites.map(site => {
        const devs = data.devices.filter(d => d.site_id === site.id && d.active);
        if (!devs.length) return null;
        const sens = visible.filter(x => devs.some(d => d.id === x.device_id));
        return (
          <section key={site.id}>
            <div className={s.site}>
              <h2>{site.name}</h2>
              <div className={s.devs}>
                {devs.map(d => (
                  <span key={d.id} className={ago(d.last_seen, now) < 3 * 60_000 ? s.devOk : s.devBad}
                        title={d.rssi != null ? `Wi-Fi: ${d.rssi} dBm` : undefined}>
                    {d.name} · {fmtTime(d.last_seen, locale)}
                  </span>
                ))}
              </div>
            </div>
            {!sens.length ? <div className={s.muted}>{tr("Nincs elnevezett szonda.", "Nicio sondă denumită.")}</div> : (
              <div className={s.cards}>
                {sens.map(se => {
                  const { st, label } = sensorStatus(se, data.open, now);
                  const mm = data.minmax[se.id];
                  return (
                    <button key={se.id} className={`${s.card} ${ST_CLASS[st]}`} onClick={() => onSelect(se.id)}
                            aria-pressed={selected === se.id}>
                      <div className={s.name}>{se.name}</div>
                      <div className={s.temp}>{fmtTemp(se.last_temp, locale)}</div>
                      <div className={s.meta}>
                        {mm ? <>24 {tr("ó", "h")}: {fmtTemp(mm.min, locale)} … {fmtTemp(mm.max, locale)}</> : "24 ó: –"}
                      </div>
                      <div className={s.meta}>{tr("Mérve", "Măsurat")}: {fmtTime(se.last_at, locale)}</div>
                      {label && <span className={`${s.badge} ${BADGE_CLASS[st]}`}>{tr(...label)}</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}

// ── Részletes nézet grafikonnal ──────────────────────────────
const RANGES: { k: string; hu: string; ro: string; ms: number }[] = [
  { k: "24h", hu: "24 óra", ro: "24 h", ms: 86400_000 },
  { k: "7d", hu: "7 nap", ro: "7 zile", ms: 7 * 86400_000 },
  { k: "30d", hu: "30 nap", ro: "30 zile", ms: 30 * 86400_000 },
  { k: "1y", hu: "1 év", ro: "1 an", ms: 365 * 86400_000 },
];

function Detail({ se, tr, locale, onClose }: { se: Sensor; tr: Tr; locale: string; onClose: () => void }) {
  const [range, setRange] = useState("24h");
  const [custom, setCustom] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const [pts, setPts] = useState<Point[] | null>(null);
  const [err, setErr] = useState("");

  const { from, to } = useMemo(() => {
    if (range === "custom" && custom.from && custom.to) {
      return { from: new Date(custom.from + "T00:00"), to: new Date(custom.to + "T23:59:59") };
    }
    const r = RANGES.find(x => x.k === range) ?? RANGES[0];
    const now = new Date();
    return { from: new Date(now.getTime() - r.ms), to: now };
    // a se.last_at változása (új mérés) frissítse a „most" végpontot
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, custom, se.last_at]);

  useEffect(() => {
    let live = true;
    withAuthRetry(() => loadSeries(se.id, from, to))
      .then(p => { if (live) { setPts(p); setErr(""); } })
      .catch(e => { if (live) setErr((e as Error).message); });
    return () => { live = false; };
  }, [se.id, from, to]);

  const csv = () => {
    if (!pts) return;
    const rows = [["idopont", "atlag_C", "min_C", "max_C"].join(";")]
      .concat(pts.map(p => [new Date(p.ts).toLocaleString("sv-SE", { timeZone: "Europe/Bucharest" }),
        p.t_avg, p.t_min, p.t_max].map(v => String(v).replace(".", ",")).join(";")));
    const blob = new Blob(["﻿" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `homerseklet_${(se.name ?? se.hw_addr).replace(/\W+/g, "_")}_${range}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className={s.detail}>
      <div className={s.detailHead}>
        <h3>{se.name} — {fmtTemp(se.last_temp, locale)}</h3>
        <div className={s.ranges}>
          {RANGES.map(r => (
            <button key={r.k} className={`${s.range} ${range === r.k ? s.on : ""}`} onClick={() => setRange(r.k)}>
              {tr(r.hu, r.ro)}
            </button>
          ))}
          <button className={`${s.range} ${range === "custom" ? s.on : ""}`} onClick={() => setRange("custom")}>
            {tr("Egyedi", "Personalizat")}
          </button>
        </div>
        <button className="mini-btn" onClick={csv} disabled={!pts?.length}>⬇ CSV</button>
        <button className="mini-btn" onClick={onClose}>✕</button>
      </div>
      {range === "custom" && (
        <div className={s.ranges} style={{ marginBottom: 8 }}>
          <input type="date" className={s.input} value={custom.from}
                 onChange={e => setCustom(c => ({ ...c, from: e.target.value }))} />
          <span>…</span>
          <input type="date" className={s.input} value={custom.to}
                 onChange={e => setCustom(c => ({ ...c, to: e.target.value }))} />
        </div>
      )}
      {err && <div className={s.err}>{err}</div>}
      {pts ? (
        <TempChart points={pts} from={from} to={to} locale={locale}
                   maxTemp={se.max_temp} minTemp={se.min_temp} critTemp={se.crit_temp} />
      ) : <div className={s.muted}>{tr("Betöltés…", "Se încarcă…")}</div>}
      <div className={s.legend}>
        <span className={s.lgAvg}>{tr("átlag (sáv: min–max)", "medie (bandă: min–max)")}</span>
        {se.max_temp != null && <span className={s.lgMax}>{tr("meleg határ", "limită cald")} {fmtTemp(se.max_temp, locale)} / {se.max_delay_min} {tr("perc", "min")}</span>}
        {se.min_temp != null && <span className={s.lgMin}>{tr("hideg határ", "limită rece")} {fmtTemp(se.min_temp, locale)} / {se.min_delay_min} {tr("perc", "min")}</span>}
      </div>
    </div>
  );
}

// ── Riasztásnapló ────────────────────────────────────────────
function AlertLog({ data, tr, locale }: { data: Data; tr: Tr; locale: string }) {
  const [rows, setRows] = useState<Alert[] | null>(null);
  const [days, setDays] = useState(30);
  useEffect(() => { withAuthRetry(() => loadAlertHistory(days)).then(setRows).catch(() => setRows([])); }, [days]);
  return (
    <>
      <div className={s.ranges} style={{ marginBottom: 10 }}>
        {[7, 30, 90, 365].map(d => (
          <button key={d} className={`${s.range} ${days === d ? s.on : ""}`} onClick={() => setDays(d)}>
            {d} {tr("nap", "zile")}
          </button>
        ))}
      </div>
      {!rows ? <div className={s.muted}>{tr("Betöltés…", "Se încarcă…")}</div> : !rows.length ? (
        <div className={s.empty}>{tr("Ebben az időszakban nem volt riasztás. 🎉", "Nicio alarmă în această perioadă. 🎉")}</div>
      ) : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr>
              <th>{tr("Kezdete", "Început")}</th><th>{tr("Hely", "Loc")}</th><th>{tr("Típus", "Tip")}</th>
              <th>{tr("Csúcs", "Vârf")}</th><th>{tr("Időtartam", "Durată")}</th><th>{tr("Nyugtázta", "Confirmat de")}</th>
            </tr></thead>
            <tbody>
              {rows.map(a => (
                <tr key={a.id}>
                  <td>{new Date(a.started_at).toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                  <td>{placeOf(a, data)}</td>
                  <td>{tr(...ALERT_LABEL[a.kind])}</td>
                  <td>{a.peak_temp != null ? fmtTemp(Number(a.peak_temp), locale) : "–"}</td>
                  <td>{a.resolved_at
                    ? fmtDur(new Date(a.resolved_at).getTime() - new Date(a.started_at).getTime(), tr)
                    : <b>{tr("folyamatban", "în curs")}</b>}</td>
                  <td>{a.ack_by ? `${a.ack_by} · ${fmtTime(a.ack_at, locale)}` : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ── Beállítások ──────────────────────────────────────────────
function Settings({ data, tr, locale, reload }: { data: Data; tr: Tr; locale: string; reload: () => Promise<void> }) {
  const [err, setErr] = useState("");
  const [shownKey, setShownKey] = useState<{ device: string; key: string } | null>(null);
  const [newSite, setNewSite] = useState("");
  const [newDev, setNewDev] = useState<Record<number, string>>({});
  const [editing, setEditing] = useState<number | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    try { setErr(""); await withAuthRetry(fn); await reload(); }
    catch (e) { setErr((e as Error).message); }
  };

  return (
    <>
      {err && <div className={s.err}>{err}</div>}
      {shownKey && (
        <div className={s.box}>
          <h3>🔑 {tr("Eszközkulcs", "Cheie dispozitiv")}: {shownKey.device}</h3>
          <p className={s.muted} style={{ marginBottom: 6 }}>
            {tr("Ezt a kulcsot a panel beállításakor kell megadni (telefonról, a panel saját Wi-Fi-jén). Csak most látszik — ha elveszik, generálj újat.",
                "Introdu această cheie la configurarea panoului. Se afișează doar acum — dacă se pierde, generează una nouă.")}
          </p>
          <div className={s.key}>{shownKey.key}</div>
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <button className="mini-btn" onClick={() => navigator.clipboard?.writeText(shownKey.key)}>📋 {tr("Másolás", "Copiază")}</button>
            <button className="mini-btn" onClick={() => setShownKey(null)}>{tr("Kész, elmentettem", "Gata, am salvat")}</button>
          </div>
        </div>
      )}

      {data.sites.map(site => (
        <div key={site.id} className={s.box}>
          <h3>
            <SiteName site={site} onSave={n => run(() => renameSite(site.id, n))} />
          </h3>
          {data.devices.filter(d => d.site_id === site.id).map(d => (
            <div key={d.id}>
              <div className={s.row}>
                <span className={s.grow}>
                  <b>📟 {d.name}</b>{!d.active && <span className={s.muted}> · {tr("kikapcsolva", "dezactivat")}</span>}
                  <div className={s.muted}>
                    {tr("Utolsó adat", "Ultimele date")}: {fmtTime(d.last_seen, locale)}
                    {d.rssi != null && <> · Wi-Fi {d.rssi} dBm {d.rssi > -67 ? "✅" : d.rssi > -78 ? "🟡" : "🔴"}</>}
                    {d.fw && <> · fw {d.fw}</>}
                  </div>
                </span>
                <button className="mini-btn" onClick={() => {
                  const n = prompt(tr("Panel neve:", "Numele panoului:"), d.name);
                  if (n && n.trim()) run(() => saveDevice(d.id, { name: n.trim() }));
                }}>✎</button>
                <button className="mini-btn" onClick={() => {
                  if (confirm(tr("Új kulcsot generálsz? A panelt utána újra be kell állítani az új kulccsal.",
                                 "Generezi o cheie nouă? Panoul trebuie reconfigurat."))) {
                    run(async () => setShownKey({ device: d.name, key: await rekeyDevice(d.id) }));
                  }
                }}>🔑 {tr("Új kulcs", "Cheie nouă")}</button>
                <button className="mini-btn" onClick={() => run(() => saveDevice(d.id, { active: !d.active }))}>
                  {d.active ? tr("Kikapcsol", "Dezactivează") : tr("Bekapcsol", "Activează")}
                </button>
              </div>
              {data.sensors.filter(x => x.device_id === d.id).map(se => (
                <div key={se.id} className={s.row} style={{ paddingLeft: 18 }}>
                  <span className={s.grow}>
                    🌡 {se.name ?? <span className={s.newTag}>{tr("ÚJ — nevezd el", "NOU — denumește")}</span>}
                    {" "}<span className={s.muted}>
                      {tr(...KIND_LABEL[se.kind])} · {fmtTemp(se.last_temp, locale)} · {se.hw_addr}
                      {!se.active && <> · {tr("kikapcsolva", "dezactivat")}</>}
                    </span>
                  </span>
                  <button className="mini-btn" onClick={() => setEditing(editing === se.id ? null : se.id)}>
                    {editing === se.id ? tr("Bezár", "Închide") : tr("Beállít", "Setează")}
                  </button>
                  {editing === se.id && (
                    <SensorForm se={se} devices={data.devices} sites={data.sites} tr={tr}
                                onSave={async p => { await run(() => saveSensor(se.id, p)); setEditing(null); }} />
                  )}
                </div>
              ))}
              {!data.sensors.some(x => x.device_id === d.id) && (
                <div className={s.row} style={{ paddingLeft: 18 }}>
                  <span className={s.muted}>{tr("Még nem jelentkezett szonda. Amint a panel elküldi az első mérést, itt megjelenik.",
                                                 "Nicio sondă încă. Apare după prima măsurătoare.")}</span>
                </div>
              )}
            </div>
          ))}
          <div className={s.row}>
            <input className={`${s.input} ${s.grow}`} placeholder={tr("Új panel neve (pl. Hűtőkamrák)", "Nume panou nou")}
                   value={newDev[site.id] ?? ""} onChange={e => setNewDev(v => ({ ...v, [site.id]: e.target.value }))} />
            <button className="mini-btn" disabled={!(newDev[site.id] ?? "").trim()} onClick={() => run(async () => {
              const name = (newDev[site.id] ?? "").trim();
              const key = await newDevice(site.id, name);
              setShownKey({ device: name, key });
              setNewDev(v => ({ ...v, [site.id]: "" }));
            })}>＋ {tr("Panel felvétele", "Adaugă panou")}</button>
          </div>
        </div>
      ))}

      <div className={s.box}>
        <div className={s.row}>
          <input className={`${s.input} ${s.grow}`} placeholder={tr("Új telephely neve", "Locație nouă")}
                 value={newSite} onChange={e => setNewSite(e.target.value)} />
          <button className="mini-btn" disabled={!newSite.trim()}
                  onClick={() => run(async () => { await addSite(newSite, data.sites.length + 1); setNewSite(""); })}>
            ＋ {tr("Telephely", "Locație")}
          </button>
        </div>
      </div>
    </>
  );
}

function SiteName({ site, onSave }: { site: Site; onSave: (n: string) => void }) {
  return (
    <>
      📍 {site.name}{" "}
      <button className="pencil" onClick={() => {
        const n = prompt("Telephely neve:", site.name);
        if (n && n.trim() && n.trim() !== site.name) onSave(n);
      }}>✎</button>
    </>
  );
}

type Num = number | null;
function SensorForm({ se, devices, sites, tr, onSave }: {
  se: Sensor; devices: Device[]; sites: Site[]; tr: Tr; onSave: (p: Partial<Sensor>) => Promise<void>;
}) {
  const [f, setF] = useState({
    name: se.name ?? "", kind: se.kind, active: se.active, sort: se.sort, device_id: se.device_id,
    max_temp: se.max_temp, max_delay_min: se.max_delay_min,
    crit_temp: se.crit_temp, crit_delay_min: se.crit_delay_min,
    min_temp: se.min_temp, min_delay_min: se.min_delay_min,
    offline_min: se.offline_min, hyst: se.hyst, cal_offset: se.cal_offset,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(x => ({ ...x, [k]: v }));
  const numIn = (k: "max_temp" | "max_delay_min" | "crit_temp" | "crit_delay_min" | "min_temp" | "min_delay_min",
                 label: string, step = "0.5") => (
    <label>{label}
      <input className={s.input} type="number" step={step} value={f[k] ?? ""}
             placeholder={tr("ki", "oprit")}
             onChange={e => set(k, (e.target.value === "" ? null : Number(e.target.value)) as Num)} />
    </label>
  );

  return (
    <div className={s.form}>
      <label className={s.full}>{tr("Név (ez látszik a riasztásban)", "Nume (apare în alarmă)")}
        <input className={s.input} value={f.name} onChange={e => set("name", e.target.value)}
               placeholder={tr("pl. Hűtőkamra 1", "ex. Cameră 1")} />
      </label>
      <label>{tr("Típus (alapértékeket tölt be)", "Tip (încarcă valori implicite)")}
        <select className={s.input} value={f.kind} onChange={e => {
          const k = e.target.value as Kind;
          setF(x => ({ ...x, kind: k, ...PRESETS[k] }));
        }}>
          {(Object.keys(KIND_LABEL) as Kind[]).map(k => <option key={k} value={k}>{tr(...KIND_LABEL[k])}</option>)}
        </select>
      </label>
      <label>{tr("Panel", "Panou")}
        <select className={s.input} value={f.device_id} onChange={e => set("device_id", Number(e.target.value))}>
          {devices.map(d => <option key={d.id} value={d.id}>{sites.find(x => x.id === d.site_id)?.name} / {d.name}</option>)}
        </select>
      </label>
      {numIn("max_temp", tr("Túl meleg, ha felette (°C)", "Prea cald peste (°C)"))}
      {numIn("max_delay_min", tr("…ennyi percig", "…timp de minute"), "1")}
      {numIn("crit_temp", tr("Nagyon meleg, ha felette (°C)", "Foarte cald peste (°C)"))}
      {numIn("crit_delay_min", tr("…ennyi percig", "…timp de minute"), "1")}
      {numIn("min_temp", tr("Túl hideg, ha alatta (°C)", "Prea rece sub (°C)"))}
      {numIn("min_delay_min", tr("…ennyi percig", "…timp de minute"), "1")}
      <label>{tr("Szonda hiba, ha nem mér (perc)", "Eroare sondă după (min)")}
        <input className={s.input} type="number" min={2} value={f.offline_min}
               onChange={e => set("offline_min", Number(e.target.value) || 10)} />
      </label>
      <label>{tr("Kalibráció (+/− °C)", "Calibrare (+/− °C)")}
        <input className={s.input} type="number" step="0.1" value={f.cal_offset}
               onChange={e => set("cal_offset", Number(e.target.value) || 0)} />
      </label>
      <label>{tr("Sorrend", "Ordine")}
        <input className={s.input} type="number" value={f.sort} onChange={e => set("sort", Number(e.target.value) || 0)} />
      </label>
      <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <input type="checkbox" checked={f.active} onChange={e => set("active", e.target.checked)} />
        {tr("Aktív", "Activ")}
      </label>
      <div className={s.full} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="mini-btn" disabled={!f.name.trim()}
                onClick={() => onSave({ ...f, name: f.name.trim(), configured: true })}>
          💾 {tr("Mentés", "Salvează")}
        </button>
        <span className={s.muted}>
          {tr("Üres mező = az a riasztás ki van kapcsolva. Ajtónyitás ellen a késleltetés véd: csak akkor szól, ha végig a határon kívül volt.",
              "Câmp gol = alarmă oprită. Întârzierea protejează la deschiderea ușii.")}
        </span>
      </div>
    </div>
  );
}
