"use client";

// Timesheet — a calendar-style week view of every hour logged on a board: board-card
// worklog, calendar events and Service Desk working-state time, plus "Time off" markers.
// A board is chosen from the dropdown by the title (like the Dashboard scope). Managers
// (admin/owner) see every member and can filter who's shown. See [[board-feature-architecture]].

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  Role,
  canEdit,
  canManage,
  fmtDuration,
  ticketLinkTargets,
  loadBoardState,
  shortAddr,
  newId,
  TimesheetEntry,
  type WorkLog,
} from "@/lib/board";
import { BoardEvent } from "@/lib/boardSync";
import { newEvent, loadEvents, saveEvents, type CalEvent } from "@/lib/calendar";
import { shareEvent, deleteSharedEvent } from "@/lib/calendarSync";
import { EventEditor } from "./CalendarView";
import { RelatedLinks } from "./RelatedLinks";
import {
  timesheetBoards,
  weekStart,
  weekDays,
  addWeeks,
  addDays,
  addMonths,
  monthGridDays,
  monthLabel,
  dayTitle,
  ymd,
  dayLabel,
  rangeLabel,
  collectWeekItems,
  holidayRequests,
  refreshTimesheet,
  commitTimesheet,
  logCardTime,
  updateCardTime,
  deleteCardTime,
  findWorklog,
  findTimesheetEntry,
  SOURCE_LABEL,
  type ActivityItem,
  type SourceKey,
} from "@/lib/timesheet";
import { ThemedSelect, ThemedCombo, type Opt } from "./BoardDropdowns";
import { PeriodPicker } from "./PeriodPicker";
import { DateInput } from "./DateInput";
import { MentionInput } from "./MentionInput";
import { TimeField } from "./TimeField";
import { mentionPeople } from "@/lib/mentions";

type Toast = (m: string, t?: "error" | "info" | "warning" | "success") => void;
type Board = { id: string; title: string; role: Role };

