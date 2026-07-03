// Timesheet (time-tracking) helpers. The timesheet is an ACTIVITY REPORT grouped by board:
// it aggregates time from four sources — manual timesheet entries, board-card worklog,
// calendar events, and Service Desk working-state time — for you (and, for managers, every
// member). Access is board membership (`timesheetBoards` == `loadBoards`), so a board you
// have no permission for never appears. See [[board-feature-architecture]].

import {
  TimesheetEntry,
  BoardMeta,
  WorkLog,
  loadBoards,
  loadBoardState,
  ticketLinkTargets,
  shortAddr,
  newId,
  canManage,
} from "./board";
import { BoardEvent, commitBoardEvents, syncBoardState } from "./boardSync";
import { CalEvent, loadEvents } from "./calendar";
import { allItsmRecords, workingTimeByDay, workingSpansByDay, itsmNumber } from "./itsm";

// ── dates / week math (weeks start Monday) ─────────────────────────────────────

export function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function weekStart(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7; // 0 = Monday
  x.setDate(x.getDate() - dow);
  return x;
}

export function addWeeks(start: Date, n: number): Date {
  const x = new Date(start);
  x.setDate(x.getDate() + n * 7);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

// The 42 days (6 weeks, Monday-start) that make up a month grid for `cursor`'s month.
export function monthGridDays(cursor: Date): string[] {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = weekStart(first);
  return Array.from({ length: 42 }, (_, i) => ymd(addDays(start, i)));
}

export const monthLabel = (cursor: Date): string => cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
export const dayTitle = (cursor: Date): string => cursor.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short", year: "numeric" });

// the 7 YYYY-MM-DD strings of the week beginning at `start` (a Monday).
export function weekDays(start: Date): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(start);
    x.setDate(x.getDate() + i);
    return ymd(x);
  });
}

export function dayLabel(date: string): { dow: string; dom: string } {
  const d = new Date(date + "T00:00:00");
  return { dow: d.toLocaleDateString(undefined, { weekday: "short" }), dom: d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) };
}

export function rangeLabel(start: Date): string {
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `${fmt(start)} – ${fmt(end)}, ${end.getFullYear()}`;
}

// ── boards / manual entries ─────────────────────────────────────────────────────

// The boards a wallet belongs to (owned or granted) — the timesheet rows.
export function timesheetBoards(addr: string | null): BoardMeta[] {
  return loadBoards(addr);
}

export function boardEntries(boardId: string): TimesheetEntry[] {
  return loadBoardState(boardId).timesheets ?? [];
}

// A deterministic id so editing the SAME cell (board/date for me) updates one entry rather
// than spawning duplicates. (No project axis — all projects roll up together by board.)
export function cellId(boardId: string, date: string, author: string): string {
  return `ts|${boardId}|${date}|${author}`;
}

// ── activity aggregation (the four sources) ─────────────────────────────────────

export type SourceKey = "manual" | "worklog" | "calendar" | "servicedesk" | "normal" | "holiday";
export interface DaySources { manual: number; worklog: number; calendar: number; servicedesk: number; normal: number; holiday: number }
const emptyDay = (): DaySources => ({ manual: 0, worklog: 0, calendar: 0, servicedesk: 0, normal: 0, holiday: 0 });
export const sourceTotal = (d: DaySources): number => d.manual + d.worklog + d.calendar + d.servicedesk + d.normal + d.holiday;

// inclusive list of YYYY-MM-DD between two dates (capped so a bad range can't loop forever).
export function daysBetween(startISO: string, endISO: string): string[] {
  const out: string[] = [];
  const end = new Date(endISO + "T00:00:00");
  const d = new Date(startISO + "T00:00:00");
  for (let i = 0; i < 400 && d <= end; i++) { out.push(ymd(d)); d.setDate(d.getDate() + 1); }
  return out;
}

export interface PersonActivity {
  who: string;                       // resolved address (or raw label if unknown)
  label: string;                     // display name
  byDay: Record<string, DaySources>; // per date in the requested range
  total: number;                     // sum over the range
}

