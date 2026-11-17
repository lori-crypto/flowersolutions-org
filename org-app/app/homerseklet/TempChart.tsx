"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Point } from "@/lib/temp";
import s from "./homerseklet.module.css";

// Egyszerű, függőség nélküli SVG-grafikon:
//  • sáv = a gyűjtőablak min–max értéke, vonal = átlag
//  • szaggatott vonalak = riasztási határok
//  • ahol kimaradt az adat (áramszünet), ott a vonal megszakad

type Props = {
  points: Point[]; from: Date; to: Date;
  maxTemp: number | null; minTemp: number | null; critTemp: number | null;
  locale: string;
};

const H = 260, PAD = { l: 44, r: 12, t: 12, b: 28 };

export default function TempChart({ points, from, to, maxTemp, minTemp, critTemp, locale }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(280, el.clientWidth)));
    ro.observe(el);
    setW(Math.max(280, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const g = useMemo(() => {
    const t0 = from.getTime(), t1 = to.getTime();
    const vals = points.flatMap(p => [p.t_min, p.t_max]);
    for (const v of [maxTemp, minTemp, critTemp]) if (v != null) vals.push(v);
    let lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 10;
    if (hi - lo < 4) { const m = (hi + lo) / 2; lo = m - 2; hi = m + 2; }
    lo = Math.floor(lo - 0.5); hi = Math.ceil(hi + 0.5);
    const iw = w - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
    const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0)) * iw;
    const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * ih;

    // szakaszokra bontás: ha két pont között a szokásos lépés 3×-osánál nagyobb a rés
    const times = points.map(p => new Date(p.ts).getTime());
    const steps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
    const step = steps.length ? steps[Math.floor(steps.length / 2)] : 60_000;
    const segs: number[][] = [];
    times.forEach((t, i) => {
      if (i === 0 || t - times[i - 1] > step * 3) segs.push([]);
      segs[segs.length - 1].push(i);
    });
    const band = segs.map(sg => {
      const top = sg.map(i => `${x(times[i])},${y(points[i].t_max)}`);
      const bot = sg.slice().reverse().map(i => `${x(times[i])},${y(points[i].t_min)}`);
      return top.concat(bot).join(" ");
    });
    const lines = segs.map(sg => sg.map(i => `${x(times[i])},${y(points[i].t_avg)}`).join(" "));

    // tengelyfeliratok
    const yTicks: number[] = [];
    const ystep = hi - lo > 20 ? 5 : hi - lo > 8 ? 2 : 1;
    for (let v = Math.ceil(lo / ystep) * ystep; v <= hi; v += ystep) yTicks.push(v);
    const span = t1 - t0, n = Math.max(2, Math.floor(iw / 90));
    const xTicks = Array.from({ length: n + 1 }, (_, i) => t0 + (span * i) / n);
    const fmtX = (t: number) => new Date(t).toLocaleString(locale, span <= 36 * 3600_000
      ? { hour: "2-digit", minute: "2-digit" }
      : span <= 8 * 86400_000 ? { weekday: "short", hour: "2-digit" } : { month: "short", day: "numeric" });
    return { x, y, band, lines, yTicks, xTicks, fmtX, times, iw };
  }, [points, from, to, maxTemp, minTemp, critTemp, w, locale]);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!points.length) return;
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * w;
    let best = 0, bd = Infinity;
    g.times.forEach((t, i) => { const d = Math.abs(g.x(t) - px); if (d < bd) { bd = d; best = i; } });
    setHover(best);
  };

  const fmtT = (v: number) => v.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " °C";
  const hp = hover != null ? points[hover] : null;

  return (
    <div ref={wrap} className={s.chartWrap}>
      <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} className={s.chart}
           onPointerMove={onMove} onPointerLeave={() => setHover(null)}
           role="img" aria-label="Hőmérséklet-grafikon">
        {g.yTicks.map(v => (
          <g key={v}>
            <line x1={PAD.l} x2={w - PAD.r} y1={g.y(v)} y2={g.y(v)} className={s.grid} />
            <text x={PAD.l - 6} y={g.y(v) + 4} textAnchor="end" className={s.tick}>{v}°</text>
          </g>
        ))}
        {g.xTicks.map(t => (
          <text key={t} x={g.x(t)} y={H - 8} textAnchor="middle" className={s.tick}>{g.fmtX(t)}</text>
        ))}
        {critTemp != null && <line x1={PAD.l} x2={w - PAD.r} y1={g.y(critTemp)} y2={g.y(critTemp)} className={s.thrCrit} />}
        {maxTemp != null && <line x1={PAD.l} x2={w - PAD.r} y1={g.y(maxTemp)} y2={g.y(maxTemp)} className={s.thrMax} />}
        {minTemp != null && <line x1={PAD.l} x2={w - PAD.r} y1={g.y(minTemp)} y2={g.y(minTemp)} className={s.thrMin} />}
        {g.band.map((p, i) => <polygon key={"b" + i} points={p} className={s.band} />)}
        {g.lines.map((p, i) => <polyline key={"l" + i} points={p} className={s.line} />)}
        {hp && (
          <g>
            <line x1={g.x(g.times[hover!])} x2={g.x(g.times[hover!])} y1={PAD.t} y2={H - PAD.b} className={s.cursor} />
            <circle cx={g.x(g.times[hover!])} cy={g.y(hp.t_avg)} r={4} className={s.dot} />
          </g>
        )}
      </svg>
      {!points.length && <div className={s.noData}>Ebben az időszakban nincs mérés.</div>}
      {hp && (
        <div className={s.tip}>
          <b>{new Date(hp.ts).toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</b>
          {" · "}{fmtT(hp.t_avg)}
          {hp.t_max - hp.t_min >= 0.1 && <span> ({fmtT(hp.t_min)} … {fmtT(hp.t_max)})</span>}
        </div>
      )}
    </div>
  );
}
