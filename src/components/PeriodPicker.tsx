"use client";

// A period selector shared by the Calendar and Timesheet: prev/next arrows + a clickable
// label that opens a mini-calendar. In day view a click picks that day; in week view hover
// highlights the whole week and a click picks it; in month view the whole month. The header's
// month and year are clickable for quick jumps (no clicking arrows 12 times to reach last year).

import { useEffect, useMemo, useRef, useState } from "react";

const ALL_DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const addD = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const sameMonth = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

export function PeriodPicker({ view, cursor, label, weekStartOf, onPrev, onNext, onPick }: {
  view: "day" | "week" | "month";
  cursor: Date;
  label: string;
  weekStartOf: (d: Date) => Date;
  onPrev: () => void;
  onNext: () => void;
  onPick: (d: Date) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pane, setPane] = useState(() => new Date(cursor.getFullYear(), cursor.getMonth(), 1));
  const [sub, setSub] = useState<"days" | "months" | "years">("days");
  const [hover, setHover] = useState<Date | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const sameWeek = (a: Date, b: Date) => weekStartOf(a).getTime() === weekStartOf(b).getTime();
  const gridStart = useMemo(() => weekStartOf(new Date(pane.getFullYear(), pane.getMonth(), 1)), [pane, weekStartOf]);
  const cells = useMemo(() => Array.from({ length: 42 }, (_, i) => addD(gridStart, i)), [gridStart]);
  const dows = Array.from({ length: 7 }, (_, i) => ALL_DOW[(gridStart.getDay() + i) % 7]);
  const decadeStart = Math.floor(pane.getFullYear() / 12) * 12;

  const openPicker = () => { setPane(new Date(cursor.getFullYear(), cursor.getMonth(), 1)); setSub("days"); setHover(null); setOpen(true); };
  const pick = (d: Date) => { onPick(d); setOpen(false); };
  const inThis = () => (view === "day" ? sameDay : view === "week" ? sameWeek : sameMonth);

  return (
    <div ref={ref} className="relative flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800">
      <button onClick={onPrev} title="Previous" className="px-2 py-1.5 text-slate-400 hover:text-slate-100"><svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M15 6l-6 6 6 6" /></svg></button>
      <button onClick={() => (open ? setOpen(false) : openPicker())} className="min-w-[11rem] px-1 py-1.5 text-center text-xs font-medium text-slate-200 hover:text-white">{label}</button>
      <button onClick={onNext} title="Next" className="px-2 py-1.5 text-slate-400 hover:text-slate-100"><svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M9 6l6 6-6 6" /></svg></button>

      {open && (
        <div className="absolute left-1/2 top-full z-50 mt-1.5 w-64 -translate-x-1/2 rounded-xl border border-slate-700 bg-slate-900 p-2 shadow-2xl">
          <div className="flex items-center justify-between pb-2">
            <button onClick={() => setPane((p) => new Date(p.getFullYear(), p.getMonth() - 1, 1))} title="Previous month" className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"><svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M15 6l-6 6 6 6" /></svg></button>
            <div className="flex items-center gap-1 text-xs font-medium text-slate-200">
              <button onClick={() => setSub((s) => (s === "months" ? "days" : "months"))} className="rounded px-1.5 py-0.5 hover:bg-slate-800">{MONTHS[pane.getMonth()]}</button>
              <button onClick={() => setSub((s) => (s === "years" ? "days" : "years"))} className="rounded px-1.5 py-0.5 hover:bg-slate-800">{pane.getFullYear()}</button>
            </div>
            <button onClick={() => setPane((p) => new Date(p.getFullYear(), p.getMonth() + 1, 1))} title="Next month" className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"><svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M9 6l6 6-6 6" /></svg></button>
          </div>

          {sub === "days" && (
            <>
              <div className="grid grid-cols-7 text-center text-[9px] uppercase text-slate-600">{dows.map((d, i) => <div key={i} className="py-0.5">{d}</div>)}</div>
              <div className="grid grid-cols-7" onMouseLeave={() => setHover(null)}>
                {cells.map((d) => {
                  const inMonth = d.getMonth() === pane.getMonth();
                  const isToday = sameDay(d, new Date());
                  const selected = inThis()(d, cursor);
                  const hovered = !!hover && inThis()(d, hover);
                  return (
                    <button key={d.toISOString()} onMouseEnter={() => setHover(d)} onClick={() => pick(d)}
                      className={`m-px h-7 rounded text-[11px] transition-colors ${selected ? "bg-indigo-600 font-semibold text-white" : hovered ? "bg-indigo-500/30 text-indigo-100" : inMonth ? "text-slate-200 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-800"} ${isToday && !selected ? "ring-1 ring-inset ring-indigo-500/60" : ""}`}>{d.getDate()}</button>
                  );
                })}
              </div>
            </>
          )}

          {sub === "months" && (
            <div className="grid grid-cols-3 gap-1">
              {MONTHS.map((m, i) => (
                <button key={m} onClick={() => { setPane(new Date(pane.getFullYear(), i, 1)); setSub("days"); }}
                  className={`rounded px-1 py-2.5 text-[11px] ${i === cursor.getMonth() && pane.getFullYear() === cursor.getFullYear() ? "bg-indigo-600 font-semibold text-white" : "text-slate-200 hover:bg-slate-800"}`}>{m.slice(0, 3)}</button>
              ))}
            </div>
          )}

          {sub === "years" && (
            <div>
              <div className="grid grid-cols-4 gap-1">
                {Array.from({ length: 12 }, (_, i) => decadeStart + i).map((y) => (
                  <button key={y} onClick={() => { setPane(new Date(y, pane.getMonth(), 1)); setSub("days"); }}
                    className={`rounded px-1 py-2.5 text-[11px] ${y === cursor.getFullYear() ? "bg-indigo-600 font-semibold text-white" : "text-slate-200 hover:bg-slate-800"}`}>{y}</button>
                ))}
              </div>
              <div className="mt-1 flex justify-between">
                <button onClick={() => setPane((p) => new Date(p.getFullYear() - 12, p.getMonth(), 1))} className="rounded px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-800">‹ earlier</button>
                <button onClick={() => setPane((p) => new Date(p.getFullYear() + 12, p.getMonth(), 1))} className="rounded px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-800">later ›</button>
              </div>
            </div>
          )}

          <div className="mt-2 flex items-center justify-between border-t border-slate-800 pt-2">
            <span className="px-1 text-[10px] uppercase tracking-wide text-slate-600">{view}</span>
            <button onClick={() => pick(new Date())} className="rounded px-2 py-0.5 text-[11px] text-indigo-300 hover:text-indigo-200">Today</button>
          </div>
        </div>
      )}
    </div>
  );
}
