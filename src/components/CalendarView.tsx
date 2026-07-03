"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CalEvent, CalEventType, CalTicketDue, Occurrence, Recurrence, RecurFreq, EVENT_TYPES, eventTypeMeta, REMINDER_OPTIONS,
  loadEvents, saveEvents, newEvent, boardTicketDues, isoDate, parseISO, expandRange, generateMeetingLink, recurrenceLabel,
  detachOccurrence, withExdate, shiftSeriesTo,
  eventLink, meetingJoinUrl, mapsUrl, placeSearch, PlaceHit, loadSharedEvents, saveSharedEvents, setMuted, isMuted,
  loadPins, savePins, pinsByDay, type CalPin,
} from "@/lib/calendar";
import { shareEvent, deleteSharedEvent, discoverSharedOwners, unwrapOwnerKey, loadOwnerKey, foldOwnerEvents } from "@/lib/calendarSync";
import { itsmDues, itsmMeta, type ItsmDue } from "@/lib/itsm";
import { RelatedLinks } from "./RelatedLinks";
import { PeriodPicker } from "./PeriodPicker";
import { DateInput } from "./DateInput";
import { MentionInput } from "./MentionInput";
import { MentionText } from "./MentionText";
import { TimeField } from "./TimeField";
import { mentionPeople } from "@/lib/mentions";
import { ThemedSelect } from "./BoardDropdowns";
import { loadBoards, loadBoardState, boardProjects } from "@/lib/board";
import { loadIdentities } from "@/lib/accessKeys";
import { ensureNotifyPermission } from "@/lib/useCalendarReminders";