const hm = (s?: string | null): number | null => {
  if (!s) return null;
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

// Hours a calendar event represents (needs both a start and end time).
export function eventHours(ev: CalEvent): number {
  const a = hm(ev.time), b = hm(ev.endTime);
  if (a == null || b == null) return 0;
  return b > a ? (b - a) / 60 : 0;
}

// Aggregate every source on a board over `dates`, grouped by person (resolving member
// labels → addresses so one person's time doesn't split across "You"/label/address).
// Calendar events are only visible for the current wallet, so they attribute to `me`.
export function boardActivityByPerson(boardId: string, dates: string[], me: string): PersonActivity[] {
  const st = loadBoardState(boardId);
  const known = new Set(st.members.map((m) => m.address));
  const byLabel = new Map(st.members.map((m) => [m.label, m.address] as const));
  const resolve = (who: string): string => {
    if (!who || who === "You") return me;
    if (known.has(who)) return who;
    return byLabel.get(who) ?? who;
  };
  const labelFor = (addr: string): string => {
    if (addr === me) return "You";
    return st.members.find((m) => m.address === addr)?.label ?? (addr.length > 12 ? shortAddr(addr) : addr);
  };

  const acc = new Map<string, Record<string, DaySources>>();
  const add = (who: string, date: string, key: SourceKey, hrs: number) => {
    if (!dates.includes(date) || hrs <= 0) return;
    let rec = acc.get(who);
    if (!rec) { rec = Object.fromEntries(dates.map((d) => [d, emptyDay()])); acc.set(who, rec); }
    rec[date][key] += hrs;
  };

  for (const e of st.timesheets ?? []) if (!e.id.startsWith("wk|") && !e.kind) add(resolve(e.author), e.date, "manual", e.hours);
  for (const t of st.tickets) for (const w of t.worklog ?? []) add(resolve(w.author), w.date, "worklog", w.hours || 0);
  for (const ev of loadEvents(me)) if (ev.boardId === boardId) add(me, ev.date, "calendar", eventHours(ev));
  for (const r of allItsmRecords(me)) {
    if (r.boardId !== boardId) continue;
    const who = resolve(r.assignee || r.createdBy || r.owner || me);
    const byDay = workingTimeByDay(r);
    for (const d of dates) if (byDay[d]) add(who, d, "servicedesk", byDay[d]);
  }

  return [...acc.entries()]
    .map(([who, byDay]) => ({ who, label: labelFor(who), byDay, total: dates.reduce((s, d) => s + sourceTotal(byDay[d]), 0) }))
    .filter((p) => p.total > 0)
    .sort((a, b) => b.total - a.total);
}

// My own activity on a board (the one person matching `me`), with zeroed days when absent.
export function myActivity(boardId: string, dates: string[], me: string): Record<string, DaySources> {
  const mine = boardActivityByPerson(boardId, dates, me).find((p) => p.who === me);
  return mine?.byDay ?? Object.fromEntries(dates.map((d) => [d, emptyDay()]));
}

// ── writes ───────────────────────────────────────────────────────────────────

// Apply timesheet/board events to their boards (local-first) + publish on shared boards.
export const commitTimesheet = (addr: string, items: { boardId: string; event: BoardEvent }[]): Promise<void> =>
  commitBoardEvents(addr, items);

// Log time onto a board TICKETS (adds a worklog entry to a ticket) from the timesheet — by a
// from/to time range, like a board worklog. A ticket is required.
export async function logCardTime(me: string, boardId: string, ticketId: string, date: string, from: string, to: string, title: string): Promise<void> {
  const t = loadBoardState(boardId).tickets.find((x) => x.id === ticketId);
  if (!t) return;
  const a = hm(from), b = hm(to);
  const hours = a != null && b != null && b > a ? (b - a) / 60 : 0;
  if (hours <= 0) return;
  const entry: WorkLog = { id: newId(), title: title || "", date, from, to, hours, description: "", author: "You", createdAt: Date.now() };
  const worklog = [...(t.worklog ?? []), entry];
  await commitBoardEvents(me, [{ boardId, event: { t: "ticket.update", ticketId, patch: { worklog } } }]);
}

// Edit an existing worklog entry on a card (replaces it in place by id).
export async function updateCardTime(me: string, boardId: string, ticketId: string, worklogId: string, date: string, from: string, to: string, title: string): Promise<void> {
  const t = loadBoardState(boardId).tickets.find((x) => x.id === ticketId);
  if (!t) return;
  const a = hm(from), b = hm(to);
  const hours = a != null && b != null && b > a ? (b - a) / 60 : 0;
  if (hours <= 0) return;
  const worklog = (t.worklog ?? []).map((w) => (w.id === worklogId ? { ...w, title: title || "", date, from, to, hours } : w));
  await commitBoardEvents(me, [{ boardId, event: { t: "ticket.update", ticketId, patch: { worklog } } }]);
}

// Remove a worklog entry from a card.
export async function deleteCardTime(me: string, boardId: string, ticketId: string, worklogId: string): Promise<void> {
  const t = loadBoardState(boardId).tickets.find((x) => x.id === ticketId);
  if (!t) return;
  const worklog = (t.worklog ?? []).filter((w) => w.id !== worklogId);
  await commitBoardEvents(me, [{ boardId, event: { t: "ticket.update", ticketId, patch: { worklog } } }]);
}

// The raw worklog + timesheet entry lookups (for editing).
export function findWorklog(boardId: string, worklogId: string): { ticketId: string; entry: WorkLog } | null {
  for (const t of loadBoardState(boardId).tickets) {
    const entry = (t.worklog ?? []).find((w) => w.id === worklogId);
    if (entry) return { ticketId: t.id, entry };
  }
  return null;
}
export function findTimesheetEntry(boardId: string, id: string): TimesheetEntry | undefined {
  return (loadBoardState(boardId).timesheets ?? []).find((e) => e.id === id);
}

// ── per-item week collection (for the calendar-style grid) ──────────────────────

export interface ActivityItem {
  id: string;
  boardId: string;
  boardTitle: string;
  who: string;       // resolved address
  whoLabel: string;
  date: string;      // YYYY-MM-DD
  source: SourceKey;
  hours: number;
  startMin?: number; // minutes from midnight (timed items only)
  endMin?: number;
  title: string;
  sub?: string;      // ticket key / record number
  status?: string;   // approval status (holiday/vacation requests only)
  entryId: string;   // the underlying record id (worklog/event/timesheet entry, or ITSM record)
  parentId?: string; // ticket id (worklog only)
}

// Every logged item across the given boards over `dates`, as individual entries (so the
// week grid can render them as blocks). Calendar items are the current wallet's only.
export function collectWeekItems(boardIds: string[], dates: string[], me: string): ActivityItem[] {
  const out: ActivityItem[] = [];
  const allTickets = ticketLinkTargets(me);
  for (const boardId of boardIds) {
    const meta = loadBoards(me).find((b) => b.id === boardId);
    const boardTitle = meta?.title ?? "Board";
    const st = loadBoardState(boardId);
    const known = new Set(st.members.map((m) => m.address));
    const byLabel = new Map(st.members.map((m) => [m.label, m.address] as const));
    const resolve = (who: string): string => (!who || who === "You" ? me : known.has(who) ? who : byLabel.get(who) ?? who);
    const labelFor = (addr: string): string => (addr === me ? "You" : st.members.find((m) => m.address === addr)?.label ?? (addr.length > 12 ? shortAddr(addr) : addr));
    const ticketKey = new Map(allTickets.filter((t) => t.boardId === boardId).map((t) => [t.ticketId, t.key] as const));
    const push = (who: string, p: Omit<ActivityItem, "boardId" | "boardTitle" | "who" | "whoLabel">) => {
      if (!dates.includes(p.date) || p.hours <= 0) return;
      out.push({ boardId, boardTitle, who, whoLabel: labelFor(who), ...p });
    };

    for (const e of st.timesheets ?? []) {
      if (e.id.startsWith("wk|")) continue; // week-submission markers aren't time
      if (e.kind === "normal" || e.kind === "holiday") {
        const who = resolve(e.author);
        const src: SourceKey = e.kind === "holiday" ? "holiday" : "normal";
        const status = e.kind === "holiday" ? e.status : undefined;
        const a = hm(e.from), b = hm(e.to);
        if (a != null && b != null && b > a) {
          // a timed marker — a single-day block with real hours.
          push(who, { id: e.id, entryId: e.id, date: e.date, source: src, hours: (b - a) / 60, startMin: a, endMin: b, title: e.title || "Time", status });
        } else {
          // an all-day marker — spans [date, endDate] across every day.
          for (const d of daysBetween(e.date, e.endDate || e.date)) {
            if (!dates.includes(d)) continue;
            out.push({ boardId, boardTitle, who, whoLabel: labelFor(who), id: `${e.id}@${d}`, entryId: e.id, date: d, source: src, hours: 0, title: e.title || e.note || (e.kind === "holiday" ? "Time off" : "Note"), sub: e.title, status });
          }
        }
        continue;
      }
      push(resolve(e.author), { id: e.id, entryId: e.id, date: e.date, source: "manual", hours: e.hours, title: e.note || "Manual entry" });
    }
    for (const t of st.tickets) for (const w of t.worklog ?? []) {
      const a = hm(w.from), b = hm(w.to);
      push(resolve(w.author), { id: w.id, entryId: w.id, parentId: t.id, date: w.date, source: "worklog", hours: w.hours || 0, startMin: a ?? undefined, endMin: b ?? undefined, title: w.title || ticketKey.get(t.id) || "Card", sub: ticketKey.get(t.id) });
    }
    for (const ev of loadEvents(me)) {
      if (ev.boardId !== boardId) continue;
      const a = hm(ev.time), b = hm(ev.endTime);
      push(me, { id: ev.id, entryId: ev.id, date: ev.date, source: "calendar", hours: eventHours(ev), startMin: a ?? undefined, endMin: b ?? undefined, title: ev.title || "Event" });
    }
    for (const r of allItsmRecords(me)) {
      if (r.boardId !== boardId) continue;
      const who = resolve(r.assignee || r.createdBy || r.owner || me);
      // a timed block PER working interval, at the real time it happened (not a fake all-day).
      const spans = workingSpansByDay(r);
      for (const d of dates) for (const sp of spans[d] ?? []) {
        push(who, { id: `${r.id}@${d}@${sp.start}`, entryId: r.id, date: d, source: "servicedesk", hours: (sp.end - sp.start) / 60, startMin: sp.start, endMin: sp.end, title: r.shortDescription || itsmNumber(r), sub: itsmNumber(r) });
      }
    }
  }
  return out;
}

// ── dashboard collection (a time WINDOW → activity items) ───────────────────────
// Every logged item across `boardIds` within the [startMs, endMs] window, for the Timesheet
// dashboard scope. VISIBILITY mirrors the Timesheet page: you always see your own time, and
// on boards you MANAGE (admin+) you also see the whole team — on boards where you're only an
// editor/viewer, others' hours never appear. `startMs === 0` means "all time" (earliest logged
// day → today, capped at ~400 days by daysBetween).
export function timesheetActivity(me: string, boardIds: string[], startMs: number, endMs: number): ActivityItem[] {
  const end = endMs || Date.now();
  const startISO = ymd(new Date(startMs > 0 ? startMs : (earliestActivity(boardIds, me) ?? end - 30 * 86_400_000)));
  const dates = daysBetween(startISO, ymd(new Date(end)));
  const items = collectWeekItems(boardIds, dates, me);
  const managed = new Set(loadBoards(me).filter((b) => canManage(b.role)).map((b) => b.id));
  return items.filter((it) => it.who === me || managed.has(it.boardId));
}

// The earliest logged day across the given boards (manual/worklog/calendar/service-desk), as a
// timestamp — so an "all time" window can start where the data actually begins.
function earliestActivity(boardIds: string[], me: string): number | null {
  let min: string | null = null;
  const consider = (d?: string | null) => { if (d && (!min || d < min)) min = d; };
  const ids = new Set(boardIds);
  for (const boardId of boardIds) {
    const st = loadBoardState(boardId);
    for (const e of st.timesheets ?? []) consider(e.date);
    for (const t of st.tickets) for (const w of t.worklog ?? []) consider(w.date);
  }
  for (const ev of loadEvents(me)) if (ids.has(ev.boardId ?? "")) consider(ev.date);
  for (const r of allItsmRecords(me)) if (ids.has(r.boardId ?? "")) consider(ymd(new Date(r.createdAt)));
  return min ? new Date(min + "T00:00:00").getTime() : null;
}

// ── weekly submission (a member submits a week; a manager approves it) ──────────
// Stored as a marker timesheet entry (id `wk|board|weekISO|author`, hours 0). Auto-tracked
// Service Desk / calendar time is informational and never gated — only the submission is.

export const submissionId = (boardId: string, weekISO: string, author: string): string => `wk|${boardId}|${weekISO}|${author}`;

export function weekSubmission(boardId: string, weekISO: string, author: string): TimesheetEntry | undefined {
  return (loadBoardState(boardId).timesheets ?? []).find((e) => e.id === submissionId(boardId, weekISO, author));
}

// Refresh team data: fold every shared board so managers see members' latest hours. Silent
// (cached keys only). Returns true if any board synced (caller can re-render).
export async function refreshTimesheet(me: string): Promise<boolean> {
  const shared = loadBoards(me).filter((b) => b.shared);
  let any = false;
  await Promise.all(shared.map(async (b) => { try { if (await syncBoardState(b.id, me)) any = true; } catch { /* ignore */ } }));
  return any;
}

export const TS_STATUS_LABEL: Record<TimesheetEntry["status"], string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

export const SOURCE_LABEL: Record<SourceKey, string> = {
  manual: "Manual",
  worklog: "Board tickets",
  calendar: "Calendar",
  servicedesk: "Service Desk",
  normal: "Normal",
  holiday: "Holiday / Vacation",
};

// Holiday/vacation requests on a board (the only thing that needs approval).
export function holidayRequests(boardId: string): TimesheetEntry[] {
  return (loadBoardState(boardId).timesheets ?? []).filter((e) => e.kind === "holiday");
}
