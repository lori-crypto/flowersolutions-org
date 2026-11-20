"use client";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Szabadságos tábla — FALI KIJELZŐ (kioszk).
 * Belépés nélkül, kulccsal működik:  /kijelzo/szabadsag?key=…
 *   &tabla=2      melyik tábla (1-től számozva; alap: az első)
 *   &valt=30      másodpercenként váltson a táblák között (alap: nem vált)
 *   &lang=ro      román feliratok (alap: magyar)
 *   &resz=hatra   csak az év hátralevő része, hetes naptárként (soronként egy hét, H–V),
 *                 a mai héttől december 31-ig; a mezők kitöltik a képernyőt.
 *   &resz=ev      mindig az egész év.
 *   Ha a címben nincs &resz=, a szabadságos oldalon (HR) táblánként átkapcsolható
 *   „Fali monitor” beállítás dönt (leave_rules.kijelzo_mod) — percenként frissül.
 * Percenként magától frissül; ha nincs hálózat, az utolsó jó adat marad kint és piros
 * jelzés mutatja. Naponta hajnalban újratölti magát, hogy az új verzió is megérkezzen.
 * A méretezés a képernyő magasságához igazodik (em), így Full HD-n és 4K-n is kitölti
 * a monitort görgetés nélkül.
 */

type Board = { id: string; name_hu: string; name_ro: string | null };
type LType = { code: string; name_hu: string; name_ro: string | null; color: string };
type Entry = { id: string; board_id: string; day: string; part: string; type_code: string; name: string };
type Blackout = { board_id: string; from_day: string; to_day: string; reason: string | null };
type Holiday = { day: string; name_hu: string; name_ro: string | null };
type Data = {
  today: string; year: number; boards: Board[]; types: LType[];
  entries: Entry[]; blackouts: Blackout[]; holidays: Holiday[];
  modes?: Record<string, string>;
};

const REFRESH_MS = 60_000;
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// A kijelzőt hajtó gép órája lehet UTC-re állítva (szerver) — a „ma” és az óra ezért mindig
// romániai idő szerint számol, függetlenül a gép időzónájától.
const TZ = "Europe/Bucharest";
const tzFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const tzParts = (d: Date) => {
  const p = tzFmt.formatToParts(d);
  const g = (t: string) => p.find(x => x.type === t)?.value ?? "";
  return { day: `${g("year")}-${g("month")}-${g("day")}`, hm: `${g("hour")}:${g("minute")}` };
};
const hhmm = (d: Date) => tzParts(d).hm;

const TXT = {
  hu: { title: "Szabadságos tábla", away: "Ma távol", nobody: "ma mindenki dolgozik", updated: "frissítve",
        offline: "nincs kapcsolat — utolsó adat", weekend: "hétvége", holiday: "ünnepnap", blocked: "zárolt időszak",
        today: "ma", loading: "Betöltés…", nokey: "Hiányzó vagy érvénytelen kulcs a címben (?key=…)." },
  ro: { title: "Planificare concedii", away: "Absenți azi", nobody: "azi toată lumea lucrează", updated: "actualizat",
        offline: "fără conexiune — ultimele date", weekend: "weekend", holiday: "sărbătoare", blocked: "perioadă blocată",
        today: "azi", loading: "Se încarcă…", nokey: "Cheie lipsă sau invalidă în adresă (?key=…)." },
};

