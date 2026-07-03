"use client";

// A time input you can TYPE (HH:MM) OR pick: a clock icon sits inside the field on the right and
// opens the same custom hour/minute picker used on the dashboard. Output is always "HH:MM" so it
// drops into the existing from/to / start/end logic unchanged. The popover is portalled and
// screen-aware (placePopover), so it's never cut off near an edge.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { placePopover } from "@/lib/popover";

const pad = (n: number) => String(n).padStart(2, "0");
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINS = Array.from({ length: 60 }, (_, i) => i);

// Accepts "9", "930", "9:30", "9.3", "9h30" → "09:30". Empty stays empty; junk is left as typed.
function normalize(s: string): string {
  const t = s.trim();
  if (!t) return "";
  const m = t.match(/^(\d{1,2})\s*[:.h]?\s*(\d{0,2})$/i);
  if (!m) return t;
  const h = Math.min(23, parseInt(m[1], 10) || 0);
  const mi = Math.min(59, parseInt(m[2] || "0", 10) || 0);
  return `${pad(h)}:${pad(mi)}`;
}

export function TimeField({ value, onChange, placeholder = "HH:MM", className, disabled }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const hCol = useRef<HTMLDivElement>(null);
  const mCol = useRef<HTMLDivElement>(null);

  useEffect(() => { setText(value); }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { const t = e.target as Node; if (popRef.current?.contains(t) || wrapRef.current?.contains(t)) return; setOpen(false); };
    // Close when the PAGE scrolls, but NOT when the picker's own hour/minute column scrolls
    // (scrolling the selected value into view would otherwise close it instantly).
    const onScroll = (e: Event) => { if (popRef.current && e.target instanceof Node && popRef.current.contains(e.target)) return; setOpen(false); };
    const onResize = () => setOpen(false);
    document.addEventListener("mousedown", onDoc, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => { document.removeEventListener("mousedown", onDoc, true); window.removeEventListener("resize", onResize); window.removeEventListener("scroll", onScroll, true); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      hCol.current?.querySelector<HTMLElement>("[data-sel]")?.scrollIntoView({ block: "center" });
      mCol.current?.querySelector<HTMLElement>("[data-sel]")?.scrollIntoView({ block: "center" });
    });
  }, [open]);

  const [h, m] = (value || "").split(":");
  const hour = h === undefined || h === "" ? null : Number(h);
  const min = m === undefined || m === "" ? null : Number(m);

  const commit = () => { const v = normalize(text); setText(v); if (v !== value) onChange(v); };
  const openPicker = () => { if (disabled) return; const r = wrapRef.current!.getBoundingClientRect(); setPos(placePopover(r, 168, 248)); setOpen(true); };
  const setH = (n: number) => onChange(`${pad(n)}:${pad(min ?? 0)}`);
  const setM = (n: number) => onChange(`${pad(hour ?? 0)}:${pad(n)}`);

  return (
    <div ref={wrapRef} className="relative">
      <input
        value={text} disabled={disabled} placeholder={placeholder} inputMode="numeric" maxLength={5}
        onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
        className={className} style={{ paddingRight: 26 }}
      />
      <button type="button" disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => (open ? setOpen(false) : openPicker())}
        title="Pick time" className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 disabled:opacity-50">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="9" /><path strokeLinecap="round" d="M12 7.5V12l3 2" /></svg>
      </button>
      {open && pos && createPortal(
        <div ref={popRef} data-dateinput-pop="" style={{ position: "fixed", top: pos.top, left: pos.left, width: 168 }} className="z-[200] rounded-xl border border-slate-700 bg-slate-900 p-2 shadow-2xl">
          <div className="mb-1.5 text-center text-sm font-semibold tabular-nums text-slate-200">{pad(hour ?? 0)}<span className="text-slate-600">:</span>{pad(min ?? 0)}</div>
          <div className="grid grid-cols-2 gap-1.5">
            <Column label="Hour" colRef={hCol} items={HOURS} active={hour} onPick={setH} />
            <Column label="Min" colRef={mCol} items={MINS} active={min} onPick={setM} />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function Column({ label, items, active, onPick, colRef }: { label: string; items: number[]; active: number | null; onPick: (n: number) => void; colRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div>
      <div className="pb-1 text-center text-[9px] uppercase tracking-wide text-slate-600">{label}</div>
      <div ref={colRef} className="h-40 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/40 p-1 [scrollbar-width:thin]">
        {items.map((n) => {
          const sel = n === active;
          return (
            <button key={n} type="button" {...(sel ? { "data-sel": "" } : {})} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(n)}
              className={`block w-full rounded-md py-1 text-center text-[11px] tabular-nums transition-colors ${sel ? "bg-indigo-600 font-semibold text-white" : "text-slate-300 hover:bg-slate-800"}`}>{pad(n)}</button>
          );
        })}
      </div>
    </div>
  );
}