type Toast = (m: string, t?: "error" | "info" | "warning") => void;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const HOUR_H = 44; // px per hour in the week grid
const SNAP = 15; // minutes the drag-to-create snaps to
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const addDays = (d: Date, n: number) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
const weekStart = (d: Date) => addDays(d, -d.getDay()); // Sunday 00:00
const minToHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const hhmmToMin = (s?: string) => { if (!s) return null; const [h, m] = s.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const snap = (m: number) => Math.max(0, Math.min(1440, Math.round(m / SNAP) * SNAP));
const shortAddr = (a: string) => (a && a.length > 10 ? `${a.slice(0, 5)}…${a.slice(-4)}` : a || "?");
// Loosely-typed time → "HH:MM": "9"→"09:00", "11:"→"11:00", "1130"→"11:30"; clamps to 24h.
// Returns "" for blank. Lets users type just an hour and tab out (native <input type=time>
// would discard a half-filled value), then fills the minutes for them.
const normalizeTime = (s: string): string => {
  const t = (s || "").trim();
  if (!t) return "";
  let h: number, m: number;
  if (t.includes(":")) { const [hp, mp] = t.split(":"); h = parseInt(hp, 10); m = mp ? parseInt(mp, 10) : 0; }
  else if (/^\d+$/.test(t)) { if (t.length <= 2) { h = parseInt(t, 10); m = 0; } else { h = parseInt(t.slice(0, t.length - 2), 10); m = parseInt(t.slice(-2), 10); } }
  else return t;
  if (!Number.isFinite(h)) return "";
  if (!Number.isFinite(m)) m = 0;
  h = Math.min(23, Math.max(0, h));
  m = Math.min(59, Math.max(0, m));
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};
// True only for a complete, valid 24h "HH:MM" (so normalizeTime's pass-through of garbage like
// "aaa" is rejected).
const isHHMM = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

type Laid = { src: Occurrence; type: CalEventType; startMin: number; endMin: number; lane: number; lanes: number };

// Lay timed events out into side-by-side lanes (like Teams): overlapping events split
// the column width between them.
function layoutDay(list: Occurrence[]): Laid[] {
  const items: Laid[] = list.map((e) => { const s = hhmmToMin(e.time) ?? 0; let en = hhmmToMin(e.endTime) ?? s + 60; if (en <= s) en = s + 30; return { src: e, type: e.type, startMin: s, endMin: en, lane: 0, lanes: 1 }; })
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const out: Laid[] = [];
  let cluster: Laid[] = []; let clusterEnd = -1;
  const flush = () => {
    const laneEnds: number[] = [];
    for (const it of cluster) {
      let placed = false;
      for (let l = 0; l < laneEnds.length; l++) { if (it.startMin >= laneEnds[l]) { laneEnds[l] = it.endMin; it.lane = l; placed = true; break; } }
      if (!placed) { it.lane = laneEnds.length; laneEnds.push(it.endMin); }
    }
    for (const it of cluster) { it.lanes = laneEnds.length; out.push(it); }
    cluster = []; clusterEnd = -1;
  };
  for (const it of items) { if (cluster.length && it.startMin >= clusterEnd) flush(); cluster.push(it); clusterEnd = Math.max(clusterEnd, it.endMin); }
  flush();
  return out;
}

// Calendar: a Teams-style week time-grid (7 days × 24h, drag to create) plus a month
// overview. Meetings / tasks / reminders are personal to this wallet; board ticket
// due dates show read-only.
export default function CalendarView({ address, onOpenTicket, onOpenItsm, onToast, openEvent, onEventOpened }: { address: string; onOpenTicket?: (boardId: string, ticketId: string) => void; onOpenItsm?: (recordId: string) => void; onToast?: Toast; openEvent?: string | null; onEventOpened?: () => void }) {
  const [events, setEvents] = useState<CalEvent[]>(() => loadEvents(address));
  const [sharedEvents, setSharedEvents] = useState<CalEvent[]>(() => loadSharedEvents(address));
  const dues = useMemo<CalTicketDue[]>(() => boardTicketDues(address), [address]);
  const idues = useMemo<ItsmDue[]>(() => itsmDues(address), [address]);
  const [cursor, setCursor] = useState(() => new Date());
  const [view, setView] = useState<"day" | "week" | "month">("week");
  const [editing, setEditing] = useState<{ event: CalEvent; occDate: string } | null>(null);
  const [viewing, setViewing] = useState<{ event: CalEvent; occDate: string } | null>(null); // a shared event (read-only)
  const [pins, setPins] = useState<CalPin[]>(() => loadPins(address));
  const [editPin, setEditPin] = useState<CalPin | null>(null); // a personal pinned note being added/edited
  const dragRef = useRef<{ dayIso: string; rectTop: number; startMin: number } | null>(null);
  const [dragSel, setDragSel] = useState<{ dayIso: string; a: number; b: number } | null>(null);
  // Drag-to-reschedule an EXISTING event. moveGhost is the live on-grid preview; reschedule holds
  // a pending move of a recurring event awaiting the This-event / All-events choice. The grab
  // itself runs on per-press closures (in onEventMouseDown) so it always sees fresh state.
  const [moveGhost, setMoveGhost] = useState<{ dayIso: string; startMin: number; durationMin: number } | null>(null);
  const [reschedule, setReschedule] = useState<{ occ: Occurrence; targetDay: string; newTime: string; newEndTime: string } | null>(null);

  const allEvents = useMemo(() => [...events, ...sharedEvents], [events, sharedEvents]);
  const update = (fn: (prev: CalEvent[]) => CalEvent[]) => setEvents((prev) => { const next = fn(prev); saveEvents(address, next); return next; });
  const save = async (e: CalEvent, inviteeTokens: { token: string; label: string }[]) => {
    if (e.reminders?.length) ensureNotifyPermission();
    update((prev) => prev.some((x) => x.id === e.id) ? prev.map((x) => (x.id === e.id ? { ...e, updatedAt: Date.now() } : x)) : [...prev, e]);
    setEditing(null);
    if (inviteeTokens.length || e.invitees?.length) { try { await shareEvent(address, e, inviteeTokens); } catch { onToast?.("Couldn't share the event with everyone.", "error"); } }
  };
  const removeSeries = (id: string) => { const ev = events.find((x) => x.id === id); update((prev) => prev.filter((x) => x.id !== id)); setEditing(null); if (ev?.invitees?.length) deleteSharedEvent(address, id).catch(() => {}); };
  const removeOccurrence = (id: string, occDate: string) => { update((prev) => prev.map((x) => (x.id === id ? { ...x, exdates: [...(x.exdates ?? []), occDate], updatedAt: Date.now() } : x))); setEditing(null); };
  const openOcc = (o: Occurrence) => { const ev = allEvents.find((e) => e.id === o.seriesId) ?? o; if (ev.owner && ev.owner !== address) setViewing({ event: ev, occDate: o.occDate }); else setEditing({ event: ev, occDate: o.occDate }); };
  const openNew = (iso: string, extra?: Partial<CalEvent>) => setEditing({ event: { ...newEvent(iso), ...extra }, occDate: iso });

  // Save edits to ONLY the clicked occurrence: detach it as an independent one-off and hide the
  // original from the series. Used by the editor's "This event" choice on a recurring event.
  const saveOccurrence = async (seriesId: string, occDate: string, edited: CalEvent, inviteeTokens: { token: string; label: string }[]) => {
    const series = events.find((x) => x.id === seriesId);
    if (!series) return;
    const detached = detachOccurrence(series, occDate, edited);
    if (detached.reminders?.length) ensureNotifyPermission();
    update((prev) => [...prev.map((x) => (x.id === seriesId ? withExdate(x, occDate) : x)), detached]);
    setEditing(null);
    if (inviteeTokens.length || detached.invitees?.length) { try { await shareEvent(address, detached, inviteeTokens); } catch { onToast?.("Couldn't share the event with everyone.", "error"); } }
  };

  // Apply a drag-reschedule. scope "all" shifts the whole series (or relocates a one-off); scope
  // "one" detaches just the dragged occurrence to the new day/time.
  const applyReschedule = (occ: Occurrence, targetDay: string, newTime: string, newEndTime: string, scope: "all" | "one") => {
    const series = events.find((x) => x.id === occ.seriesId);
    if (!series) return;
    if (scope === "one" && series.recurrence) {
      const detached = detachOccurrence(series, occ.occDate, { date: targetDay, time: newTime, endTime: newEndTime });
      update((prev) => [...prev.map((x) => (x.id === series.id ? withExdate(x, occ.occDate) : x)), detached]);
      if (series.invitees?.length) shareEvent(address, detached, []).catch(() => {});
    } else {
      const moved = shiftSeriesTo(series, occ.occDate, targetDay, newTime, newEndTime);
      update((prev) => prev.map((x) => (x.id === series.id ? moved : x)));
      if (series.invitees?.length) shareEvent(address, moved, []).catch(() => {});
    }
    setReschedule(null);
  };

  // Grab an existing timed event to move it. A small movement threshold separates a click (open
  // the editor) from a drag (reschedule). The pointer is hit-tested against the day columns
  // (data-day-iso) so it can be dropped on another day; closures keep state fresh.
  const onEventMouseDown = (e: React.MouseEvent, occ: Occurrence) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const readOnly = !!(occ.owner && occ.owner !== address); // shared events: click-to-view only
    const startMin = hhmmToMin(occ.time) ?? 0;
    const durationMin = Math.max(SNAP, (hhmmToMin(occ.endTime) ?? startMin + 60) - startMin);
    const grabOffMin = ((e.clientY - e.currentTarget.getBoundingClientRect().top) / HOUR_H) * 60;
    const origin = { x: e.clientX, y: e.clientY };
    const st = { moved: false, target: null as { dayIso: string; startMin: number } | null };
    const move = (ev: MouseEvent) => {
      if (readOnly) return;
      if (!st.moved && Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) < 4) return;
      st.moved = true;
      const col = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-day-iso]");
      const dayIso = col?.getAttribute("data-day-iso") ?? occ.occDate;
      const top = col ? col.getBoundingClientRect().top : origin.y;
      const sMin = Math.max(0, Math.min(1440 - durationMin, snap(((ev.clientY - top) / HOUR_H) * 60 - grabOffMin)));
      st.target = { dayIso, startMin: sMin };
      setMoveGhost({ dayIso, startMin: sMin, durationMin });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setMoveGhost(null);
      if (!st.moved || !st.target) { openOcc(occ); return; } // a click → open the editor
      const nt = minToHHMM(st.target.startMin);
      const net = occ.endTime ? minToHHMM(st.target.startMin + durationMin) : "";
      if (occ.recurrence) setReschedule({ occ, targetDay: st.target.dayIso, newTime: nt, newEndTime: net });
      else applyReschedule(occ, st.target.dayIso, nt, net, "all");
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // Open a specific event when asked (e.g. a chat message's event chip → Calendar).
  useEffect(() => {
    if (!openEvent) return;
    const ev = allEvents.find((e) => e.id === openEvent);
    if (ev) {
      setCursor(parseISO(ev.date));
      if (ev.owner && ev.owner !== address) setViewing({ event: ev, occDate: ev.date });
      else setEditing({ event: ev, occDate: ev.date });
    } else {
      onToast?.("That event isn't on your calendar (its owner may not have shared it with you).", "info");
    }
    onEventOpened?.();
  }, [openEvent]); // eslint-disable-line react-hooks/exhaustive-deps

  // Discover + fold events shared TO me (one wallet prompt per new owner, then cached).
  const pullShared = useCallback(async () => {
    try {
      const owners = await discoverSharedOwners(address);
      const all: CalEvent[] = [];
      for (const o of owners) {
        const key = loadOwnerKey(o.owner) ?? await unwrapOwnerKey(o.owner, o.wrappedKey).catch(() => null);
        if (!key) continue;
        all.push(...await foldOwnerEvents(o.owner, key));
      }
      saveSharedEvents(address, all); setSharedEvents(all);
    } catch { /* ignore */ }
  }, [address]);
  useEffect(() => { void pullShared(); const id = setInterval(() => { void pullShared(); }, 60_000); return () => clearInterval(id); }, [pullShared]);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => { setRefreshing(true); try { await pullShared(); } finally { setRefreshing(false); } };

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const todayISO = isoDate(now);

  const duesByDay = useMemo(() => { const m = new Map<string, CalTicketDue[]>(); for (const d of dues) { const a = m.get(d.date) ?? []; a.push(d); m.set(d.date, a); } return m; }, [dues]);
  const iduesByDay = useMemo(() => { const m = new Map<string, ItsmDue[]>(); for (const d of idues) { const a = m.get(d.date) ?? []; a.push(d); m.set(d.date, a); } return m; }, [idues]);

  const wStart = weekStart(cursor);
  const weekDays = view === "day" ? [cursor] : range(7).map((i) => addDays(wStart, i)); // the day/week time-grid columns
  const monthCells = useMemo(() => { const start = weekStart(new Date(cursor.getFullYear(), cursor.getMonth(), 1)); return range(42).map((i) => addDays(start, i)); }, [cursor]);
  const rangeStartISO = isoDate(view === "month" ? monthCells[0] : weekDays[0]);
  const rangeEndISO = isoDate(view === "month" ? monthCells[41] : weekDays[weekDays.length - 1]);
  const occByDay = useMemo(() => { const m = new Map<string, Occurrence[]>(); for (const o of expandRange(allEvents, rangeStartISO, rangeEndISO)) { const a = m.get(o.date) ?? []; a.push(o); m.set(o.date, a); } return m; }, [allEvents, rangeStartISO, rangeEndISO]);
  const go = (dir: number) => setCursor((c) => (view === "day" ? addDays(c, dir) : view === "month" ? new Date(c.getFullYear(), c.getMonth() + dir, 1) : addDays(weekStart(c), dir * 7)));

  const onDragMove = useCallback((e: MouseEvent) => {
    const d = dragRef.current; if (!d) return;
    const m = snap(((e.clientY - d.rectTop) / HOUR_H) * 60);
    setDragSel({ dayIso: d.dayIso, a: Math.min(d.startMin, m), b: Math.max(d.startMin, m) });
  }, []);
  const onDragUp = useCallback((e: MouseEvent) => {
    window.removeEventListener("mousemove", onDragMove);
    window.removeEventListener("mouseup", onDragUp);
    const d = dragRef.current; dragRef.current = null; setDragSel(null);
    if (!d) return;
    const m = snap(((e.clientY - d.rectTop) / HOUR_H) * 60);
    let a = Math.min(d.startMin, m); let b = Math.max(d.startMin, m);
    if (b - a < SNAP) b = Math.min(1440, a + 60); // a plain click → 1h event
    setEditing({ event: { ...newEvent(d.dayIso), time: minToHHMM(a), endTime: minToHHMM(b) }, occDate: d.dayIso });
  }, [onDragMove]);
  const onColMouseDown = (e: React.MouseEvent, dayIso: string) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const m = snap(((e.clientY - rect.top) / HOUR_H) * 60);
    dragRef.current = { dayIso, rectTop: rect.top, startMin: m };
    setDragSel({ dayIso, a: m, b: m });
    window.addEventListener("mousemove", onDragMove);
    window.addEventListener("mouseup", onDragUp);
  };

  const headLabel = view === "day"
    ? cursor.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" })
    : view === "month"
    ? cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
    : `${MONTHS[wStart.getMonth()].slice(0, 3)} ${wStart.getDate()} – ${MONTHS[addDays(wStart, 6).getMonth()].slice(0, 3)} ${addDays(wStart, 6).getDate()}, ${addDays(wStart, 6).getFullYear()}`;

  return (
    <div className="flex flex-col">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div>
          <h2 className="text-lg font-semibold text-white">Calendar</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {EVENT_TYPES.map((t) => <span key={t.id} className="flex items-center gap-1.5 text-[11px] text-slate-400"><span className={`h-2 w-2 rounded-full ${t.dot}`} />{t.label}</span>)}
            <span className="flex items-center gap-1.5 text-[11px] text-slate-400"><span className="h-2 w-2 rounded-full bg-amber-400" />Pin</span>
            <span className="flex items-center gap-1.5 text-[11px] text-slate-400"><span className="h-2 w-2 rounded-full bg-rose-400" />Ticket due</span>
            <span className="flex items-center gap-1.5 text-[11px] text-slate-400"><span className="h-2 w-2 rounded-full bg-sky-400" />Service Desk</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg border border-slate-800 bg-slate-900/50 p-0.5 text-xs">
            {(["day", "week", "month"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={`rounded-md px-2.5 py-1 font-medium capitalize ${view === v ? "bg-indigo-600/20 text-indigo-300" : "text-slate-400 hover:text-slate-200"}`}>{v}</button>
            ))}
          </div>
          <PeriodPicker view={view} cursor={cursor} label={headLabel} weekStartOf={weekStart} onPrev={() => go(-1)} onNext={() => go(1)} onPick={(d) => setCursor(d)} />
          <button onClick={() => setCursor(new Date())} className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700 hover:text-slate-100">Today</button>
          <button onClick={() => setEditPin({ id: "", date: todayISO, text: "", createdAt: Date.now() })} title="Pin a personal note (only you see it)" className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700 hover:text-slate-100">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5zM12 16v4" /></svg>Pin
          </button>
          <button onClick={refresh} disabled={refreshing} title="Refresh shared events" className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-slate-300 hover:bg-slate-700 disabled:opacity-60"><svg className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M5 9a7 7 0 0111-3M19 15a7 7 0 01-11 3" /></svg></button>
          <button onClick={() => openNew(todayISO)} className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>New event
          </button>
        </div>
      </div>

      {view === "month" ? (
        <CalMonthGrid monthCells={monthCells} cursor={cursor} todayISO={todayISO} occByDay={occByDay} pins={pins} onOpenOcc={openOcc} onPickDay={(iso) => { setCursor(parseISO(iso)); setView("day"); }} onNew={openNew} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
          {/* Scrolls horizontally when the day columns don't fit the screen. */}
          <div className="overflow-x-auto">
          <div style={{ minWidth: `calc(3.5rem + ${weekDays.length} * 6rem)` }}>
          {/* sticky day header + all-day band (pins, all-day events, due dates). */}
          <div className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur">
            <div className="flex border-b border-slate-800">
              <div className="w-14 shrink-0" />
              {weekDays.map((d) => {
                const iso = isoDate(d); const isToday = iso === todayISO;
                // Pins come FIRST — pinned right below the day line, fixed at the top of the
                // column — then the all-day events and due dates.
                const dayPins = pinsByDay(pins, iso);
                const ad: { key: string; label: string; chip: string; dot: string; onClick?: () => void }[] = [
                  ...(occByDay.get(iso) ?? []).filter((e) => !e.time).map((e) => ({ key: "e" + e.id, label: e.title || "(untitled)", chip: eventTypeMeta(e.type).chip, dot: eventTypeMeta(e.type).dot, onClick: () => openOcc(e) })),
                  ...(duesByDay.get(iso) ?? []).map((due) => ({ key: "d" + due.id, label: `${due.key} ${due.title}`, chip: "border-rose-500/30 bg-rose-500/10 text-rose-200", dot: "bg-rose-400", onClick: undefined })),
                  ...(iduesByDay.get(iso) ?? []).map((due) => ({ key: "i" + due.id, label: `${due.number} ${due.short}`, chip: itsmMeta(due.type).chip, dot: itsmMeta(due.type).dot, onClick: () => onOpenItsm?.(due.recordId) })),
                ];
                return (
                  <div key={iso} className="flex-1 min-w-0 border-l border-slate-800/60 px-1 py-1.5">
                    <div className="text-center">
                      <p className="text-[10px] uppercase tracking-wide text-slate-500">{WEEKDAYS[d.getDay()]}</p>
                      <p className={`mx-auto mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-xs ${isToday ? "bg-indigo-600 font-semibold text-white" : "text-slate-300"}`}>{d.getDate()}</p>
                    </div>
                    {dayPins.length > 0 && (
                      <div className="mt-1 space-y-0.5 pt-1">
                        {dayPins.map((p) => (
                          <button key={p.id} onClick={() => setEditPin(p)} title={p.text} className="flex w-full items-start gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1 py-0.5 text-left text-[10px] text-amber-200">
                            <svg className="mt-px h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5zM12 16v4" /></svg>
                            <span className="whitespace-pre-wrap break-words">{p.text}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {ad.length > 0 && (
                      <div className="mt-1 max-h-24 space-y-0.5 overflow-y-auto">
                        {ad.map((a) => (
                          <button key={a.key} onClick={a.onClick} title={a.label} className={`flex w-full items-center gap-1 truncate rounded border px-1 py-0.5 text-left text-[10px] ${a.chip}`}>
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${a.dot}`} />
                            <span className="truncate">{a.label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          {/* time grid */}
          <div className="relative flex" style={{ height: 24 * HOUR_H }}>
            <div className="w-14 shrink-0">
              {range(24).map((h) => <div key={h} style={{ height: HOUR_H }} className="relative"><span className="absolute right-1 -top-1.5 text-[9px] text-slate-600">{h === 0 ? "" : `${h}:00`}</span></div>)}
            </div>
            {weekDays.map((d) => { const iso = isoDate(d); const laid = layoutDay((occByDay.get(iso) ?? []).filter((e) => e.time));
              return (
              <div key={iso} data-day-iso={iso} onMouseDown={(e) => onColMouseDown(e, iso)} className="relative flex-1 min-w-0 cursor-cell border-l border-slate-800/60">
                {range(24).map((h) => <div key={h} style={{ height: HOUR_H }} className="border-b border-slate-800/40" />)}
                {iso === todayISO && <div className="pointer-events-none absolute inset-x-0 z-10 border-t border-rose-500" style={{ top: (nowMin / 60) * HOUR_H }}><span className="absolute -top-[3px] left-0 h-1.5 w-1.5 rounded-full bg-rose-500" /></div>}
                {dragSel?.dayIso === iso && dragSel.b > dragSel.a && <div className="pointer-events-none absolute inset-x-0.5 z-20 rounded border border-indigo-400 bg-indigo-500/25" style={{ top: (dragSel.a / 60) * HOUR_H, height: ((dragSel.b - dragSel.a) / 60) * HOUR_H }} />}
                {moveGhost?.dayIso === iso && <div className="pointer-events-none absolute inset-x-0.5 z-30 rounded border-2 border-dashed border-indigo-300 bg-indigo-400/20" style={{ top: (moveGhost.startMin / 60) * HOUR_H, height: (moveGhost.durationMin / 60) * HOUR_H }}><span className="absolute left-1 top-0 text-[9px] font-medium text-indigo-100">{minToHHMM(moveGhost.startMin)}</span></div>}
                {laid.map((ev) => { const m = eventTypeMeta(ev.type); const height = Math.max(16, ((ev.endMin - ev.startMin) / 60) * HOUR_H); const mine = !(ev.src.owner && ev.src.owner !== address); return (
                  <button key={ev.src.id} onMouseDown={(e) => onEventMouseDown(e, ev.src)} title={mine ? `${ev.src.title} — drag to reschedule` : ev.src.title} style={{ top: (ev.startMin / 60) * HOUR_H, height, width: `calc(${100 / ev.lanes}% - 3px)`, left: `calc(${(ev.lane * 100) / ev.lanes}% + 1px)` }} className={`absolute z-10 overflow-hidden rounded border px-1 py-0.5 text-left ${mine ? "cursor-grab active:cursor-grabbing" : ""} ${m.chip}`}>
                    <span className="flex items-center gap-1 text-[10px] leading-tight">{ev.src.type === "meeting" && eventLink(ev.src) ? <span className="shrink-0">🎥</span> : <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${m.dot}`} />}<span className="truncate font-medium">{ev.src.title || "(untitled)"}</span>{ev.src.ticketRef && <span className="shrink-0 opacity-70">🎫</span>}{ev.src.recurrence && <span className="shrink-0 opacity-70">↻</span>}</span>
                    {height > 30 && <span className="block truncate text-[9px] opacity-70">{minToHHMM(ev.startMin)}{ev.src.endTime ? `–${ev.src.endTime}` : ""}</span>}
                  </button>
                ); })}
              </div>
            ); })}
          </div>
          </div>
          </div>
        </div>
      )}

      {editing && <EventEditor event={editing.event} occDate={editing.occDate} address={address} onClose={() => setEditing(null)} onSave={save} onSaveOccurrence={saveOccurrence} onDeleteSeries={removeSeries} onDeleteOccurrence={removeOccurrence} onOpenTicket={onOpenTicket} onOpenItsm={onOpenItsm} exists={events.some((x) => x.id === editing.event.id)} />}
      {viewing && <SharedEventViewer event={viewing.event} occDate={viewing.occDate} address={address} onClose={() => setViewing(null)} onOpenTicket={onOpenTicket} onMuteChange={() => setSharedEvents((s) => [...s])} />}
      {editPin && (
        <PinEditor
          pin={editPin}
          onClose={() => setEditPin(null)}
          onSave={(p) => {
            const id = p.id || `pin_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
            const next = p.id ? pins.map((x) => (x.id === p.id ? { ...p } : x)) : [...pins, { ...p, id }];
            setPins(next); savePins(address, next); setEditPin(null);
          }}
          onDelete={(id) => { const next = pins.filter((x) => x.id !== id); setPins(next); savePins(address, next); setEditPin(null); }}
        />
      )}
      {reschedule && (
        <ScopeModal
          title="Move repeating event"
          message={`Move to ${parseISO(reschedule.targetDay).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}${reschedule.newTime ? ` at ${reschedule.newTime}` : ""}. Apply to just this one, or the whole series?`}
          onThis={() => applyReschedule(reschedule.occ, reschedule.targetDay, reschedule.newTime, reschedule.newEndTime, "one")}
          onAll={() => applyReschedule(reschedule.occ, reschedule.targetDay, reschedule.newTime, reschedule.newEndTime, "all")}
          onCancel={() => setReschedule(null)}
        />
      )}
    </div>
  );
}

// Month view: a 6×7 grid of day cells with event chips. Click a day to open it (day view),
// the “+” to add an event, or a chip to open the event.
function CalMonthGrid({ monthCells, cursor, todayISO, occByDay, pins, onOpenOcc, onPickDay, onNew }: {
  monthCells: Date[]; cursor: Date; todayISO: string;
  occByDay: Map<string, Occurrence[]>; pins: CalPin[];
  onOpenOcc: (o: Occurrence) => void; onPickDay: (iso: string) => void; onNew: (iso: string) => void;
}) {
  const month = cursor.getMonth();
  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
      <div className="overflow-x-auto">
        <div className="min-w-[48rem]">
      <div className="grid grid-cols-7 border-b border-slate-800 bg-slate-900/90 text-center text-[10px] uppercase tracking-wide text-slate-500">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => <div key={w} className="py-1.5">{w}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {monthCells.map((d) => {
          const iso = isoDate(d);
          const inMonth = d.getMonth() === month;
          const isToday = iso === todayISO;
          const occ = (occByDay.get(iso) ?? []).slice().sort((a, b) => (hhmmToMin(a.time) ?? -1) - (hhmmToMin(b.time) ?? -1));
          const dayPins = pinsByDay(pins, iso);
          return (
            <div key={iso} className={`group relative flex min-h-[6.5rem] flex-col border-b border-l border-slate-800/60 p-1 ${inMonth ? "" : "bg-slate-950/40 opacity-50"} ${isToday ? "bg-indigo-500/5" : ""}`}>
              <div className="flex items-center justify-between">
                <button onClick={() => onPickDay(iso)} title="Open this day" className={`text-xs ${isToday ? "flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 font-semibold text-white" : "text-slate-300 hover:text-white"}`}>{d.getDate()}</button>
                <button onClick={() => onNew(iso)} title="New event" className="text-slate-600 opacity-0 transition-opacity hover:text-indigo-300 group-hover:opacity-100"><svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg></button>
              </div>
              <div className="mt-0.5 min-h-0 flex-1 space-y-0.5 overflow-hidden">
                {dayPins.map((p) => (
                  <div key={p.id} title={p.text} className="flex items-center gap-1 truncate rounded border border-amber-500/40 bg-amber-500/10 px-1 text-[9px] text-amber-200"><svg className="h-2.5 w-2.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5zM12 16v4" /></svg><span className="truncate">{p.text}</span></div>
                ))}
                {occ.slice(0, 3).map((e) => { const m = eventTypeMeta(e.type); return (
                  <button key={e.id} onClick={() => onOpenOcc(e)} title={e.title} className={`flex w-full items-center gap-1 truncate rounded border px-1 text-[9px] ${m.chip}`}><span className={`h-1 w-1 shrink-0 rounded-full ${m.dot}`} /><span className="truncate">{e.time ? `${e.time} ` : ""}{e.title || "(untitled)"}</span></button>
                ); })}
                {occ.length > 3 && <button onClick={() => onPickDay(iso)} className="px-1 text-left text-[9px] text-slate-500 hover:text-slate-300">+{occ.length - 3} more</button>}
              </div>
            </div>
          );
        })}
      </div>
        </div>
      </div>
    </div>
  );
}

// A "this one vs the whole series" confirmation for recurring events (drag-move and edit-save).
function ScopeModal({ title, message, onThis, onAll, onCancel }: { title: string; message: string; onThis: () => void; onAll: () => void; onCancel: () => void }) {
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4" onMouseDown={onCancel}>
      <div className="absolute inset-0 bg-black/60" />
      <div onMouseDown={(e) => e.stopPropagation()} className="relative w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><span className="text-indigo-400">↻</span>{title}</h3>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">{message}</p>
        <div className="mt-5 flex flex-col gap-2">
          <button onClick={onThis} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 transition-colors hover:border-indigo-500/50 hover:bg-slate-700">This event only</button>
          <button onClick={onAll} className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500">All events in the series</button>
          <button onClick={onCancel} className="w-full px-3 py-1.5 text-xs text-slate-400 transition-colors hover:text-slate-200">Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Read-only view of an event someone shared with me, plus a mute-reminders toggle.
function SharedEventViewer({ event, occDate, address, onClose, onOpenTicket, onMuteChange }: { event: CalEvent; occDate: string; address: string; onClose: () => void; onOpenTicket?: (boardId: string, ticketId: string) => void; onMuteChange: () => void }) {
  const [muted, setMutedState] = useState(() => isMuted(address, event.id));
  const m = eventTypeMeta(event.type);
  const link = eventLink(event);
  const myName = address.length > 10 ? `${address.slice(0, 5)}…${address.slice(-4)}` : address;
  const lbl = "text-[10px] font-medium uppercase tracking-wide text-slate-500";
  const toggleMute = () => { const next = !muted; setMuted(address, event.id, next); setMutedState(next); onMuteChange(); };
  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div onMouseDown={(e) => e.stopPropagation()} className="relative flex max-h-[85vh] w-full max-w-md flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-medium text-slate-200"><span className={`h-2 w-2 rounded-full ${m.dot}`} />Shared event</span>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200"><svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>
        <div className="flex-1 min-h-0 space-y-3 overflow-y-auto px-4 py-4">
          <p className="text-base font-semibold text-white"><MentionText text={event.title || "(untitled)"} viewer={address} /></p>
          <p className="text-xs text-slate-400">{parseISO(occDate).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}{event.time ? ` · ${event.time}${event.endTime ? `–${event.endTime}` : ""}` : ""}{event.recurrence ? " · repeats" : ""}</p>
          <p className="text-[11px] text-slate-500">Shared by {shortAddr(event.owner || "")}</p>
          {link && (event.type === "meeting"
            ? <a href={meetingJoinUrl(link, myName)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-indigo-300 hover:text-indigo-200">🎥 Join meeting ↗</a>
            : <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-indigo-300 hover:text-indigo-200">Open link ↗</a>)}
          {event.location?.trim() && <LocationView location={event.location} />}
          {event.ticketRef && <button onClick={() => event.ticketRef && onOpenTicket?.(event.ticketRef.boardId, event.ticketRef.ticketId)} disabled={!onOpenTicket} className="flex items-center gap-2 text-xs text-slate-200 enabled:hover:text-indigo-300"><span className="rounded bg-indigo-500/20 px-1.5 py-0.5 font-mono text-[10px] text-indigo-200">{event.ticketRef.key}</span><span className="truncate">{event.ticketRef.title}</span></button>}
          {event.notes?.trim() && <p className="whitespace-pre-wrap text-xs text-slate-300"><MentionText text={event.notes} viewer={address} /></p>}
          {!!event.invitees?.length && (
            <div>
              <p className={lbl}>Invited ({event.invitees.length})</p>
              <div className="mt-1 flex flex-wrap gap-1.5">{event.invitees.map((i) => <span key={i.address} className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">{i.label}{i.address === address ? " (you)" : ""}</span>)}</div>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-slate-800 px-4 py-2.5">
          <button onClick={toggleMute} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] ${muted ? "border-slate-700 text-slate-400 hover:text-slate-200" : "border-indigo-500/40 text-indigo-300"}`}>{muted ? "🔕 Reminders off" : "🔔 Reminders on"}</button>
          <button onClick={onClose} className="text-[11px] text-slate-400 hover:text-slate-200">Close</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Location input with free address autocomplete (OpenStreetMap) + Open-in-maps link.
function LocationPicker({ value, field, onChange }: { value: string; field: string; onChange: (location: string) => void }) {
  const [q, setQ] = useState(value);
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setQ(value); }, [value]);
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 3) { setHits([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => { placeSearch(term, ctrl.signal).then(setHits); }, 450);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q, open]);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h, true); // capture: the editor modal stops mousedown bubbling
    return () => document.removeEventListener("mousedown", h, true);
  }, [open]);
  const pick = (hit: PlaceHit) => { setQ(hit.label); onChange(hit.label); setOpen(false); setHits([]); };
  return (
    <div ref={boxRef} className="relative">
      <input value={q} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); onChange(e.target.value); setOpen(true); }} placeholder="Start typing an address — pick a match" className={field} />
      {open && hits.length > 0 && (
        <div className="absolute left-0 right-0 z-30 mt-1 max-h-52 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
          {hits.map((h, i) => (
            <button key={i} onClick={() => pick(h)} className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800">
              <span className="shrink-0">📍</span><span className="min-w-0">{h.label}</span>
            </button>
          ))}
        </div>
      )}
      {open && q.trim().length >= 3 && hits.length === 0 && (
        <div className="absolute left-0 right-0 z-30 mt-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-[11px] text-slate-500 shadow-xl">No match — try the street, city or postcode.</div>
      )}
      {value.trim() && <a href={mapsUrl(value)} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-indigo-300 hover:text-indigo-200">📍 Open in maps ↗</a>}
    </div>
  );
}