export default function KijelzoSzabadsag() {
  const [cfg, setCfg] = useState<{ key: string; tabla: number; valt: number; lang: "hu" | "ro"; resz: string } | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [badKey, setBadKey] = useState(false);
  const [lastOk, setLastOk] = useState<Date | null>(null);
  const [offline, setOffline] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [boardIdx, setBoardIdx] = useState(0);
  const keyRef = useRef("");

  // beállítások a címből
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const key = q.get("key") ?? "";
    keyRef.current = key;
    const tabla = Math.max(1, parseInt(q.get("tabla") || "1", 10) || 1);
    const valt = Math.max(0, parseInt(q.get("valt") || "0", 10) || 0);
    setCfg({ key, tabla, valt, lang: q.get("lang") === "ro" ? "ro" : "hu", resz: q.get("resz") ?? "" });
    setBoardIdx(tabla - 1);
    if (!key) setBadKey(true);
  }, []);

  // adat: azonnal, majd percenként; hiba esetén a régi adat marad
  useEffect(() => {
    if (!cfg?.key) return;
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch(`/api/kijelzo/szabadsag?key=${encodeURIComponent(cfg.key)}`, { cache: "no-store" });
        if (r.status === 401) { if (!stop) setBadKey(true); return; }
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as Data;
        if (stop) return;
        setData(j); setLastOk(new Date()); setOffline(false); setBadKey(false);
      } catch { if (!stop) setOffline(true); }
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { stop = true; clearInterval(t); };
  }, [cfg?.key]);

  // óra (20 mp-enként elég a perc-kijelzéshez)
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(t);
  }, []);

  // táblák közti váltás
  useEffect(() => {
    if (!cfg?.valt || !data || data.boards.length < 2) return;
    const t = setInterval(() => setBoardIdx(i => (i + 1) % data.boards.length), cfg.valt * 1000);
    return () => clearInterval(t);
  }, [cfg?.valt, data]);

  // napi újratöltés 04:10-kor — csak ha a szerver elérhető (különben hibaoldal ragadna a monitoron)
  useEffect(() => {
    const next = new Date(); next.setHours(4, 10, 0, 0);
    if (next <= new Date()) next.setDate(next.getDate() + 1);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/kijelzo/szabadsag?key=${encodeURIComponent(keyRef.current)}`, { cache: "no-store" });
        if (r.ok) window.location.reload();
      } catch { /* marad a mostani oldal, a percenkénti frissítés megy tovább */ }
    }, next.getTime() - Date.now());
    return () => clearTimeout(t);
  }, []);

  const lang = cfg?.lang ?? "hu";
  const tx = TXT[lang];
  const locale = lang === "ro" ? "ro-RO" : "hu-HU";
  const pick = (hu: string, ro: string | null) => (lang === "ro" ? ro || hu : hu);

  const board = data ? data.boards[Math.min(boardIdx, data.boards.length - 1)] ?? null : null;
  const typeMap = useMemo(() => new Map((data?.types ?? []).map(t => [t.code, t])), [data]);
  const byDay = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of data?.entries ?? []) {
      if (e.board_id !== board?.id) continue;
      const a = m.get(e.day) ?? []; a.push(e); m.set(e.day, a);
    }
    return m;
  }, [data, board?.id]);
  const blocked = useMemo(() => {
    const s = new Set<string>();
    for (const b of data?.blackouts ?? []) {
      if (b.board_id !== board?.id) continue;
      const d = new Date(b.from_day + "T00:00:00"), end = new Date(b.to_day + "T00:00:00");
      while (d <= end) { s.add(iso(d)); d.setDate(d.getDate() + 1); }
    }
    return s;
  }, [data, board?.id]);
  const holidays = useMemo(() => new Map((data?.holidays ?? []).map(h => [h.day, h])), [data]);

  if (badKey) return <div className="kx kx-msg">{tx.nokey}</div>;
  if (!data || !board) return <div className="kx kx-msg">{tx.loading}</div>;

  const today = tzParts(now).day;              // romániai idő szerinti mai nap
  const year = data.year;
  const todays = byDay.get(today) ?? [];
  // „hátralevő rész” mód: hetek a mai hét hétfőjétől december 31-ig
  const hatra = cfg?.resz === "hatra" || cfg?.resz === "ev" ? cfg.resz === "hatra" : data.modes?.[board.id] === "hatra";
  const yearEnd = `${year}-12-31`;
  const weeks: Date[][] = [];
  if (hatra) {
    const d = new Date(today + "T00:00:00");
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    while (iso(d) <= yearEnd && weeks.length < 60) {
      const w: Date[] = [];
      for (let i = 0; i < 7; i++) { w.push(new Date(d)); d.setDate(d.getDate() + 1); }
      weeks.push(w);
    }
  }
  // kevés hét → nagy betűk; sok hét → kisebbek, hogy mindig kiférjen
  const kw = Math.max(0.55, Math.min(1.6, 10 / Math.max(1, weeks.length)));
  const wdNames = weeks[0]?.map(dt => dt.toLocaleDateString(locale, { weekday: "long", timeZone: TZ })) ?? [];
  const usedTypes = data.types.filter(t => data.entries.some(e => e.board_id === board.id && e.type_code === t.code));

  return (
    <div className="kx">
      <header className="kx-head">
        <div className="kx-title">
          <span className="kx-app">{tx.title}</span>
          <b>{pick(board.name_hu, board.name_ro)}</b>
          <span className="kx-year">{year}</span>
          {cfg && cfg.valt > 0 && data.boards.length > 1 && (
            <span className="kx-dots">
              {data.boards.map((b, i) => <i key={b.id} className={b.id === board.id ? "on" : ""} />)}
            </span>
          )}
        </div>
        <div className="kx-away">
          <span className="kx-away-l">{tx.away}:</span>
          {todays.length === 0
            ? <span className="kx-nobody">{tx.nobody}</span>
            : todays.map(e => (
                <i key={e.id} style={{ background: typeMap.get(e.type_code)?.color }}>
                  {e.name}{e.part !== "egesz" ? " ½" : ""}
                </i>
              ))}
        </div>
        <div className="kx-clock">
          <span className="kx-date">{now.toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric", timeZone: TZ })}</span>
          <b>{hhmm(now)}</b>
        </div>
      </header>

      {hatra ? (
        <div className="kx-weeks" style={{ gridTemplateRows: `2.1em repeat(${weeks.length}, minmax(0, 1fr))` }}>
          {wdNames.map((n, i) => <div key={"wd" + i} className={"kw-wd" + (i >= 5 ? " we" : "")}>{n}</div>)}
          {weeks.flat().map((dt, i) => {
            const day = iso(dt);
            if (day < today || day > yearEnd) return <div key={day} className="kw-cell kw-out" />;
            const es = byDay.get(day) ?? [];
            const hol = holidays.get(day);
            const we = i % 7 >= 5;
            const cls = "kw-cell" + (we ? " we" : "") + (hol ? " hol" : "") + (blocked.has(day) ? " blk" : "")
              + (day === today ? " today" : "");
            const showMonth = dt.getDate() === 1 || day === today;
            return (
              <div key={day} className={cls} style={{ ["--kw" as string]: kw }}>
                <div className="kw-top">
                  <b>{dt.getDate()}</b>
                  {showMonth && <span className="kw-mon">{dt.toLocaleDateString(locale, { month: "long" })}</span>}
                  {hol && <span className="kw-hol">★ {pick(hol.name_hu, hol.name_ro)}</span>}
                </div>
                <div className="kw-tags">
                  {es.map(e => (
                    <i key={e.id} style={{ background: typeMap.get(e.type_code)?.color }}>
                      {e.name}{e.part !== "egesz" ? " ½" : ""}
                    </i>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
      <div className="kx-wall">
        {Array.from({ length: 12 }, (_, m) => {
          const dim = new Date(year, m + 1, 0).getDate();
          const cur = today.slice(0, 7) === `${year}-${String(m + 1).padStart(2, "0")}`;
          return (
            <div className="kx-col" key={m}>
              <div className={"kx-month" + (cur ? " cur" : "")}>
                {new Date(year, m, 1).toLocaleDateString(locale, { month: "long" })}
              </div>
              {Array.from({ length: 31 }, (_, r) => {
                const dn = r + 1;
                if (dn > dim) return <div key={r} className="kx-cell kx-empty" />;
                const dt = new Date(year, m, dn);
                const day = iso(dt);
                const we = dt.getDay() === 0 || dt.getDay() === 6;
                const es = byDay.get(day) ?? [];
                const hol = holidays.has(day);
                const cls = "kx-cell" + (we ? " we" : "") + (hol ? " hol" : "") + (blocked.has(day) ? " blk" : "")
                  + (day === today ? " today" : day < today ? " past" : "");
                return (
                  <div key={r} className={cls}>
                    <span className="kx-dn">
                      <b>{dn}</b>
                      <em>{dt.toLocaleDateString(locale, { weekday: "short" }).replace(".", "")}</em>
                    </span>
                    {hol && <span className="kx-star">★</span>}
                    <span className={"kx-tags" + (es.length > 2 ? " many" : es.length === 2 ? " two" : "")}>
                      {es.slice(0, 4).map(e => (
                        <i key={e.id} style={{ background: typeMap.get(e.type_code)?.color }}>
                          {e.name}{e.part !== "egesz" ? " ½" : ""}
                        </i>
                      ))}
                      {es.length > 4 && <span className="kx-more">+{es.length - 4}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      )}

      <footer className="kx-foot">
        <span className="kx-legend">
          {usedTypes.map(t => (
            <span key={t.code}><i style={{ background: t.color }} />{pick(t.name_hu, t.name_ro)}</span>
          ))}
          <span><i className="sw-today" />{tx.today}</span>
          <span><i className="sw-we" />{tx.weekend}</span>
          <span><i className="sw-hol" />★ {tx.holiday}</span>
          <span><i className="sw-blk" />{tx.blocked}</span>
        </span>
        <span className={"kx-status" + (offline ? " off" : "")}>
          <i />{offline ? tx.offline : tx.updated} {lastOk ? hhmm(lastOk) : "—"}
        </span>
      </footer>
    </div>
  );
}