const HOUR_H = 40; // px per hour
const SRC: Record<SourceKey, { dot: string; block: string; text: string }> = {
  manual: { dot: "bg-indigo-400", block: "border-indigo-500/40 bg-indigo-500/15", text: "text-indigo-200" },
  worklog: { dot: "bg-sky-400", block: "border-sky-500/40 bg-sky-500/15", text: "text-sky-200" },
  calendar: { dot: "bg-violet-400", block: "border-violet-500/40 bg-violet-500/15", text: "text-violet-200" },
  servicedesk: { dot: "bg-amber-400", block: "border-amber-500/40 bg-amber-500/15", text: "text-amber-200" },
  normal: { dot: "bg-emerald-400", block: "border-emerald-500/40 bg-emerald-500/15", text: "text-emerald-200" },
  holiday: { dot: "bg-teal-400", block: "border-teal-500/40 bg-teal-500/15", text: "text-teal-200" },
};
const STATUS_TAG: Record<string, string> = { submitted: "pending", approved: "approved", rejected: "rejected" };
// Approval status as a themed SVG (clock / check / cross) rather than an emoji.
function StatusIcon({ status, className }: { status: string; className?: string }) {
  const cls = `h-3 w-3 shrink-0 ${className ?? ""}`;
  if (status === "approved") return <svg className={`${cls} text-emerald-400`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>;
  if (status === "rejected") return <svg className={`${cls} text-rose-400`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>;
  return <svg className={`${cls} text-amber-400`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="9" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5V12l3 2" /></svg>;
}
const minToHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// "11"/"11:" → "11:00", "1130" → "11:30"; clamps to 24h (mirrors the board worklog input).
function normalizeTime(s: string): string {
  const t = (s || "").trim();
  if (!t) return "";
  let h: number, m: number;
  if (t.includes(":")) { const [hp, mp] = t.split(":"); h = parseInt(hp, 10); m = mp ? parseInt(mp, 10) : 0; }
  else if (/^\d+$/.test(t)) { if (t.length <= 2) { h = parseInt(t, 10); m = 0; } else { h = parseInt(t.slice(0, -2), 10); m = parseInt(t.slice(-2), 10); } }
  else return t;
  if (!Number.isFinite(h)) return "";
  if (!Number.isFinite(m)) m = 0;
  h = Math.min(23, Math.max(0, h)); m = Math.min(59, Math.max(0, m));
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export default function TimesheetView({ address, onToast }: { address: string; onToast: Toast }) {
  const [version, force] = useReducer((x) => x + 1, 0);
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [view, setView] = useState<"day" | "week" | "month">("week");
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const [scope, setScope] = useState<string>(() => (timesheetBoards(address)[0]?.id ?? "")); // the selected board
  const [addOpen, setAddOpen] = useState(false);
  const [addEvent, setAddEvent] = useState<CalEvent | null>(null);
  const [form, setForm] = useState<null | "card" | "normal" | "holiday">(null);
  const [menuItem, setMenuItem] = useState<ActivityItem | null>(null); // a clicked block (edit/delete)
  const [editEvent, setEditEvent] = useState<CalEvent | null>(null);
  const [editWork, setEditWork] = useState<{ boardId: string; ticketId: string; entry: WorkLog } | null>(null);
  const [editNormal, setEditNormal] = useState<{ boardId: string; entry: TimesheetEntry } | null>(null);

  const days = useMemo(() => (view === "day" ? [ymd(cursor)] : view === "month" ? monthGridDays(cursor) : weekDays(weekStart(cursor))), [view, cursor]);
  const rangeISO = days[0];
  const todayISO = ymd(new Date());
  const allBoards = timesheetBoards(address) as Board[];
  const activeScope = allBoards.some((b) => b.id === scope) ? scope : (allBoards[0]?.id ?? "");
  const boards = allBoards.filter((b) => b.id === activeScope);
  const editableBoards = boards.filter((b) => canEdit(b.role));
  const managed = boards.filter((b) => canManage(b.role));
  const isManager = managed.length > 0;
  const scopeBoardId = activeScope;

  useEffect(() => { let on = true; refreshTimesheet(address).then((changed) => { if (on && changed) force(); }); return () => { on = false; }; }, [address, rangeISO]);

  // Whether I can see OTHER members' time on a given board — only where I'm a manager
  // (admin/owner). This is PER BOARD: being a manager on one board must not reveal others'
  // time on a board where I'm just an editor/viewer (the "All" leak).
  const canSeeOthersOn = (boardId: string) => canManage(allBoards.find((b) => b.id === boardId)?.role);
  const items = useMemo(() => collectWeekItems(boards.map((b) => b.id), days, address), [activeScope, days, address, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const persons = useMemo(() => {
    const m = new Map<string, string>();
    for (const it of items) if (it.who === address || canSeeOthersOn(it.boardId)) if (!m.has(it.who)) m.set(it.who, it.whoLabel);
    return [...m.entries()].map(([who, label]) => ({ who, label }));
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps
  const visible = items.filter((it) => (canSeeOthersOn(it.boardId) ? !hidden.has(it.who) : it.who === address));
  const showWho = visible.some((it) => it.who !== address);

  const byDay = useMemo(() => {
    const m = new Map<string, ActivityItem[]>();
    for (const it of visible) { const a = m.get(it.date) ?? []; a.push(it); m.set(it.date, a); }
    return m;
  }, [visible]);
  const dayTotal = (d: string) => (byDay.get(d) ?? []).reduce((s, it) => s + it.hours, 0);
  const weekTotal = days.reduce((s, d) => s + dayTotal(d), 0);

  async function commit(events: { boardId: string; event: BoardEvent }[]) {
    if (events.length === 0) return;
    setBusy(true);
    try { await commitTimesheet(address, events); }
    catch { onToast("Couldn't save.", "error"); }
    finally { setBusy(false); force(); }
  }
  async function refresh() { setBusy(true); try { await refreshTimesheet(address); } finally { setBusy(false); force(); } }

  // Manager approves/rejects a holiday/vacation request (the entry already exists, so
  // timesheet.status applies and is manager-gated in the fold).
  async function review(boardId: string, entryId: string, status: "approved" | "rejected") {
    await commit([{ boardId, event: { t: "timesheet.status", id: entryId, status, approvedBy: address } }]);
    onToast(status === "approved" ? "Holiday approved." : "Holiday rejected.", "success");
  }

  // You can edit/remove your OWN entries (editor+); managers can edit ANYONE's on their
  // board. Service Desk time is derived from a record's history, so it isn't editable here.
  function permit(item: ActivityItem): boolean {
    if (item.source === "servicedesk") return false;
    const role = allBoards.find((b) => b.id === item.boardId)?.role;
    return item.who === address ? canEdit(role) : canManage(role);
  }
  function openEdit(item: ActivityItem) {
    setMenuItem(null);
    if (item.source === "worklog") { const w = findWorklog(item.boardId, item.entryId); if (w) setEditWork({ boardId: item.boardId, ticketId: w.ticketId, entry: w.entry }); }
    else if (item.source === "calendar") { const ev = loadEvents(address).find((e) => e.id === item.entryId); if (ev) setEditEvent(ev); }
    else { const e = findTimesheetEntry(item.boardId, item.entryId); if (e) setEditNormal({ boardId: item.boardId, entry: e }); }
  }
  // One click: editable items open their editor straight away; the rest show read-only info.
  const openItem = (item: ActivityItem) => (permit(item) ? openEdit(item) : setMenuItem(item));
  async function del(item: ActivityItem) {
    setMenuItem(null);
    if (item.source === "worklog") { if (item.parentId) await commitWrap(() => deleteCardTime(address, item.boardId, item.parentId!, item.entryId)); }
    else if (item.source === "calendar") {
      const ev = loadEvents(address).find((e) => e.id === item.entryId);
      saveEvents(address, loadEvents(address).filter((e) => e.id !== item.entryId));
      if (ev?.invitees?.length) deleteSharedEvent(address, item.entryId).catch(() => {});
      force();
    } else {
      await commit([{ boardId: item.boardId, event: { t: "timesheet.delete", id: item.entryId, author: item.who } }]);
    }
    onToast("Removed.", "success");
  }
  async function commitWrap(fn: () => Promise<void>) { setBusy(true); try { await fn(); } catch { onToast("Couldn't save.", "error"); } finally { setBusy(false); force(); } }

  const go = (n: number) => setCursor((c) => (view === "day" ? addDays(c, n) : view === "month" ? addMonths(c, n) : addWeeks(c, n)));
  const rangeText = view === "day" ? dayTitle(cursor) : view === "month" ? monthLabel(cursor) : rangeLabel(weekStart(cursor));
  const addBoards = editableBoards.length ? editableBoards : allBoards.filter((b) => canEdit(b.role));

  // pending holiday/vacation requests awaiting MY approval, per managed board (for the badges).
  const approvals = useMemo(() => {
    const m: Record<string, number> = {};
    for (const b of allBoards) if (canManage(b.role)) m[b.id] = holidayRequests(b.id).filter((e) => e.author !== address && e.status === "submitted").length;
    return m;
  }, [allBoards, address, version]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="w-full">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-lg font-semibold text-white">Timesheet</h2>
            <BoardScope scope={activeScope} boards={allBoards} approvals={approvals} onChange={(s) => { setScope(s); }} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {(["worklog", "calendar", "servicedesk", "holiday", "normal"] as const).map((k) => (
              <span key={k} className="flex items-center gap-1.5 text-[11px] text-slate-400"><span className={`h-2 w-2 rounded-full ${SRC[k].dot}`} />{SOURCE_LABEL[k]}</span>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg border border-slate-800 bg-slate-900/50 p-0.5 text-xs">
            {(["day", "week", "month"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={`rounded-md px-2.5 py-1 font-medium capitalize ${view === v ? "bg-indigo-600/20 text-indigo-300" : "text-slate-400 hover:text-slate-200"}`}>{v}</button>
            ))}
          </div>
          <PeriodPicker view={view} cursor={cursor} label={rangeText} weekStartOf={weekStart} onPrev={() => go(-1)} onNext={() => go(1)} onPick={(d) => setCursor(d)} />
          <button onClick={() => setCursor(new Date())} className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700 hover:text-slate-100">Today</button>
          <button onClick={refresh} disabled={busy} title="Refresh team data" className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-slate-300 hover:bg-slate-700 disabled:opacity-60"><svg className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M5 9a7 7 0 0111-3M19 15a7 7 0 01-11 3" /></svg></button>
          {isManager && (
            <div className="relative">
              <button onClick={() => setFilterOpen((v) => !v)} title="Filter members" className={`relative rounded-lg border p-1.5 ${hidden.size > 0 ? "border-indigo-500/50 bg-indigo-600/15 text-indigo-200" : "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"}`}>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 5h18M6 12h12M10 19h4" /></svg>
                {hidden.size > 0 && <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-indigo-500 px-0.5 text-[9px] font-semibold text-white">{persons.length - hidden.size}</span>}
              </button>
              {filterOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setFilterOpen(false)} />
                  <div className="absolute right-0 z-50 mt-1 w-56 rounded-xl border border-slate-700 bg-slate-900 p-2 shadow-xl">
                    <div className="flex items-center justify-between px-1 pb-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Show members</span>
                      <div className="flex gap-1.5 text-[11px]">
                        <button onClick={() => setHidden(new Set())} className="text-indigo-300 hover:text-indigo-200">All</button>
                        <button onClick={() => setHidden(new Set(persons.filter((p) => p.who !== address).map((p) => p.who)))} className="text-indigo-300 hover:text-indigo-200">Only me</button>
                      </div>
                    </div>
                    <div className="max-h-60 space-y-0.5 overflow-y-auto">
                      {persons.length === 0 && <p className="px-2 py-2 text-[11px] text-slate-600">No activity this week.</p>}
                      {persons.map((p) => {
                        const on = !hidden.has(p.who);
                        return (
                          <button key={p.who} onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(p.who)) n.delete(p.who); else n.add(p.who); return n; })} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800">
                            <span className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${on ? "border-indigo-400 bg-indigo-500" : "border-slate-600"}`}>{on && <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}</span>
                            <span className="truncate">{p.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
          <button onClick={() => setAddOpen(true)} disabled={addBoards.length === 0} className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>Add time
          </button>
        </div>
      </div>

      {allBoards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 px-6 py-12 text-center text-sm text-slate-500">You don&apos;t have any boards yet. Create or join a board to start logging time.</div>
      ) : (
        <>
          {view === "month"
            ? <MonthGrid days={days} cursor={cursor} todayISO={todayISO} byDay={byDay} dayTotal={dayTotal} onPickDay={(d) => { setCursor(new Date(d + "T00:00:00")); setView("day"); }} />
            : <WeekGrid days={days} todayISO={todayISO} byDay={byDay} dayTotal={dayTotal} weekTotal={weekTotal} showWho={showWho} onItem={openItem} />}
          {isManager && <Approvals address={address} boards={managed} busy={busy} review={review} />}
        </>
      )}

      {addOpen && (
        <AddChooser
          onClose={() => setAddOpen(false)}
          onEvent={() => { setAddOpen(false); const ev = newEvent(todayISO, "task"); if (scopeBoardId) ev.boardId = scopeBoardId; setAddEvent(ev); }}
          onCard={() => { setAddOpen(false); setForm("card"); }}
          onNormal={() => { setAddOpen(false); setForm("normal"); }}
          onHoliday={() => { setAddOpen(false); setForm("holiday"); }}
        />
      )}
      {addEvent && (
        <EventEditor
          event={addEvent}
          occDate={addEvent.date}
          address={address}
          exists={false}
          onClose={() => setAddEvent(null)}
          onSave={async (e, tokens) => {
            saveEvents(address, [...loadEvents(address), e]);
            if (tokens.length || e.invitees?.length) { try { await shareEvent(address, e, tokens); } catch { onToast("Couldn't share the event with everyone.", "error"); } }
            setAddEvent(null); force(); onToast("Added to your calendar.", "success");
          }}
          onSaveOccurrence={() => {}}
          onDeleteSeries={() => {}}
          onDeleteOccurrence={() => {}}
        />
      )}
      {form === "card" && (
        <WorklogForm address={address} boards={addBoards} lockedBoard={scopeBoardId} weekISO={todayISO} onClose={() => setForm(null)} onSaved={() => { setForm(null); force(); onToast("Logged on the card.", "success"); }} onToast={onToast} />
      )}
      {(form === "normal" || form === "holiday") && (
        <NormalForm kind={form} address={address} boards={addBoards} lockedBoard={scopeBoardId} weekISO={todayISO} onClose={() => setForm(null)} onSaved={() => { setForm(null); force(); onToast(form === "holiday" ? "Holiday request submitted for approval." : "Added to your timesheet.", "success"); }} onToast={onToast} commit={commit} />
      )}

      {menuItem && <EditMenu item={menuItem} canEdit={permit(menuItem)} onClose={() => setMenuItem(null)} onEdit={() => openEdit(menuItem)} onDelete={() => del(menuItem)} />}
      {editEvent && (
        <EventEditor
          event={editEvent}
          occDate={editEvent.date}
          address={address}
          exists
          onClose={() => setEditEvent(null)}
          onSave={async (e, tokens) => {
            saveEvents(address, loadEvents(address).map((x) => (x.id === e.id ? e : x)));
            if (tokens.length || e.invitees?.length) { try { await shareEvent(address, e, tokens); } catch { onToast("Couldn't share the event.", "error"); } }
            setEditEvent(null); force(); onToast("Event updated.", "success");
          }}
          onSaveOccurrence={async (_sid, _d, e, tokens) => { saveEvents(address, loadEvents(address).map((x) => (x.id === e.id ? e : x))); if (tokens.length || e.invitees?.length) { try { await shareEvent(address, e, tokens); } catch {} } setEditEvent(null); force(); }}
          onDeleteSeries={(id) => { const ev = loadEvents(address).find((x) => x.id === id); saveEvents(address, loadEvents(address).filter((x) => x.id !== id)); if (ev?.invitees?.length) deleteSharedEvent(address, id).catch(() => {}); setEditEvent(null); force(); }}
          onDeleteOccurrence={(id) => { saveEvents(address, loadEvents(address).filter((x) => x.id !== id)); setEditEvent(null); force(); }}
        />
      )}
      {editWork && (
        <WorklogForm address={address} boards={addBoards} lockedBoard={editWork.boardId} weekISO={todayISO} edit={editWork} onClose={() => setEditWork(null)} onSaved={() => { setEditWork(null); force(); onToast("Updated.", "success"); }} onToast={onToast} onDelete={async () => { await commitWrap(() => deleteCardTime(address, editWork.boardId, editWork.ticketId, editWork.entry.id)); setEditWork(null); onToast("Removed.", "success"); }} />
      )}
      {editNormal && (
        <NormalForm kind={editNormal.entry.kind === "holiday" ? "holiday" : "normal"} edit={editNormal.entry} address={address} boards={addBoards} lockedBoard={editNormal.boardId} weekISO={todayISO} onClose={() => setEditNormal(null)} onSaved={() => { setEditNormal(null); force(); onToast("Updated.", "success"); }} onToast={onToast} commit={commit} onDelete={async () => { await commit([{ boardId: editNormal.boardId, event: { t: "timesheet.delete", id: editNormal.entry.id, author: editNormal.entry.author } }]); setEditNormal(null); onToast("Removed.", "success"); }} />
      )}
    </div>
  );
}

// click a block → details + Edit/Delete (gated by role).
function EditMenu({ item, canEdit: allowed, onClose, onEdit, onDelete }: { item: ActivityItem; canEdit: boolean; onClose: () => void; onEdit: () => void; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <Modal onClose={onClose} title={item.title || "Entry"} subtitle={`${SOURCE_LABEL[item.source]} · ${item.boardTitle}${item.whoLabel ? ` · ${item.whoLabel}` : ""}`}>
      <div className="mt-3 text-xs text-slate-400">
        {item.date}{item.startMin != null && item.endMin != null ? ` · ${minToHHMM(item.startMin)}–${minToHHMM(item.endMin)}` : ""}{item.hours > 0 ? ` · ${fmtDuration(item.hours)}` : ""}{item.status ? ` · ${STATUS_TAG[item.status] ?? item.status}` : ""}
      </div>
      <div className="mt-5 flex items-center justify-between">
        {allowed ? (
          confirm
            ? <div className="flex items-center gap-2 text-xs"><span className="text-slate-400">Delete?</span><button onClick={onDelete} className="rounded-lg bg-rose-600/90 px-3 py-1.5 font-medium text-white hover:bg-rose-500">Yes, delete</button><button onClick={() => setConfirm(false)} className="text-slate-400 hover:text-slate-200">Cancel</button></div>
            : <button onClick={() => setConfirm(true)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:border-rose-500/50 hover:text-rose-300">Delete</button>
        ) : <span className="text-xs text-slate-600">{item.source === "servicedesk" ? "Tracked from Service Desk — edit the record." : "Read-only"}</span>}
        {allowed && !confirm && <button onClick={onEdit} className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-500">Edit</button>}
      </div>
    </Modal>
  );
}

// ── board scope dropdown (same compact style as the Dashboard scope) ─────────────

function BoardScope({ scope, boards, approvals, onChange }: { scope: string; boards: Board[]; approvals: Record<string, number>; onChange: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, [open]);
  const label = boards.find((b) => b.id === scope)?.title ?? (boards.length ? "Board" : "No boards");
  const otherPending = Object.entries(approvals).reduce((s, [id, n]) => s + (id === scope ? 0 : n), 0); // requests on OTHER boards
  const itemCls = (active: boolean) => `flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${active ? "bg-indigo-600/20 text-indigo-200" : "text-slate-300 hover:bg-slate-800"}`;
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} title="Choose a board" className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-medium text-slate-200 hover:border-slate-500">
        <span className="max-w-[10rem] truncate">{label}</span>
        {otherPending > 0 && <span title={`${otherPending} request(s) to approve on other boards`} className="flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">{otherPending}</span>}
        <svg className={`h-3.5 w-3.5 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="absolute left-0 z-50 mt-1 max-h-80 w-60 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-2xl">
          {boards.length === 0 && <p className="px-3 py-2 text-[11px] text-slate-600">No boards yet.</p>}
          {boards.map((b) => (
            <button key={b.id} onClick={() => { onChange(b.id); setOpen(false); }} className={itemCls(scope === b.id)}>
              <span className="truncate">{b.title}</span>
              {(approvals[b.id] ?? 0) > 0 && <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">{approvals[b.id]}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── the week grid (calendar layout; all-day items live INSIDE the grid) ──────────

function WeekGrid({ days, todayISO, byDay, dayTotal, weekTotal, showWho, onItem }: {
  days: string[];
  todayISO: string;
  byDay: Map<string, ActivityItem[]>;
  dayTotal: (d: string) => number;
  weekTotal: number;
  showWho: boolean;
  onItem: (it: ActivityItem) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-800">
      {/* Scrolls horizontally when the columns don't fit; the grid keeps a comfortable min width. */}
      <div className="overflow-x-auto">
        <div style={{ minWidth: `calc(3rem + ${days.length} * 6rem)` }}>
        <div className="sticky top-0 z-30 grid border-b border-slate-800 bg-slate-900" style={{ gridTemplateColumns: `3rem repeat(${days.length}, minmax(0, 1fr))` }}>
          <div className="px-1 py-2 text-right text-[10px] font-medium text-slate-600">Wk {fmtDuration(weekTotal)}</div>
          {days.map((d) => {
            const { dow } = dayLabel(d);
            const dom = new Date(d + "T00:00:00").getDate();
            const t = dayTotal(d);
            return (
              <div key={d} className={`border-l border-slate-800 px-2 py-2 text-center ${d === todayISO ? "bg-indigo-500/10" : ""}`}>
                <div className={`text-xs font-medium ${d === todayISO ? "text-indigo-300" : "text-slate-300"}`}>{dow} <span className={d === todayISO ? "text-indigo-200" : "text-slate-200"}>{dom}</span></div>
                <div className="text-[10px] text-slate-500">{t > 0 ? fmtDuration(t) : "–"}</div>
              </div>
            );
          })}
        </div>
        <div className="grid" style={{ gridTemplateColumns: `3rem repeat(${days.length}, minmax(0, 1fr))` }}>
          <div className="relative" style={{ height: 24 * HOUR_H }}>
            {Array.from({ length: 24 }, (_, h) => <div key={h} style={{ height: HOUR_H }}><span className="absolute right-1 -mt-1.5 text-[9px] text-slate-600">{h === 0 ? "" : `${h}:00`}</span></div>)}
          </div>
          {days.map((d) => {
            const list = byDay.get(d) ?? [];
            // ONE unified greedy packing over ALL records (Service Desk, calendar, cards,
            // holidays). Each gets a span: timed items use their hours; an all-day item with no
            // time spans the whole day. Non-overlapping items SHARE a lane, so a single record
            // fills the column and items reuse the free space of others (no empty columns).
            const placed = packDay(list);
            const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
            return (
              <div key={d} className="relative border-l border-slate-800" style={{ height: 24 * HOUR_H }}>
                {Array.from({ length: 24 }, (_, h) => <div key={h} style={{ height: HOUR_H }} className="border-b border-slate-800/40" />)}
                {d === todayISO && <div className="pointer-events-none absolute inset-x-0 z-20 border-t border-rose-500" style={{ top: (nowMin / 60) * HOUR_H }}><span className="absolute -top-[3px] left-0 h-1.5 w-1.5 rounded-full bg-rose-500" /></div>}
                {placed.map(({ it, s, e, lane, lanes, span }) => {
                  const top = (s / 60) * HOUR_H;
                  const height = Math.max(15, ((e - s) / 60) * HOUR_H);
                  const c = SRC[it.source];
                  const timed = it.startMin != null;
                  const width = `calc(${(span * 100) / lanes}% - 3px)`;
                  const left = `calc(${(lane * 100) / lanes}% + 1px)`;
                  return (
                    <button key={it.id} onClick={() => onItem(it)} title={`${it.title} · ${it.hours > 0 ? fmtDuration(it.hours) : "all day"}${showWho ? ` · ${it.whoLabel}` : ""} — click to edit`} style={{ top, height, width, left }} className={`absolute z-10 overflow-hidden rounded border px-1 py-0.5 text-left ${c.block}`}>
                      <div className={`flex items-center gap-1 text-[10px] leading-tight ${c.text}`}><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${c.dot}`} /><span className="truncate font-medium">{it.sub || it.title}</span>{it.status ? <span title={STATUS_TAG[it.status] ?? it.status} className="shrink-0"><StatusIcon status={it.status} /></span> : null}</div>
                      <div className="truncate text-[9px] text-slate-400">{timed ? `${minToHHMM(s)}–${minToHHMM(e)}` : "all day"}{it.hours > 0 ? ` · ${fmtDuration(it.hours)}` : ""}{showWho ? ` · ${it.whoLabel}` : ""}</div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        </div>
      </div>
    </div>
  );
}

// Google-Calendar-style layout: each item gets a [start,end] span (timed items use their
// hours; an item with no time spans the whole day), items are grouped into overlap CLUSTERS,
// packed into columns, then each item EXPANDS to the right into any free columns. So a record
// alone at its time fills the whole column even if another part of the day is crowded, two
// overlapping share half each, three share thirds, etc.
type Span = { it: ActivityItem; s: number; e: number };
type Placed = { it: ActivityItem; s: number; e: number; lane: number; lanes: number; span: number };
const overlaps = (a: { s: number; e: number }, b: { s: number; e: number }) => a.s < b.e && b.s < a.e;

function packDay(list: ActivityItem[]): Placed[] {
  const spans: Span[] = list.map((it) => ({ it, s: it.startMin ?? 0, e: it.endMin != null && it.endMin > (it.startMin ?? 0) ? it.endMin : 1440 }));
  spans.sort((a, b) => a.s - b.s || a.e - b.e);

  const out: Placed[] = [];
  let columns: Span[][] = []; // the current cluster's columns (each a non-overlapping list)
  let clusterEnd = -1;

  const flush = () => {
    const lanes = columns.length;
    columns.forEach((col, ci) => col.forEach((sp) => {
      // expand right while the columns to the right are free during this item's time
      let span = 1;
      for (let j = ci + 1; j < lanes; j++) {
        if (columns[j].some((o) => overlaps(o, sp))) break;
        span++;
      }
      out.push({ it: sp.it, s: sp.s, e: sp.e, lane: ci, lanes, span });
    }));
    columns = [];
  };

  for (const sp of spans) {
    if (clusterEnd !== -1 && sp.s >= clusterEnd) { flush(); clusterEnd = -1; } // a gap → new cluster
    let placed = false;
    for (const col of columns) { if (col[col.length - 1].e <= sp.s) { col.push(sp); placed = true; break; } }
    if (!placed) columns.push([sp]);
    clusterEnd = Math.max(clusterEnd, sp.e);
  }
  flush();
  return out;
}

// ── month view (a calendar grid of daily totals + a few chips) ───────────────────

function MonthGrid({ days, cursor, todayISO, byDay, dayTotal, onPickDay }: {
  days: string[];
  cursor: Date;
  todayISO: string;
  byDay: Map<string, ActivityItem[]>;
  dayTotal: (d: string) => number;
  onPickDay: (d: string) => void;
}) {
  const month = cursor.getMonth();
  return (
    <div className="overflow-hidden rounded-xl border border-slate-800">
      <div className="overflow-x-auto">
        <div className="min-w-[44rem]">
      <div className="grid grid-cols-7 border-b border-slate-800 bg-slate-900/60 text-center text-[10px] uppercase tracking-wide text-slate-500">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="py-1.5">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const list = byDay.get(d) ?? [];
          const t = dayTotal(d);
          const dt = new Date(d + "T00:00:00");
          const inMonth = dt.getMonth() === month;
          const isToday = d === todayISO;
          return (
            <button key={d} onClick={() => onPickDay(d)} title="Open this day" className={`flex h-24 flex-col border-b border-l border-slate-800/60 p-1 text-left align-top hover:bg-slate-800/40 ${inMonth ? "" : "opacity-40"} ${isToday ? "bg-indigo-500/5" : ""}`}>
              <div className="flex items-center justify-between">
                <span className={`text-xs ${isToday ? "flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 font-semibold text-white" : "text-slate-300"}`}>{dt.getDate()}</span>
                {t > 0 && <span className="text-[10px] font-medium text-slate-400">{fmtDuration(t)}</span>}
              </div>
              <div className="mt-0.5 min-h-0 flex-1 space-y-0.5 overflow-hidden">
                {list.slice(0, 3).map((it) => { const c = SRC[it.source]; return <div key={it.id} className={`flex items-center gap-1 truncate rounded border px-1 text-[9px] ${c.block} ${c.text}`}><span className={`h-1 w-1 shrink-0 rounded-full ${c.dot}`} /><span className="truncate">{it.sub || it.title}</span></div>; })}
                {list.length > 3 && <div className="px-1 text-[9px] text-slate-500">+{list.length - 3} more</div>}
              </div>
            </button>
          );
        })}
      </div>
        </div>
      </div>
    </div>
  );
}

// ── manager: weekly approvals ───────────────────────────────────────────────────

// Managers approve/reject holiday & vacation REQUESTS (the only thing needing sign-off).
function Approvals({ address, boards, busy, review }: {
  address: string;
  boards: Board[];
  busy: boolean;
  review: (boardId: string, entryId: string, status: "approved" | "rejected") => void;
}) {
  const statusDot: Record<string, string> = { submitted: "bg-amber-400", approved: "bg-emerald-400", rejected: "bg-rose-400" };
  const fmtSpan = (e: TimesheetEntry) => {
    if (e.from && e.to) return `${e.date} · ${e.from}–${e.to}`;
    return e.endDate && e.endDate !== e.date ? `${e.date} → ${e.endDate}` : e.date;
  };
  const groups = boards.map((b) => {
    const members = loadBoardState(b.id).members;
    const nameOf = (addr: string) => (addr === address ? "You" : members.find((m) => m.address === addr)?.label ?? (addr.length > 12 ? shortAddr(addr) : addr));
    const reqs = holidayRequests(b.id).filter((e) => e.author !== address).sort((a, c) => (a.status === "submitted" ? -1 : 1) - (c.status === "submitted" ? -1 : 1) || a.date.localeCompare(c.date));
    return { b, reqs, nameOf };
  });
  if (!groups.some((g) => g.reqs.length > 0)) return null;
  return (
    <div className="mt-6">
      <h3 className="mb-2 text-sm font-semibold text-white">Holiday &amp; vacation requests</h3>
      <div className="space-y-4">
        {groups.filter((g) => g.reqs.length > 0).map(({ b, reqs, nameOf }) => (
          <div key={b.id} className="rounded-xl border border-slate-800">
            <div className="border-b border-slate-800 px-4 py-2.5 text-sm font-semibold text-white">{b.title}</div>
            <div className="divide-y divide-slate-800/70">
              {reqs.map((e) => {
                const status = e.status === "approved" || e.status === "rejected" ? e.status : "submitted";
                return (
                  <div key={e.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className={`h-2 w-2 rounded-full ${statusDot[status]}`} />
                      <div>
                        <div className="text-sm text-slate-100">{nameOf(e.author)} · <span className="text-slate-300">{e.title || "Time off"}</span></div>
                        <div className="flex items-center gap-1 text-xs text-slate-500">{fmtSpan(e)} · <StatusIcon status={status} /> {STATUS_TAG[status] ?? status}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => review(b.id, e.id, "rejected")} disabled={busy || status === "rejected"} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-rose-500/50 hover:text-rose-300 disabled:opacity-40">Reject</button>
                      <button onClick={() => review(b.id, e.id, "approved")} disabled={busy || status === "approved"} className="rounded-lg bg-emerald-600/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40">Approve</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── add: chooser + the three forms ──────────────────────────────────────────────

function AddChooser({ onClose, onEvent, onCard, onNormal, onHoliday }: { onClose: () => void; onEvent: () => void; onCard: () => void; onNormal: () => void; onHoliday: () => void }) {
  const card = "flex flex-col items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-center";
  return (
    <Modal onClose={onClose} title="Add time" subtitle="Log a calendar event, board-ticket time, a normal entry, or request a holiday/vacation.">
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button onClick={onEvent} className={`${card} hover:border-violet-500/50 hover:bg-slate-900`}>
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300"><svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><rect x="3" y="5" width="18" height="16" rx="2.5" /><path strokeLinecap="round" d="M3 9.5h18M8 3.5v3M16 3.5v3" /></svg></span>
          <span className="text-sm font-medium text-slate-100">Calendar event</span>
          <span className="text-[11px] text-slate-500">People, repeat, related — shows in your calendar.</span>
        </button>
        <button onClick={onCard} className={`${card} hover:border-sky-500/50 hover:bg-slate-900`}>
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/15 text-sky-300"><svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><rect x="4" y="4" width="16" height="16" rx="2" /><path strokeLinecap="round" d="M9 9h6M9 13h4" /></svg></span>
          <span className="text-sm font-medium text-slate-100">Board ticket</span>
          <span className="text-[11px] text-slate-500">Worked time on a ticket (from–to).</span>
        </button>
        <button onClick={onNormal} className={`${card} hover:border-emerald-500/50 hover:bg-slate-900`}>
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300"><svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M5 12l4 4L19 6" /></svg></span>
          <span className="text-sm font-medium text-slate-100">Normal</span>
          <span className="text-[11px] text-slate-500">A day, period or month (or a from–to).</span>
        </button>
        <button onClick={onHoliday} className={`${card} hover:border-teal-500/50 hover:bg-slate-900`}>
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/15 text-teal-300"><svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M3 20h18M5 20V9l7-5 7 5v11M9 20v-5h6v5" /></svg></span>
          <span className="text-sm font-medium text-slate-100">Holiday / Vacation</span>
          <span className="text-[11px] text-slate-500">Request time off — sent to managers for approval.</span>
        </button>
      </div>
      <div className="mt-4 flex justify-end"><button onClick={onClose} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">Cancel</button></div>
    </Modal>
  );
}

function WorklogForm({ address, boards, lockedBoard, weekISO, edit, onClose, onSaved, onToast, onDelete }: {
  address: string; boards: Board[]; lockedBoard: string; weekISO: string; edit?: { boardId: string; ticketId: string; entry: WorkLog }; onClose: () => void; onSaved: () => void; onToast: Toast; onDelete?: () => void;
}) {
  const people = useMemo(() => mentionPeople(address, boards.flatMap((b) => loadBoardState(b.id).members.map((m) => ({ id: m.address, label: m.label })))), [address, boards]);
  const [boardId, setBoardId] = useState(lockedBoard || edit?.boardId || boards[0]?.id || "");
  const [ticketId, setTicketId] = useState(edit?.ticketId ?? "");
  const [title, setTitle] = useState(edit?.entry.title ?? "");
  const [date, setDate] = useState(edit?.entry.date ?? weekISO);
  const [from, setFrom] = useState(edit?.entry.from ?? "");
  const [to, setTo] = useState(edit?.entry.to ?? "");
  const [desc, setDesc] = useState(edit?.entry.description ?? "");
  const [saving, setSaving] = useState(false);

  const ticketOpts: Opt[] = useMemo(() => ticketLinkTargets(address).filter((t) => t.boardId === boardId).map((t) => ({ value: t.ticketId, label: `${t.key} · ${t.title}` })), [address, boardId]);
  const nf = normalizeTime(from), nt = normalizeTime(to);
  const valid = !!boardId && !!ticketId && !!nf && !!nt && nf < nt;

  async function save() {
    if (!ticketId) { onToast("Pick a card to log time on.", "error"); return; }
    if (!valid) { onToast("Enter both From and To.", "error"); return; }
    setSaving(true);
    try {
      if (edit) await updateCardTime(address, boardId, ticketId, edit.entry.id, date, nf, nt, title.trim());
      else await logCardTime(address, boardId, ticketId, date, nf, nt, title.trim());
      onSaved();
    } catch { onToast("Couldn't log the time.", "error"); setSaving(false); }
  }

  return (
    <Modal onClose={onClose} title={edit ? "Edit logged time" : "Log time on a card"} subtitle="A ticket is required — the time is added to its worklog.">
      <div className="mt-4 space-y-2.5">
        {!lockedBoard && <Field label="Board"><ThemedSelect value={boardId} options={boards.map((b) => ({ value: b.id, label: b.title }))} onChange={(v) => { setBoardId(v); setTicketId(""); }} /></Field>}
        <Field label="Card (required)"><ThemedCombo value={ticketId} options={ticketOpts} placeholder="Pick a card…" onChange={setTicketId} /></Field>
        <Field label="What did you work on?"><MentionInput value={title} onChange={setTitle} people={people} placeholder="Optional title — @ to mention" className={inp} /></Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Date"><DateInput value={date} onChange={setDate} className={inp} /></Field>
          <Field label="From"><TimeField value={from} onChange={setFrom} className={inp} /></Field>
          <Field label="To"><TimeField value={to} onChange={setTo} className={inp} /></Field>
        </div>
        <div className="flex items-center gap-2 px-0.5 text-xs"><span className="text-slate-500">Worked</span><span className="font-semibold text-slate-100">{valid ? fmtDuration(diffHours(nf, nt)) : "—"}</span></div>
        <Field label="Notes (optional)"><MentionInput multiline value={desc} onChange={setDesc} people={people} rows={2} placeholder="Notes — @ to mention" className={`${inp} resize-none`} /></Field>
      </div>
      <Actions onClose={onClose} onSave={save} saving={saving} disabled={!valid} label={edit ? "Save" : "Log time"} onDelete={edit ? onDelete : undefined} />
    </Modal>
  );
}

function NormalForm({ kind, edit, address, boards, lockedBoard, weekISO, onClose, onSaved, onToast, commit, onDelete }: {
  kind: "normal" | "holiday"; edit?: TimesheetEntry; address: string; boards: Board[]; lockedBoard: string; weekISO: string; onClose: () => void; onSaved: () => void; onToast: Toast;
  commit: (events: { boardId: string; event: BoardEvent }[]) => Promise<void>; onDelete?: () => void;
}) {
  const holiday = kind === "holiday";
  const people = useMemo(() => mentionPeople(address, boards.flatMap((b) => loadBoardState(b.id).members.map((m) => ({ id: m.address, label: m.label })))), [address, boards]);
  const [boardId, setBoardId] = useState(lockedBoard || edit?.boardId || boards[0]?.id || "");
  const [title, setTitle] = useState(edit?.title ?? "");
  const [mode, setMode] = useState<"allday" | "timed">(edit?.from && edit?.to ? "timed" : "allday");
  const [span, setSpan] = useState<"day" | "period" | "month">(edit?.endDate && edit.endDate !== edit.date ? "period" : "day");
  const [date, setDate] = useState(edit?.date ?? weekISO);
  const [endDate, setEndDate] = useState(edit?.endDate ?? edit?.date ?? weekISO);
  const [month, setMonth] = useState((edit?.date ?? weekISO).slice(0, 7));
  const [from, setFrom] = useState(edit?.from ?? "");
  const [to, setTo] = useState(edit?.to ?? "");
  const [links, setLinks] = useState<string[]>(edit?.links ?? []);
  const [note, setNote] = useState(edit?.note ?? "");
  const [saving, setSaving] = useState(false);

  const nf = normalizeTime(from), nt = normalizeTime(to);
  const range = () => {
    if (span === "day") return { start: date, end: date };
    if (span === "period") return { start: date, end: endDate < date ? date : endDate };
    const [y, m] = month.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
  };
  const valid = !!boardId && !!title.trim() && (mode === "allday" || (!!nf && !!nt && nf < nt));

  async function save() {
    if (!valid) { onToast(mode === "timed" && title.trim() ? "Enter both From and To." : "Add a title.", "error"); return; }
    setSaving(true);
    try {
      // editing keeps the same id; a holiday edit re-enters "pending" (needs re-approval).
      // The board OWNER is the top authority — their own holidays are auto-approved.
      const owner = boards.find((b) => b.id === boardId)?.role === "owner";
      const id = edit?.id ?? `${kind === "holiday" ? "hol" : "nrm"}|${newId()}`;
      const base = { id, author: edit?.author ?? address, authorLabel: edit?.authorLabel ?? "You", boardId, kind, title: title.trim(), links, note: note.trim() || undefined, hours: 0, status: (holiday ? (owner ? "approved" : "submitted") : "draft") as TimesheetEntry["status"], updatedAt: Date.now() };
      const entry: TimesheetEntry = mode === "timed"
        ? { ...base, date, from: nf, to: nt }
        : (() => { const { start, end } = range(); return { ...base, date: start, endDate: end }; })();
      await commit([{ boardId, event: { t: "timesheet.set", entry } }]);
      onSaved();
    } catch { onToast("Couldn't add the entry.", "error"); setSaving(false); }
  }

  return (
    <Modal onClose={onClose} title={edit ? (holiday ? "Edit holiday / vacation" : "Edit entry") : holiday ? "Request holiday / vacation" : "Add a normal entry"} subtitle={holiday ? "Time off across a day, period or month — sent to your board's managers for approval." : "A general marker — a day, a period or a whole month."}>
      <div className="mt-4 space-y-2.5">
        {!lockedBoard && <Field label="Board"><ThemedSelect value={boardId} options={boards.map((b) => ({ value: b.id, label: b.title }))} onChange={setBoardId} /></Field>}
        <Field label="Title"><MentionInput value={title} onChange={setTitle} people={people} placeholder={holiday ? "e.g. Annual leave, Public holiday" : "e.g. Note, reminder"} className={inp} /></Field>
        <Field label="Time">
          <div className="flex gap-1 rounded-lg border border-slate-800 bg-slate-900/50 p-1 text-xs">
            {([["allday", "All day"], ["timed", "Hours (from–to)"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setMode(k)} className={`flex-1 rounded-md px-2 py-1.5 font-medium ${mode === k ? "bg-indigo-600/20 text-indigo-300" : "text-slate-400 hover:text-slate-200"}`}>{l}</button>
            ))}
          </div>
        </Field>
        {mode === "timed" ? (
          <div className="grid grid-cols-3 gap-2">
            <Field label="Date"><DateInput value={date} onChange={setDate} className={inp} /></Field>
            <Field label="From"><input inputMode="numeric" maxLength={5} placeholder="HH:MM" value={from} onChange={(e) => setFrom(e.target.value)} onBlur={() => setFrom(normalizeTime(from))} className={inp} /></Field>
            <Field label="To"><input inputMode="numeric" maxLength={5} placeholder="HH:MM" value={to} onChange={(e) => setTo(e.target.value)} onBlur={() => setTo(normalizeTime(to))} className={inp} /></Field>
          </div>
        ) : (
          <>
            <Field label="Span">
              <div className="flex gap-1 rounded-lg border border-slate-800 bg-slate-900/50 p-1 text-xs">
                {([["day", "Day"], ["period", "Period"], ["month", "Month"]] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setSpan(k)} className={`flex-1 rounded-md px-2 py-1.5 font-medium ${span === k ? "bg-indigo-600/20 text-indigo-300" : "text-slate-400 hover:text-slate-200"}`}>{l}</button>
                ))}
              </div>
            </Field>
            {span === "day" && <Field label="Date"><DateInput value={date} onChange={setDate} className={inp} /></Field>}
            {span === "period" && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="From"><DateInput value={date} onChange={setDate} className={inp} /></Field>
                <Field label="To"><DateInput value={endDate} onChange={setEndDate} className={inp} /></Field>
              </div>
            )}
            {span === "month" && <Field label="Month"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={`${inp} [color-scheme:dark]`} /></Field>}
          </>
        )}
        <Field label="Related records"><RelatedLinks address={address} links={links} onChange={setLinks} editable /></Field>
        <Field label="Notes (optional)"><MentionInput multiline value={note} onChange={setNote} people={people} rows={2} placeholder="Notes — @ to mention" className={`${inp} resize-none`} /></Field>
      </div>
      <Actions onClose={onClose} onSave={save} saving={saving} disabled={!valid} label={edit ? "Save" : holiday ? "Request" : "Add"} onDelete={edit ? onDelete : undefined} />
    </Modal>
  );
}

// ── small shared modal bits ─────────────────────────────────────────────────────

function Modal({ title, subtitle, children, onClose }: { title: string; subtitle?: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-white">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}
function Actions({ onClose, onSave, saving, disabled, label, onDelete }: { onClose: () => void; onSave: () => void; saving: boolean; disabled: boolean; label: string; onDelete?: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="mt-5 flex items-center justify-between gap-2">
      <div>
        {onDelete && (confirm
          ? <span className="flex items-center gap-2 text-xs"><button onClick={onDelete} disabled={saving} className="rounded-lg bg-rose-600/90 px-3 py-1.5 font-medium text-white hover:bg-rose-500 disabled:opacity-60">Delete</button><button onClick={() => setConfirm(false)} className="text-slate-400 hover:text-slate-200">Cancel</button></span>
          : <button onClick={() => setConfirm(true)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:border-rose-500/50 hover:text-rose-300">Delete</button>)}
      </div>
      <div className="flex gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">Cancel</button>
        <button onClick={onSave} disabled={saving || disabled} className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-60">{label}</button>
      </div>
    </div>
  );
}
const inp = "w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  // A <div>, not a <label> — a wrapping <label> would activate the first control inside it when you
  // click the label text, which would pop open a date/time picker on a stray click.
  return <div className="block"><span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</span>{children}</div>;
}
function diffHours(from: string, to: string): number {
  const [fh, fm] = from.split(":").map(Number);
  const [th, tm] = to.split(":").map(Number);
  let mins = th * 60 + tm - (fh * 60 + fm);
  if (mins < 0) mins += 1440;
  return Math.round((mins / 60) * 100) / 100;
}