// Read-only location with an Open-in-maps link.
function LocationView({ location }: { location: string }) {
  return (
    <div>
      <p className="mb-1 flex items-start gap-1 text-xs text-slate-300"><span className="shrink-0">📍</span><span className="min-w-0 break-words">{location}</span></p>
      <a href={mapsUrl(location)} target="_blank" rel="noopener noreferrer" className="text-[11px] text-indigo-300 hover:text-indigo-200">Open in maps ↗</a>
    </div>
  );
}

// Searchable picker to invite people — Access Keys by default, or (when the event is
// linked to a board) only that board's members.
// A personal pinned note — a private message on a day (only this wallet sees it).
function PinEditor({ pin, onClose, onSave, onDelete }: { pin: CalPin; onClose: () => void; onSave: (p: CalPin) => void; onDelete: (id: string) => void }) {
  const [date, setDate] = useState(pin.date);
  const [text, setText] = useState(pin.text);
  const valid = !!date && !!text.trim();
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="flex items-center gap-1.5 text-base font-semibold text-white"><svg className="h-4 w-4 text-amber-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5zM12 16v4" /></svg> {pin.id ? "Edit pin" : "Pin a note"}</h3>
        <p className="mt-0.5 text-xs text-slate-500">A private reminder on your calendar — only you can see it.</p>
        <div className="mt-4 space-y-3">
          <label className="block"><span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Date</span><DateInput value={date} onChange={setDate} /></label>
          <label className="block"><span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Note</span><textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Your message…" className="w-full resize-none rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none" /></label>
        </div>
        <div className="mt-5 flex items-center justify-between">
          {pin.id ? <button onClick={() => onDelete(pin.id)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:border-rose-500/50 hover:text-rose-300">Delete</button> : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">Cancel</button>
            <button onClick={() => valid && onSave({ ...pin, date, text: text.trim() })} disabled={!valid} className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-60">Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function InviteePicker({ address, exclude, onPick, restrictTo }: { address: string; exclude: string[]; onPick: (token: string, label: string, addr: string) => void; restrictTo?: { address: string; label: string }[] | null }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const ids = useMemo(() => loadIdentities(address).filter((i) => i.address !== address), [address]);
  const idByAddr = useMemo(() => new Map(ids.map((i) => [i.address, i])), [ids]);
  // Each candidate resolves to a token = saved public key (preferred) or the address,
  // which sharing resolves on-chain — so board members can be invited even if not yet
  // saved in Access Keys.
  const candidates = useMemo(() => (
    restrictTo
      ? restrictTo.filter((m) => m.address !== address).map((m) => { const id = idByAddr.get(m.address); return { address: m.address, label: m.label || id?.label || shortAddr(m.address), token: id?.publicKey || m.address }; })
      : ids.map((i) => ({ address: i.address, label: i.label || shortAddr(i.address), token: i.publicKey || i.address }))
  ), [restrictTo, ids, idByAddr, address]);
  const available = candidates.filter((c) => !exclude.includes(c.address));
  const filtered = available.filter((c) => `${c.label} ${c.address}`.toLowerCase().includes(q.trim().toLowerCase()));
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h, true); // capture: the editor modal stops mousedown bubbling
    return () => document.removeEventListener("mousedown", h, true);
  }, [open]);
  useEffect(() => { setActive(0); }, [q, open]);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: "nearest" }); }, [active]);
  const choose = (c: typeof filtered[number]) => { onPick(c.token, c.label, c.address); setQ(""); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (!filtered.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(filtered.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); const c = filtered[active]; if (c) choose(c); }
  };
  return (
    <div ref={boxRef} className="relative">
      <input value={q} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onKeyDown={onKeyDown} placeholder={restrictTo ? "Search board members to invite…" : "Search Access Keys to invite…"} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none" />
      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 max-h-52 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
          {candidates.length === 0 ? (
            <p className="px-2.5 py-2 text-[11px] text-slate-600">{restrictTo ? "This board has no other members to invite — add them to the board first." : "No saved Access Keys yet — add people in the Access Keys tab."}</p>
          ) : available.length === 0 ? (
            <p className="px-2.5 py-2 text-[11px] text-slate-600">Everyone's invited.</p>
          ) : filtered.length === 0 ? (
            <p className="px-2.5 py-2 text-[11px] text-slate-600">No matches.</p>
          ) : filtered.map((c, idx) => (
            <button key={c.address} ref={idx === active ? activeRef : undefined} onMouseMove={() => setActive(idx)} onClick={() => choose(c)} className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs ${idx === active ? "bg-slate-800 text-slate-100" : "text-slate-200 hover:bg-slate-800"}`}>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600/30 text-[9px] font-medium text-indigo-200">{(c.label || c.address).slice(0, 2).toUpperCase()}</span>
              <span className="min-w-0 flex-1 truncate">{c.label || shortAddr(c.address)}</span>
              <span className="shrink-0 text-[10px] text-slate-500">{shortAddr(c.address)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function EventEditor({ event, occDate, address, onClose, onSave, onSaveOccurrence, onDeleteSeries, onDeleteOccurrence, onOpenTicket, onOpenItsm, exists }: { event: CalEvent; occDate: string; address: string; onClose: () => void; onSave: (e: CalEvent, inviteeTokens: { token: string; label: string }[]) => void; onSaveOccurrence: (seriesId: string, occDate: string, edited: CalEvent, inviteeTokens: { token: string; label: string }[]) => void; onDeleteSeries: (id: string) => void; onDeleteOccurrence: (id: string, occDate: string) => void; onOpenTicket?: (boardId: string, ticketId: string) => void; onOpenItsm?: (recordId: string) => void; exists: boolean }) {
  const [draft, setDraft] = useState<CalEvent>(() => ({ ...event, link: eventLink(event) }));
  const [invitees, setInvitees] = useState<{ address: string; label: string; token: string }[]>(() => (event.invitees ?? []).map((i) => ({ ...i, token: i.address })));
  const [copied, setCopied] = useState(false);
  const mentionList = useMemo(() => mentionPeople(address), [address]);
  const myName = address.length > 10 ? `${address.slice(0, 5)}…${address.slice(-4)}` : address;
  const addInvitee = (token: string, label: string, addr: string) => { if (addr === address || invitees.some((i) => i.address === addr)) return; setInvitees((p) => [...p, { address: addr, label: label || shortAddr(addr), token }]); };
  const edited = (): CalEvent => ({ ...draft, time: normalizeTime(draft.time ?? ""), endTime: normalizeTime(draft.endTime ?? ""), invitees: invitees.map(({ address, label }) => ({ address, label })) });
  const tokens = () => invitees.map(({ token, label }) => ({ token, label }));
  // Saveable only with a title AND a complete time period: a valid Start and End (HH:MM) with
  // End after Start. Mirrors the board work-log rule, so garbage/half-typed times ("aaa", just
  // one time, or none) can't be saved. normalizeTime turns "9" into "09:00" first.
  const nStart = normalizeTime(draft.time ?? "");
  const nEnd = normalizeTime(draft.endTime ?? "");
  const periodValid = isHHMM(nStart) && isHHMM(nEnd) && (hhmmToMin(nEnd) ?? 0) > (hhmmToMin(nStart) ?? 0);
  const canSave = !!draft.title.trim() && periodValid;
  // On a recurring event that already exists, ask whether to apply to just this occurrence or
  // the whole series; new or one-off events save straight through.
  const commit = () => { if (!canSave) return; if (exists && draft.recurrence) { setAskScope(true); return; } onSave(edited(), tokens()); };
  const [confirmDel, setConfirmDel] = useState(false);
  const [askScope, setAskScope] = useState(false);
  // Optional board link — drives the chat chip name + restricts who can be invited.
  const myBoards = useMemo(() => loadBoards(address), [address]);
  const boardState = useMemo(() => (draft.boardId ? loadBoardState(draft.boardId) : null), [draft.boardId]);
  const boardProjectList = useMemo(() => (boardState ? boardProjects(boardState) : []), [boardState]);
  const boardMembers = useMemo(() => (boardState ? boardState.members.filter((m) => !m.inactive) : null), [boardState]);
  const set = (p: Partial<CalEvent>) => setDraft((d) => ({ ...d, ...p }));
  const field = "w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none";
  const lbl = "mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500";
  const selTrigger = "flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 hover:border-slate-600 focus:border-indigo-500 focus:outline-none"; // themed <select> trigger

  const rec = draft.recurrence ?? null;
  const startDow = parseISO(draft.date).getDay();
  const setFreq = (v: RecurFreq | "none") => v === "none" ? set({ recurrence: null }) : set({ recurrence: { freq: v, interval: rec?.interval || 1, weekdays: v === "weekly" ? (rec?.weekdays?.length ? rec.weekdays : [startDow]) : undefined, until: rec?.until ?? null } });
  const setRec = (p: Partial<Recurrence>) => { if (rec) set({ recurrence: { ...rec, ...p } }); };
  const toggleWeekday = (w: number) => { if (!rec) return; const cur = rec.weekdays?.length ? rec.weekdays : [startDow]; const next = cur.includes(w) ? cur.filter((x) => x !== w) : [...cur, w]; setRec({ weekdays: (next.length ? next : [startDow]).sort((a, b) => a - b) }); };
  const toggleReminder = (min: number) => { const cur = draft.reminders ?? []; set({ reminders: (cur.includes(min) ? cur.filter((x) => x !== min) : [...cur, min]).sort((a, b) => a - b) }); };

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div onMouseDown={(e) => e.stopPropagation()} className="relative flex max-h-[88vh] w-full max-w-md flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <span className="text-sm font-medium text-slate-200">{exists ? "Edit event" : "New event"}</span>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200"><svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>
        <div className="flex-1 min-h-0 space-y-3 overflow-y-auto px-4 py-4">
          <MentionInput autoFocus value={draft.title} onChange={(v) => set({ title: v })} people={mentionList} placeholder="Title — @ to mention" className="w-full rounded-lg border border-transparent bg-transparent px-1 py-1 text-base font-semibold text-white placeholder:text-slate-600 hover:border-slate-700 focus:border-indigo-500 focus:outline-none" />
          <div>
            <label className={lbl}>Type</label>
            <div className="flex flex-wrap gap-1.5">
              {EVENT_TYPES.map((t) => (
                <button key={t.id} onClick={() => set({ type: t.id as CalEventType })} className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${draft.type === t.id ? t.chip : "border-slate-700 text-slate-400 hover:border-slate-500"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />{t.label}
                </button>
              ))}
            </div>
          </div>
          {/* Cross-link board tickets, other events and Service Desk records (multi-select). */}
          <div>
            <label className={lbl}>Related records</label>
            <p className="mb-1.5 mt-0.5 text-[10px] text-slate-600">Link board tickets, other events or Service Desk records.</p>
            <RelatedLinks address={address} links={draft.links ?? []} onChange={(links) => set({ links })} onOpenTicket={onOpenTicket} onOpenItsm={onOpenItsm} />
          </div>
          <div>
            <label className={lbl}>{draft.type === "meeting" ? "Meeting link" : "Link"} <span className="normal-case text-slate-600">(optional)</span></label>
            <div className="flex gap-1.5">
              <input value={draft.link ?? ""} onChange={(e) => set({ link: e.target.value })} placeholder={draft.type === "meeting" ? "Paste a link, or generate one" : "https://…"} className={field} />
              {draft.type === "meeting" && <button onClick={() => set({ link: generateMeetingLink() })} title="Create an instant meeting room — no sign-in needed" className="shrink-0 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[11px] text-slate-200 hover:bg-slate-700">Generate</button>}
            </div>
            {draft.type === "meeting" && <p className="mt-1 text-[10px] text-slate-600">No login or wallet needed to join — the first person in is the admin.</p>}
            {draft.link?.trim() && (
              <div className="mt-1 flex flex-wrap items-center gap-3">
                {draft.type === "meeting"
                  ? <a href={meetingJoinUrl(draft.link, myName)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-indigo-300 hover:text-indigo-200">🎥 Join (chat + host controls) ↗</a>
                  : <a href={draft.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-indigo-300 hover:text-indigo-200">Open link ↗</a>}
                <button onClick={() => { try { navigator.clipboard?.writeText(draft.link || ""); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }} className="text-[11px] text-slate-400 hover:text-slate-200">{copied ? "Copied!" : "Copy link"}</button>
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div><label className={lbl}>Date</label><DateInput value={draft.date} onChange={(v) => set({ date: v })} className={field} /></div>
            <div><label className={lbl}>Start</label><TimeField value={draft.time ?? ""} onChange={(v) => set({ time: v })} className={field} /></div>
            <div><label className={lbl}>End</label><TimeField value={draft.endTime ?? ""} onChange={(v) => set({ endTime: v })} className={field} /></div>
          </div>
          {!periodValid && <p className="text-[10px] text-amber-400/80">Enter a Start and End time (e.g. 9 and 10) — the end must be after the start — to save.</p>}
          <div>
            <label className={lbl}>Repeat</label>
            <div className="flex flex-wrap items-center gap-2">
              <ThemedSelect
                value={rec?.freq ?? "none"}
                onChange={(v) => setFreq(v as RecurFreq | "none")}
                className={`${selTrigger} min-w-[10rem]`}
                options={[
                  { value: "none", label: "Does not repeat" },
                  { value: "daily", label: "Daily" },
                  { value: "weekly", label: "Weekly" },
                  { value: "monthly", label: "Monthly" },
                ]}
              />
              {rec && (
                <span className="flex items-center gap-1.5 text-[11px] text-slate-400">every
                  <input type="number" min={1} max={99} value={rec.interval} onChange={(e) => setRec({ interval: Math.max(1, Math.min(99, +e.target.value || 1)) })} className="w-12 rounded border border-slate-700 bg-slate-800 px-1.5 py-1 text-center text-xs text-slate-100 focus:border-indigo-500 focus:outline-none" />
                  {rec.freq === "daily" ? "day(s)" : rec.freq === "weekly" ? "week(s)" : "month(s)"}
                </span>
              )}
            </div>
            {rec?.freq === "weekly" && (
              <div className="mt-2">
                <p className="mb-1 text-[10px] text-slate-500">On these days (pick one or several)</p>
                <div className="flex gap-1">
                  {WEEKDAYS.map((w, idx) => { const on = (rec.weekdays?.length ? rec.weekdays : [startDow]).includes(idx); return <button key={idx} onClick={() => toggleWeekday(idx)} title={w} className={`h-6 w-6 rounded-full text-[10px] font-medium ${on ? "bg-indigo-600 text-white" : "border border-slate-700 text-slate-400 hover:border-slate-500"}`}>{w[0]}</button>; })}
                </div>
              </div>
            )}
            {rec && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[11px] text-slate-500">Ends</span>
                <ThemedSelect
                  value={rec.until ? "on" : "never"}
                  onChange={(v) => setRec({ until: v === "on" ? (rec.until || draft.date) : null })}
                  className={`${selTrigger} min-w-[7.5rem]`}
                  options={[{ value: "never", label: "Never" }, { value: "on", label: "On date" }]}
                />
                {rec.until && <DateInput min={draft.date} value={rec.until} onChange={(v) => setRec({ until: v })} className={`${field} w-auto`} />}
              </div>
            )}
            {rec && <p className="mt-1 text-[10px] text-slate-600">{recurrenceLabel(rec)}{exists ? " · on save you'll pick: this event or the whole series" : ""}</p>}
          </div>
          <div>
            <label className={lbl}>Remind me before</label>
            <div className="flex flex-wrap gap-1.5">
              {REMINDER_OPTIONS.map((r) => { const on = (draft.reminders ?? []).includes(r.minutes); return <button key={r.minutes} onClick={() => toggleReminder(r.minutes)} className={`rounded-full border px-2.5 py-1 text-[11px] ${on ? "border-indigo-500 bg-indigo-500/20 text-indigo-200" : "border-slate-700 text-slate-400 hover:border-slate-500"}`}>{r.label}</button>; })}
            </div>
            {!draft.time && <p className="mt-1 text-[10px] text-slate-600">Add a start time to receive reminders.</p>}
          </div>
          <div>
            <label className={lbl}>Board <span className="normal-case text-slate-600">(optional — shows in chat &amp; limits who you can invite)</span></label>
            <div className="flex flex-wrap items-center gap-2">
              <ThemedSelect
                value={draft.boardId ?? ""}
                onChange={(v) => set({ boardId: v || null, projectId: null })}
                className={`${selTrigger} min-w-[10rem]`}
                options={[{ value: "", label: "No board" }, ...myBoards.map((b) => ({ value: b.id, label: b.title }))]}
              />
              {draft.boardId && boardProjectList.length > 1 && (
                <ThemedSelect
                  value={draft.projectId ?? ""}
                  onChange={(v) => set({ projectId: v || null })}
                  className={`${selTrigger} min-w-[9rem]`}
                  options={[{ value: "", label: "All projects" }, ...boardProjectList.map((p) => ({ value: p.id, label: p.name }))]}
                />
              )}
            </div>
            {draft.boardId && <p className="mt-1 text-[10px] text-slate-600">Only this board&apos;s members can be invited below.</p>}
          </div>
          <div>
            <label className={lbl}>People <span className="normal-case text-slate-600">(invite — they'll see it on their calendar)</span></label>
            {invitees.length > 0 && (
              <div className="mb-1.5 flex flex-wrap gap-1.5">
                {invitees.map((i) => (
                  <span key={i.address} className="flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-200" title={i.address}>
                    {i.label}
                    <button onClick={() => setInvitees((p) => p.filter((x) => x.address !== i.address))} className="text-slate-500 hover:text-red-400">×</button>
                  </span>
                ))}
              </div>
            )}
            <InviteePicker address={address} exclude={invitees.map((i) => i.address)} onPick={addInvitee} restrictTo={draft.boardId ? boardMembers : null} />
          </div>
          <div>
            <label className={lbl}>Location</label>
            <LocationPicker value={draft.location ?? ""} field={field} onChange={(location) => set({ location })} />
          </div>
          <div><label className={lbl}>Notes</label><MentionInput multiline value={draft.notes ?? ""} onChange={(v) => set({ notes: v })} people={mentionList} rows={2} placeholder="Optional — @ to mention" className={`${field} resize-none`} /></div>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-slate-800 px-4 py-2.5">
          {exists ? (
            confirmDel ? (
              draft.recurrence ? (
                <span className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="text-slate-400">Delete:</span>
                  <button onClick={() => onDeleteOccurrence(draft.id, occDate)} className="rounded bg-slate-700 px-2 py-1 font-medium text-white hover:bg-slate-600">This event</button>
                  <button onClick={() => onDeleteSeries(draft.id)} className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-500">All events</button>
                  <button onClick={() => setConfirmDel(false)} className="text-slate-400 hover:text-slate-200">Cancel</button>
                </span>
              ) : (
                <span className="flex items-center gap-2"><span className="text-[11px] text-slate-400">Delete?</span><button onClick={() => onDeleteSeries(draft.id)} className="rounded bg-red-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-red-500">Yes</button><button onClick={() => setConfirmDel(false)} className="text-[11px] text-slate-400 hover:text-slate-200">No</button></span>
              )
            ) : (
              <button onClick={() => setConfirmDel(true)} className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-slate-400 hover:border-red-500/50 hover:text-red-400"><svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M10 11v6M14 11v6" /></svg>Delete</button>
            )
          ) : <span />}
          <div className="flex shrink-0 items-center gap-2">
            <button onClick={onClose} className="text-[11px] text-slate-400 hover:text-slate-200">Cancel</button>
            <button onClick={commit} disabled={!canSave} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-indigo-500 disabled:opacity-50">Save</button>
          </div>
        </div>
      </div>
      {askScope && (
        <ScopeModal
          title="Edit repeating event"
          message="Save your changes to just this one occurrence (it becomes an independent event), or to every event in the series?"
          onThis={() => { setAskScope(false); onSaveOccurrence(event.id, occDate, edited(), tokens()); }}
          onAll={() => { setAskScope(false); onSave(edited(), tokens()); }}
          onCancel={() => setAskScope(false)}
        />
      )}
    </div>,
    document.body,
  );
}
