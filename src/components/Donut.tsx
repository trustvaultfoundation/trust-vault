"use client";

import { useRef, useState } from "react";

export interface DonutItem { label: string; pct: number; color: string }

// A donut chart (percentages should total 100). Hovering a segment shows its label, % and — when
// `total` is given — the absolute amount. Used by the board status donut.
export function Donut({ items, size = 150, total, unit }: { items: DonutItem[]; size?: number; total?: number; unit?: string }) {
  const cx = size / 2;
  const r = size / 2 - 23;
  const c = 2 * Math.PI * r;
  const wrap = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);

  const at = (e: React.MouseEvent, i: number) => {
    const box = wrap.current?.getBoundingClientRect();
    if (!box) return;
    setHover({ i, x: e.clientX - box.left, y: e.clientY - box.top });
  };

  let offset = 0;
  const ha = hover ? items[hover.i] : null;
  return (
    <div ref={wrap} className="relative inline-block" onMouseLeave={() => setHover(null)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90">
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="#1e293b" strokeWidth="20" />
        {items.map((a, i) => {
          const len = (a.pct / 100) * c;
          const seg = (
            <circle
              key={a.label}
              cx={cx} cy={cx} r={r} fill="none" stroke={a.color}
              strokeWidth={hover?.i === i ? 24 : 20}
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              className="cursor-pointer transition-[stroke-width]"
              onMouseEnter={(e) => at(e, i)}
              onMouseMove={(e) => at(e, i)}
            />
          );
          offset += len;
          return seg;
        })}
      </svg>
      {ha && (
        <div className="pointer-events-none absolute z-50 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs shadow-xl" style={{ left: hover!.x, top: hover!.y - 8 }}>
          <div className="flex items-center gap-1.5 font-medium text-slate-100"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: ha.color }} />{ha.label}</div>
          <div className="mt-0.5 text-slate-400">
            {ha.pct}%{total != null && <> · {Math.round((ha.pct / 100) * total).toLocaleString("en-US")}{unit ? ` ${unit}` : ""}</>}
          </div>
        </div>
      )}
    </div>
  );
}
