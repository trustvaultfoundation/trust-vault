"use client";

// A styled single-date picker that replaces native <input type="date"> everywhere. It shows a
// button (matching our inputs) and opens the same calendar-popover used by the period selector,
// with quick month/year jumps. The popover is portalled + fixed-positioned so it's never clipped
// by a scrollable modal. Value is a YYYY-MM-DD string ("" = empty).

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { placePopover } from "@/lib/popover";

const DOW = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addD = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const gridStart = (d: Date) => { const x = new Date(d.getFullYear(), d.getMonth(), 1); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }; // Monday-start

export function DateInput({ value, onChange, placeholder = "Pick a date", min, max, disabled, clearable, className }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  clearable?: boolean;
  className?: string;
}) {
  const sel = value ? new Date(value + "T00:00:00") : null;
  const [open, setOpen] = useState(false);
  const [pane, setPane] = useState(() => sel ?? new Date());
  const [sub, setSub] = useState<"days" | "months" | "years">("days");
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { const t = e.target as Node; if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return; setOpen(false); };
    const onScroll = (e: Event) => { if (popRef.current && e.target instanceof Node && popRef.current.contains(e.target)) return; setOpen(false); };
    const onResize = () => setOpen(false);
    document.addEventListener("mousedown", onDoc, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => { document.removeEventListener("mousedown", onDoc, true); window.removeEventListener("resize", onResize); window.removeEventListener("scroll", onScroll, true); };
  }, [open]);

  const openPicker = () => {
    if (disabled) return;
    const r = btnRef.current!.getBoundingClientRect();
    setPos(placePopover(r, 256, 320));
    setPane(sel ?? new Date());
    setSub("days");
    setOpen(true);
  };

  const cells = useMemo(() => { const start = gridStart(new Date(pane.getFullYear(), pane.getMonth(), 1)); return Array.from({ length: 42 }, (_, i) => addD(start, i)); }, [pane]);
  const minD = min ? new Date(min + "T00:00:00") : null;
  const maxD = max ? new Date(max + "T00:00:00") : null;
  const off = (d: Date) => (!!minD && d < minD) || (!!maxD && d > maxD);
  const pick = (d: Date) => { if (off(d)) return; onChange(ymd(d)); setOpen(false); };
  const label = sel ? sel.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : placeholder;
  const decadeStart = Math.floor(pane.getFullYear() / 12) * 12;
  const base = className ?? "w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none";

  return (
    <>
      <button ref={btnRef} type="button" disabled={disabled} onClick={() => (open ? setOpen(false) : openPicker())} className={`${base} flex items-center gap-1.5 text-left disabled:opacity-60`}>
        <svg className="h-3.5 w-3.5 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="5" width="18" height="16" rx="2" /><path strokeLinecap="round" d="M3 9.5h18M8 3.5v3M16 3.5v3" /></svg>
        <span className={`flex-1 truncate ${sel ? "" : "text-slate-500"}`}>{label}</span>
      </button>
      {open && pos && createPortal(
        <div ref={popRef} data-dateinput-pop="" style={{ position: "fixed", top: pos.top, left: pos.left, width: 256 }} className="z-[200] rounded-xl border border-slate-700 bg-slate-900 p-2 shadow-2xl">
          <div className="flex items-center justify-between pb-2">
            <button type="button" onClick={() => setPane((p) => new Date(p.getFullYear(), p.getMonth() - 1, 1))} title="Previous month" className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"><svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M15 6l-6 6 6 6" /></svg></button>
            <div className="flex items-center gap-1 text-xs font-medium text-slate-200">
              <button type="button" onClick={() => setSub((s) => (s === "months" ? "days" : "months"))} className="rounded px-1.5 py-0.5 hover:bg-slate-800">{MONTHS[pane.getMonth()]}</button>
              <button type="button" onClick={() => setSub((s) => (s === "years" ? "days" : "years"))} className="rounded px-1.5 py-0.5 hover:bg-slate-800">{pane.getFullYear()}</button>
            </div>
            <button type="button" onClick={() => setPane((p) => new Date(p.getFullYear(), p.getMonth() + 1, 1))} title="Next month" className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"><svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M9 6l6 6-6 6" /></svg></button>
          </div>

          {sub === "days" && (
            <>
              <div className="grid grid-cols-7 text-center text-[9px] uppercase text-slate-600">{DOW.map((d, i) => <div key={i} className="py-0.5">{d}</div>)}</div>
              <div className="grid grid-cols-7">
                {cells.map((d) => {
                  const inMonth = d.getMonth() === pane.getMonth();
                  const isToday = sameDay(d, new Date());
                  const selected = sel && sameDay(d, sel);
                  const disabledDay = off(d);
                  return (
                    <button type="button" key={d.toISOString()} disabled={disabledDay} onClick={() => pick(d)}
                      className={`m-px h-7 rounded text-[11px] transition-colors ${selected ? "bg-indigo-600 font-semibold text-white" : disabledDay ? "text-slate-700" : inMonth ? "text-slate-200 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-800"} ${isToday && !selected ? "ring-1 ring-inset ring-indigo-500/60" : ""}`}>{d.getDate()}</button>
                  );
                })}
              </div>
            </>
          )}

          {sub === "months" && (
            <div className="grid grid-cols-3 gap-1">
              {MONTHS.map((m, i) => <button type="button" key={m} onClick={() => { setPane(new Date(pane.getFullYear(), i, 1)); setSub("days"); }} className={`rounded px-1 py-2.5 text-[11px] ${sel && i === sel.getMonth() && pane.getFullYear() === sel.getFullYear() ? "bg-indigo-600 font-semibold text-white" : "text-slate-200 hover:bg-slate-800"}`}>{m.slice(0, 3)}</button>)}
            </div>
          )}

          {sub === "years" && (
            <div>
              <div className="grid grid-cols-4 gap-1">
                {Array.from({ length: 12 }, (_, i) => decadeStart + i).map((y) => <button type="button" key={y} onClick={() => { setPane(new Date(y, pane.getMonth(), 1)); setSub("days"); }} className={`rounded px-1 py-2.5 text-[11px] ${sel && y === sel.getFullYear() ? "bg-indigo-600 font-semibold text-white" : "text-slate-200 hover:bg-slate-800"}`}>{y}</button>)}
              </div>
              <div className="mt-1 flex justify-between">
                <button type="button" onClick={() => setPane((p) => new Date(p.getFullYear() - 12, p.getMonth(), 1))} className="rounded px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-800">‹ earlier</button>
                <button type="button" onClick={() => setPane((p) => new Date(p.getFullYear() + 12, p.getMonth(), 1))} className="rounded px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-800">later ›</button>
              </div>
            </div>
          )}

          <div className="mt-2 flex items-center justify-between border-t border-slate-800 pt-2">
            {clearable && value ? <button type="button" onClick={() => { onChange(""); setOpen(false); }} className="rounded px-2 py-0.5 text-[11px] text-slate-400 hover:text-rose-300">Clear</button> : <span />}
            <button type="button" onClick={() => pick(new Date())} className="rounded px-2 py-0.5 text-[11px] text-indigo-300 hover:text-indigo-200">Today</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
