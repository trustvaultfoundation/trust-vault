"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { colorAt, type Series, type MultiSeries, type TableData } from "@/lib/dashboard";

function Empty() {
  return <div className="flex-1 min-h-0 flex items-center justify-center text-xs text-slate-600">No data in this period</div>;
}

// Compact axis number: 1.2k, 12, 0.0016 …
function fmtAxis(n: number): string {
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (abs >= 1) return Number.isInteger(n) ? String(n) : n.toFixed(1);
  return Number(n.toPrecision(2)).toString();
}

// Left value (Y) axis: max / mid / 0 ticks, fixed width so the plot + the X
// labels below line up. `fmt` lets an hours widget label the ticks as durations.
function YAxis({ max, fmt = fmtAxis }: { max: number; fmt?: (n: number) => string }) {
  return (
    <div className="flex w-10 shrink-0 flex-col justify-between py-0.5 pr-1 text-right text-[9px] tabular-nums text-slate-500">
      <span>{fmt(max)}</span>
      <span>{fmt(max / 2)}</span>
      <span>0</span>
    </div>
  );
}

// CSS column chart with axes — each bar uses its baked-in positional colour, so
// the 1st/2nd/… bar matches across charts (single-metric widgets are one colour).
export function BarChart({ series, valueFmt, axisFmt }: { series: Series[]; valueFmt?: (n: number) => string; axisFmt?: (n: number) => string }) {
  const vf = valueFmt ?? fmtAxis;
  const af = axisFmt ?? valueFmt ?? fmtAxis;
  // Bars only show periods/categories that actually have a value — no empty
  // 0-height bars (e.g. AR Spent over a sparse window). The 0s live on the line.
  const data = series.filter((s) => s.value !== 0);
  if (data.length === 0) return <Empty />;
  const max = Math.max(...data.map((s) => s.value), 1);
  const labelStep = Math.max(1, Math.ceil(data.length / 12));
  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="flex flex-1 min-h-0">
        <YAxis max={max} fmt={af} />
        <div className="flex flex-1 items-end gap-1.5 overflow-hidden border-b border-l border-slate-700/70 px-1 pb-px">
          {data.map((s) => (
            <div key={s.label} className="group flex h-full flex-1 flex-col items-center justify-end" title={`${s.label}: ${vf(s.value)}`}>
              <span className="mb-0.5 text-[9px] tabular-nums text-slate-400">{vf(s.value)}</span>
              <div className="w-full max-w-[2.5rem] rounded-t opacity-90 transition-[height] group-hover:opacity-100" style={{ height: `${Math.max(2, (s.value / max) * 100)}%`, background: s.color ?? colorAt(0) }} />
            </div>
          ))}
        </div>
      </div>
      <div className="flex">
        <div className="w-10 shrink-0" />
        <div className="flex flex-1 gap-1.5 px-1 pt-1">
          {data.map((s, i) => (
            <span key={s.label} className="min-w-0 flex-1 truncate text-center text-[9px] text-slate-500" title={s.label}>{i % labelStep === 0 ? s.label : ""}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// Plot Y bounds (value 0 → 98, value max → 2). Clamping the bezier control
// points to this range keeps the WHOLE curve inside it (a bezier lives in the
// convex hull of its control points), so a line that touches 0 never dips below.
const Y_TOP = 2;
const Y_BASE = 98;
const clampY = (y: number) => Math.max(Y_TOP, Math.min(Y_BASE, y));

// Catmull-Rom → cubic-bezier smoothing so the lines are curved, not jagged.
function smoothPath(pts: [number, number][]): string {
  if (pts.length === 0) return "";
  // A single bucket → a flat line at that value (otherwise it'd be invisible).
  if (pts.length === 1) return `M0 ${pts[0][1].toFixed(2)} L100 ${pts[0][1].toFixed(2)}`;
  let d = `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = clampY(p1[1] + (p2[1] - p0[1]) / 6);
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = clampY(p2[1] - (p3[1] - p1[1]) / 6);
    d += ` C${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d;
}

// Hover popup that lives INSIDE the plot. It opens to the right of the crosshair
// by default, but measures itself against the plot width and flips to the left
// when the right side would clip — so on the left half it opens right, on the
// right half it opens left, and it never spills outside the card.
function InlineTip({
  leftPct,
  plotRef,
  bucket,
  rows,
  fmt = fmtAxis,
}: {
  leftPct: number;
  plotRef: React.RefObject<HTMLDivElement | null>;
  bucket: string;
  rows: { name: string; value: number; color: string }[];
  fmt?: (n: number) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [flipLeft, setFlipLeft] = useState(false);
  useLayoutEffect(() => {
    const plot = plotRef.current;
    const el = ref.current;
    if (!plot || !el) return;
    const plotW = plot.clientWidth;
    const tipW = el.offsetWidth;
    const crossPx = (leftPct / 100) * plotW;
    const gap = 8;
    const fitsRight = crossPx + gap + tipW <= plotW;
    // Prefer the right; flip left only when the right would clip (and the left
    // either fits or simply has more room).
    setFlipLeft(!fitsRight && (crossPx - gap - tipW >= 0 || crossPx > plotW - crossPx));
  }, [leftPct, plotRef, rows]);
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute top-1 z-20 min-w-[90px] rounded-md border border-slate-700 bg-slate-900/95 px-2 py-1 text-[10px] shadow-xl"
      style={{ left: `${leftPct}%`, transform: flipLeft ? "translateX(calc(-100% - 6px))" : "translateX(6px)" }}
    >
      <div className="mb-0.5 font-medium text-slate-200">{bucket}</div>
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 shrink-0 rounded-sm" style={{ background: r.color }} />
          <span className="max-w-[80px] truncate text-slate-400">{r.name}</span>
          <span className="ml-auto pl-2 tabular-nums text-slate-100">{fmt(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

// Multi-line SVG chart: one curved, coloured line per category over time. Points
// span edge-to-edge; a synchronised hover crosshair shows the time + each value
// (the popup flips side to stay inside the card); legend sits BELOW. Click-drag
// picks a time range (highlighted on every line chart) and commits it as the custom range.
export function LineChart({
  multi,
  hoverBucket,
  onHover,
  win,
  brush,
  onBrush,
  onBrushCommit,
  valueFmt,
  axisFmt,
}: {
  multi: MultiSeries[];
  hoverBucket?: string | null;
  onHover?: (bucket: string | null) => void;
  win?: { start: number; end: number };
  brush?: { start: number; end: number } | null;
  onBrush?: (b: { start: number; end: number } | null) => void;
  onBrushCommit?: (b: { start: number; end: number }) => void;
  valueFmt?: (n: number) => string;
  axisFmt?: (n: number) => string;
}) {
  const vf = valueFmt ?? fmtAxis;
  const af = axisFmt ?? valueFmt ?? fmtAxis;
  const lines = multi.filter((m) => m.points.length > 0);
  const plotRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<number | null>(null);
  const [hovering, setHovering] = useState(false);
  if (lines.length === 0) return <Empty />;
  const buckets = lines[0].points.map((p) => p.label);
  const n = buckets.length;
  const max = Math.max(1, ...lines.flatMap((m) => m.points.map((p) => p.value)));
  const xAt = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100); // edge to edge
  const yAt = (v: number) => 98 - (v / max) * 96;
  const MAX_LABELS = 8;
  const labelIdxs = n <= MAX_LABELS ? buckets.map((_, i) => i) : Array.from({ length: MAX_LABELS }, (_, k) => Math.round((k * (n - 1)) / (MAX_LABELS - 1)));
  const active = hoverBucket != null ? buckets.indexOf(hoverBucket) : -1;

  const span = win ? Math.max(1, win.end - win.start) : 1;
  const timeAtClientX = (clientX: number) => {
    const r = plotRef.current?.getBoundingClientRect();
    if (!r || !win) return win?.start ?? 0;
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return win.start + f * span;
  };
  const xOfTime = (t: number) => (win ? ((t - win.start) / span) * 100 : 0);
  const brushX = brush && win ? { x0: Math.max(0, xOfTime(brush.start)), x1: Math.min(100, xOfTime(brush.end)) } : null;

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (dragStart.current != null) return; // brushing → suppress hover
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = rect.width ? (e.clientX - rect.left) / rect.width : 0;
    const idx = n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1))));
    onHover?.(buckets[idx]);
  };

  const handleDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!win || !onBrush) return;
    e.preventDefault();
    const t0 = timeAtClientX(e.clientX);
    dragStart.current = t0;
    onHover?.(null);
    onBrush({ start: t0, end: t0 });
    const move = (ev: MouseEvent) => {
      const t1 = timeAtClientX(ev.clientX);
      onBrush({ start: Math.min(t0, t1), end: Math.max(t0, t1) });
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      const t1 = timeAtClientX(ev.clientX);
      dragStart.current = null;
      onBrushCommit?.({ start: Math.min(t0, t1), end: Math.max(t0, t1) });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="flex flex-1 min-h-0">
        <YAxis max={max} fmt={af} />
        <div
          ref={plotRef}
          className="relative flex-1 select-none border-b border-l border-slate-700/70 cursor-crosshair"
          onMouseMove={handleMove}
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => { setHovering(false); if (dragStart.current == null) onHover?.(null); }}
          onMouseDown={handleDown}
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
            {lines.map((m) => (
              <path
                key={m.name}
                d={smoothPath(m.points.map((p, i) => [xAt(i), yAt(p.value)] as [number, number]))}
                fill="none"
                stroke={m.color ?? colorAt(0)}
                strokeWidth={1.6}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
          </svg>
          {/* drag-select highlight (shared across all line charts) */}
          {brushX && brushX.x1 > brushX.x0 && (
            <div className="pointer-events-none absolute top-0 bottom-0 border-x border-indigo-400/50 bg-indigo-400/15" style={{ left: `${brushX.x0}%`, width: `${brushX.x1 - brushX.x0}%` }} />
          )}
          {/* hover crosshair + dots (hidden while brushing) */}
          {active >= 0 && !brush && (
            <>
              <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-slate-500/40" style={{ left: `${xAt(active)}%` }} />
              {lines.map((m) => (
                <div
                  key={m.name}
                  className="pointer-events-none absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-slate-900"
                  style={{ left: `${xAt(active)}%`, top: `${yAt(m.points[active].value)}%`, background: m.color ?? colorAt(0) }}
                />
              ))}
              {/* popup only on the chart under the cursor (crosshair stays synced on all) */}
              {hovering && (
                <InlineTip
                  leftPct={xAt(active)}
                  plotRef={plotRef}
                  bucket={buckets[active]}
                  rows={lines.map((m) => ({ name: m.name, value: m.points[active].value, color: m.color ?? colorAt(0) }))}
                  fmt={vf}
                />
              )}
            </>
          )}
        </div>
      </div>
      {/* X axis labels — anchored at each point's REAL x-position (edge-to-edge, same as the
          line + crosshair), so the label under a point lines up with it. First/last labels
          align to the plot edges; the rest are centred on their point. */}
      <div className="flex">
        <div className="w-10 shrink-0" />
        <div className="relative h-3.5 flex-1">
          {labelIdxs.map((i) => (
            <span
              key={i}
              title={buckets[i]}
              className="absolute top-0 max-w-[64px] truncate text-[9px] text-slate-500"
              style={{ left: `${xAt(i)}%`, transform: i === 0 ? "translateX(0)" : i === n - 1 ? "translateX(-100%)" : "translateX(-50%)" }}
            >
              {buckets[i]}
            </span>
          ))}
        </div>
      </div>
      {/* legend BELOW the chart */}
      {lines.length > 1 && (
        <div className="mt-1.5 flex max-h-12 flex-wrap gap-x-2.5 gap-y-0.5 overflow-y-auto border-t border-slate-800 pt-1.5">
          {lines.map((m) => (
            <span key={m.name} className="flex items-center gap-1 text-[9px] text-slate-400" title={m.name}>
              <span className="inline-block h-2 w-2 shrink-0 rounded-sm" style={{ background: m.color ?? colorAt(0) }} />
              <span className="max-w-[90px] truncate">{m.name}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function DataTable({ table }: { table: TableData }) {
  if (table.rows.length === 0) return <Empty />;
  return (
    <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-slate-800">
      <table className="w-full text-xs">
        <thead className="sticky top-0 z-10 bg-slate-900 text-slate-400">
          <tr>
            {table.columns.map((c) => (
              <th key={c} className="px-2.5 py-1.5 text-left font-medium whitespace-nowrap">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-800/70 hover:bg-slate-800/30">
              {r.map((c, j) => (
                <td key={j} className="max-w-[200px] truncate px-2.5 py-1.5 text-slate-300" title={String(c)}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StatView({ value, sub }: { value: string; sub?: string }) {
  return (
    <div className="flex flex-1 min-h-0 flex-col items-center justify-center text-center">
      <span className="text-4xl font-bold tracking-tight text-white tabular-nums">{value}</span>
      {sub && <span className="mt-1 text-xs text-slate-500">{sub}</span>}
    </div>
  );
}
