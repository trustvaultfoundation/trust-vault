"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RichTextEditor } from "./RichTextEditor";
import { RelatedLinks } from "./RelatedLinks";
import { AttachPicker } from "./AttachPicker";
import { ThemedSelect, ThemedAutocomplete } from "./BoardDropdowns";
import { DateInput } from "./DateInput";
import { MentionInput } from "./MentionInput";
import { MentionText } from "./MentionText";
import { mentionPeople } from "@/lib/mentions";
import { loadIdentities, isValidArweaveAddress } from "@/lib/accessKeys";
import { showUserCard } from "@/lib/profileNav";
import { loadBoards, loadBoardState, canEdit, type BoardMeta } from "@/lib/board";
import { publishItsmRecord, discoverBoardItsm } from "@/lib/itsmSync";
import { fetchAndDecryptByTxId } from "@/lib/viewer";
import { type StoredUpload } from "@/lib/vault";
import {
  ItsmType, ItsmRecord, ItsmStore, ItsmAttachment, ActivityEntry, ITSM_TYPES, itsmMeta, itsmNumber,
  loadItsm, upsertRecord, removeRecord, newRecord, priorityMeta, priorityOf, PRIORITIES, URGENCY_IMPACT,
  activityEntry, isOpen, saveSharedItsm, loadItsmSeen, saveItsmSeen, normalizeRecord,
  totalWorkingHours, itsmBudget, isWorkingState, DEFAULT_ITSM_BUDGET,
} from "@/lib/itsm";
import { commitBoardEvents } from "@/lib/boardSync";
import { fmtDuration, canManage } from "@/lib/board";
import { usePagedRows } from "@/lib/usePagedRows";
import { PaginationBar } from "./PaginationBar";

const NO_BOARD = "__none__"; // sentinel for "private — only me" in the team filter

type Toast = (m: string, t?: "error" | "info" | "warning") => void;
type View = ItsmType | "all" | "mine" | "open" | "unassigned" | "sla";

const field = "w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none";
const selTrigger = "mt-1 flex w-full items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-100 hover:border-slate-600 focus:border-indigo-500 focus:outline-none disabled:opacity-60"; // themed <select> trigger
const lbl = "text-[10px] font-medium uppercase tracking-wide text-slate-500";
const shortAddr = (a: string) => (a && a.length > 10 ? `${a.slice(0, 5)}…${a.slice(-4)}` : a || "?");
const fmtWhen = (t: number) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const fmtDay = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const fmtDate = (s?: string) => (s ? new Date(`${s}T00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");

function PriorityBadge({ p }: { p: number }) {
  const m = priorityMeta(p);
  return <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${m.chip}`}><span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />{m.short}</span>;
}
function StateBadge({ state, type }: { state: string; type: ItsmType }) {
  const done = state === "Closed" || state === "Cancelled" || state === "Resolved" || state === "Fulfilled";
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${done ? "bg-slate-700/40 text-slate-400 ring-slate-600/40" : itsmMeta(type).chip}`}>{state}</span>;
}

// Time spent in working states (computed from the record's state history) vs the priority's
// budget. Managers of the record's board can edit the per-priority budget (synced to the team).
function TimeBudget({ record, me, canManageBoard, onToast }: { record: ItsmRecord; me: string; canManageBoard: boolean; onToast?: Toast }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const spent = totalWorkingHours(record);
  const budget = itsmBudget(record.boardId);
  const cap = budget[record.priority] ?? DEFAULT_ITSM_BUDGET[record.priority];
  const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
  const over = spent > cap;
  const working = isWorkingState(record.type, record.state);
  const canEditBudget = canManageBoard && !!record.boardId;

  const startEdit = () => { setDraft(Object.fromEntries([1, 2, 3, 4].map((p) => [p, String(budget[p] ?? DEFAULT_ITSM_BUDGET[p])]))); setEditing(true); };
  const save = async () => {
    if (!record.boardId) return;
    const map: Record<number, number> = {};
    for (const p of [1, 2, 3, 4]) { const v = parseFloat(draft[p]); map[p] = isNaN(v) || v < 0 ? (DEFAULT_ITSM_BUDGET[p]) : v; }
    setSaving(true);
    try { await commitBoardEvents(me, [{ boardId: record.boardId, event: { t: "board.itsmbudget", budget: map } }]); setEditing(false); onToast?.("Time budgets updated for the team."); }
    catch { onToast?.("Couldn't save the budgets.", "error"); }
    finally { setSaving(false); }
  };

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <div className="flex items-center justify-between">
        <span className={lbl}>Time worked {working ? <span className="ml-1 rounded bg-amber-500/15 px-1 py-0.5 text-[9px] font-semibold text-amber-300 ring-1 ring-inset ring-amber-500/30">tracking</span> : null}</span>
        <span className="text-xs text-slate-400"><span className={over ? "font-semibold text-rose-300" : "font-semibold text-slate-100"}>{fmtDuration(spent)}</span> / {fmtDuration(cap)} <span className="text-slate-600">(P{record.priority} budget)</span></span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full rounded-full ${over ? "bg-rose-500" : pct > 80 ? "bg-amber-400" : "bg-emerald-500"}`} style={{ width: `${Math.max(pct, spent > 0 ? 4 : 0)}%` }} />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-600">
        <span>Counts time in “{itsmMeta(record.type).working.join(", ") || "—"}”. {over ? "Over budget." : ""}</span>
        {canEditBudget && !editing && <button onClick={startEdit} className="text-indigo-300 hover:text-indigo-200">Edit budgets</button>}
      </div>
      {editing && (
        <div className="mt-2 border-t border-slate-800 pt-2">
          <p className="mb-1.5 text-[10px] text-slate-500">Hours allowed per priority (for this team’s records):</p>
          <div className="grid grid-cols-4 gap-2">
            {[1, 2, 3, 4].map((p) => (
              <label key={p} className="block">
                <span className="mb-1 block text-[10px] font-semibold text-slate-400">{priorityMeta(p).short}</span>
                <input value={draft[p] ?? ""} onChange={(e) => setDraft((m) => ({ ...m, [p]: e.target.value }))} inputMode="decimal" className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-center text-xs text-slate-100 focus:border-indigo-500 focus:outline-none" />
              </label>
            ))}
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <button onClick={() => setEditing(false)} className="rounded-md border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 hover:bg-slate-800">Cancel</button>
            <button onClick={save} disabled={saving} className="rounded-md bg-indigo-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-indigo-500 disabled:opacity-60">Save</button>
          </div>
        </div>
      )}
    </div>
  );
}
function TypeDot({ type }: { type: ItsmType }) { return <span className={`h-2 w-2 shrink-0 rounded-full ${itsmMeta(type).dot}`} />; }

export default function ITSMView({ address, onToast, onOpenTicket, onOpenEvent, openRecord, onRecordOpened }: {
  address: string;
  onToast?: Toast;
  onOpenTicket?: (boardId: string, ticketId: string) => void;
  onOpenEvent?: (eventId: string) => void;
  openRecord?: string | null;       // a record id to open (from a cross-link)
  onRecordOpened?: () => void;
}) {
  const [store, setStore] = useState<ItsmStore>(() => loadItsm(address));
  const [view, setView] = useState<View>("all");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [shared, setShared] = useState<ItsmRecord[]>([]);
  const [prios, setPrios] = useState<Set<number>>(new Set()); // priority filter
  const [boardFilter, setBoardFilter] = useState<Set<string>>(new Set()); // team (board) filter
  const [boardQuery, setBoardQuery] = useState(""); // search within the team filter
  const [boardOpen, setBoardOpen] = useState(false); // the team-picker dropdown (click to open)
  const [showFilter, setShowFilter] = useState(false);
  const [seenMap, setSeenMap] = useState<Record<string, number>>(() => loadItsmSeen(address));
  const [syncing, setSyncing] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const boardBoxRef = useRef<HTMLDivElement>(null);
  const newRef = useRef<HTMLDivElement>(null);
  const me = shortAddr(address);
  const boards = useMemo<BoardMeta[]>(() => loadBoards(address), [address]);
  const boardName = useCallback((id?: string) => (id ? boards.find((b) => b.id === id)?.title ?? "Shared board" : "Private"), [boards]);
  // Local records merged with those folded from boards I'm a member of (newest per id wins).
  const records = useMemo(() => {
    const m = new Map<string, ItsmRecord>();
    for (const r of shared) m.set(r.id, r);
    for (const r of store.records) { const s = m.get(r.id); if (!s || r.updatedAt >= s.updatedAt) m.set(r.id, r); }
    return [...m.values()];
  }, [store.records, shared]);
  // Boards actually used by the records — the (searchable) options for the Team filter.
  const usedBoards = useMemo(() => {
    const ids = new Set<string>();
    let hasPrivate = false;
    for (const r of records) { if (r.boardId) ids.add(r.boardId); else hasPrivate = true; }
    const opts = [...ids].map((id) => ({ id, title: boardName(id) })).sort((a, b) => a.title.localeCompare(b.title));
    return { opts, hasPrivate };
  }, [records, boardName]);
  const boardQ = boardQuery.trim().toLowerCase();
  // Un-selected boards that match the search — the options shown in the team picker (selected
  // ones move up to chips, the same as the Related-records picker).
  const boardOpts = useMemo(() => usedBoards.opts.filter((o) => !boardFilter.has(o.id) && o.title.toLowerCase().includes(boardQ)), [usedBoards, boardQ, boardFilter]);
  const showPrivate = usedBoards.hasPrivate && !boardFilter.has(NO_BOARD) && "private — only me".includes(boardQ);
  const toggleBoard = (id: string, on: boolean) => { setBoardFilter((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; }); setBoardQuery(""); };

  useEffect(() => { setStore(loadItsm(address)); setSeenMap(loadItsmSeen(address)); }, [address]);
  useEffect(() => { if (openRecord) { openRec(openRecord); onRecordOpened?.(); } }, [openRecord]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fold records shared to any board I'm a member of + cache them so the cross-link pickers
  // (which read localStorage) can see team-shared records too.
  const refreshShared = useCallback(async () => {
    setSyncing(true);
    const all: ItsmRecord[] = [];
    for (const b of loadBoards(address)) { try { all.push(...await discoverBoardItsm(b.id)); } catch { /* no key / offline */ } }
    setShared(all); saveSharedItsm(address, all); setSyncing(false);
  }, [address]);
  useEffect(() => {
    let alive = true;
    const loop = async () => { if (!alive) return; await refreshShared(); };
    loop();
    const id = setInterval(() => { if (alive) refreshShared(); }, 60000);
    return () => { alive = false; clearInterval(id); };
  }, [refreshShared]);

  // A record is "new/unseen" if someone else created/updated it after my last-seen mark.
  const isUnseen = useCallback((r: ItsmRecord) => r.owner !== me && r.createdBy !== me && (seenMap[r.id] == null || r.updatedAt > seenMap[r.id]), [seenMap, me]);
  // Open a record and clear its unseen mark (removes the row highlight + decrements the nav dot).
  function openRec(id: string) {
    setOpenId(id);
    const rec = records.find((r) => r.id === id);
    if (rec && isUnseen(rec)) {
      const next = { ...loadItsmSeen(address), [id]: rec.updatedAt };
      setSeenMap(next); saveItsmSeen(address, next);
      window.dispatchEvent(new Event("gtv-itsm-seen")); // nudge the sidebar badge
    }
  }

  const open = records.find((r) => r.id === openId) ?? null;
  useEffect(() => {
    if (!showFilter) { setBoardOpen(false); return; }
    const h = (e: MouseEvent) => { if (filterRef.current && !filterRef.current.contains(e.target as Node)) setShowFilter(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showFilter]);
  // Close just the team picker when clicking elsewhere inside the filter (capture, like RelatedLinks).
  useEffect(() => {
    if (!boardOpen) return;
    const h = (e: MouseEvent) => { if (boardBoxRef.current && !boardBoxRef.current.contains(e.target as Node)) setBoardOpen(false); };
    document.addEventListener("mousedown", h, true);
    return () => document.removeEventListener("mousedown", h, true);
  }, [boardOpen]);
  useEffect(() => {
    if (!newOpen) return;
    const h = (e: MouseEvent) => { if (newRef.current && !newRef.current.contains(e.target as Node)) setNewOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [newOpen]);

  const list = useMemo(() => {
    let rs = records;
    if (prios.size) rs = rs.filter((r) => prios.has(r.priority));
    if (boardFilter.size) rs = rs.filter((r) => boardFilter.has(r.boardId || NO_BOARD));
    if (view === "mine") rs = rs.filter((r) => r.assignee === me || r.assignee === address);
    else if (view === "open") rs = rs.filter(isOpen);
    else if (view === "unassigned") rs = rs.filter((r) => !r.assignee);
    else if (view === "sla") rs = rs.filter((r) => r.dueDate && isOpen(r));
    else if (view !== "all") rs = rs.filter((r) => r.type === view);
    const term = q.trim().toLowerCase();
    if (term) rs = rs.filter((r) => `${itsmNumber(r)} ${r.shortDescription} ${r.assignee ?? ""} ${r.requestedBy ?? ""} ${r.category ?? ""} ${boardName(r.boardId)}`.toLowerCase().includes(term));
    return [...rs].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [records, view, q, prios, boardFilter, me, address, boardName]);
  // Records table: fit rows to the height available + page the overflow (shared with Profile / Vault).
  const itsmRows = usePagedRows(list, 37, `${view}|${q}|${[...prios].sort().join()}|${[...boardFilter].sort().join()}`);
  const visibleList = itsmRows.pageItems;

  const createNew = (type: ItsmType) => {
    setNewOpen(false);
    const rec = newRecord(type, me);
    rec.activity = [activityEntry(me, "created", `${itsmMeta(type).label} created`)];
    setStore(upsertRecord(address, rec));
    setOpenId(rec.id);
  };

  // Save the detail draft, logging key field changes to the activity stream.
  const saveRecord = (draft: ItsmRecord, extra: ActivityEntry[] = []) => {
    const orig = records.find((r) => r.id === draft.id);
    const diffs: ActivityEntry[] = [];
    if (orig) {
      if (orig.state !== draft.state) diffs.push(activityEntry(me, "state", `State: ${orig.state} → ${draft.state}`));
      if ((orig.assignee ?? "") !== (draft.assignee ?? "")) diffs.push(activityEntry(me, "field", `Assigned to ${draft.assignee || "— (unassigned)"}`));
      const op = priorityOf(orig.urgency, orig.impact), np = priorityOf(draft.urgency, draft.impact);
      if (op !== np) diffs.push(activityEntry(me, "field", `Priority → ${priorityMeta(np).short}`));
      if ((orig.dueDate ?? "") !== (draft.dueDate ?? "")) diffs.push(activityEntry(me, "field", draft.dueDate ? `Target date → ${draft.dueDate}` : "Target date cleared"));
    }
    const savedStore = upsertRecord(address, { ...draft, activity: [...draft.activity, ...diffs, ...extra] });
    setStore(savedStore);
    // If the record belongs to a board (team), publish it encrypted with the board key so its
    // members see it. Best-effort: needs the board key cached (open that board once to unlock).
    const savedRec = savedStore.records.find((r) => r.id === draft.id);
    if (savedRec?.boardId) {
      publishItsmRecord(savedRec, me)
        .then((ok) => onToast?.(ok ? "Saved & shared with the team." : "Saved locally — open that board once to unlock its key, then save again to share.", ok ? "info" : "warning"))
        .catch(() => onToast?.("Saved locally (couldn't reach Arweave to share).", "warning"));
    } else {
      onToast?.("Saved.", "info");
    }
  };
  const deleteRecord = (id: string) => { setStore(removeRecord(address, id)); setOpenId(null); };

  return (
    <div className={`flex flex-col ${open ? "" : "h-[calc(100vh-9rem)]"}`}>
      {/* Header — title + description (left) · search · refresh · filter (right), like the Calendar.
          The list controls only matter in list mode, so they hide while a record is open. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div>
          <h2 className="text-lg font-semibold text-white">Service Desk</h2>
          <p className="mt-0.5 text-xs text-slate-500">Incidents, requests, changes & problems for your team.</p>
        </div>
        {!open && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <svg className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="M21 21l-4-4" /></svg>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search records…" className="w-44 rounded-lg border border-slate-700 bg-slate-800 py-1.5 pl-8 pr-2 text-xs text-slate-200 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none sm:w-60" />
            </div>
            <button onClick={refreshShared} disabled={syncing} title="Refresh shared records from Arweave" aria-label="Refresh" className="flex items-center justify-center rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200 disabled:opacity-60">
              <svg className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M5 9a8 8 0 0113-3M19 15a8 8 0 01-13 3" /></svg>
            </button>
            <div ref={filterRef} className="relative">
              <button onClick={() => setShowFilter((v) => !v)} title="Filter by priority & team" aria-label="Filter" className={`relative flex items-center justify-center rounded-lg border px-2 py-1.5 transition-colors ${prios.size || boardFilter.size || showFilter ? "border-indigo-500 bg-indigo-500/15 text-indigo-200" : "border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"}`}>
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 20 20" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M2 5h16M5 10h10M8 15h4" /></svg>
                {(prios.size > 0 || boardFilter.size > 0) && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-indigo-400" />}
              </button>
              {showFilter && (
                <div className="absolute right-0 z-30 mt-1 w-60 rounded-lg border border-slate-700 bg-slate-900 p-2 shadow-xl">
                  <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Priority</p>
                  {[1, 2, 3, 4].map((p) => (
                    <label key={p} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-slate-800">
                      <input type="checkbox" checked={prios.has(p)} onChange={(e) => setPrios((s) => { const n = new Set(s); if (e.target.checked) n.add(p); else n.delete(p); return n; })} className="accent-indigo-500" />
                      <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${PRIORITIES[p].chip}`}><span className={`h-1.5 w-1.5 rounded-full ${PRIORITIES[p].dot}`} />{PRIORITIES[p].label}</span>
                    </label>
                  ))}
                  <div className="my-1.5 border-t border-slate-800" />
                  <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Team (board)</p>
                  {usedBoards.opts.length || usedBoards.hasPrivate ? (
                    <>
                      {/* selected teams as removable chips */}
                      {boardFilter.size > 0 && (
                        <div className="mb-1 flex flex-wrap gap-1 px-0.5">
                          {[...boardFilter].map((id) => (
                            <span key={id} className="inline-flex items-center gap-1 rounded bg-indigo-500/15 px-1.5 py-0.5 text-[10px] text-indigo-200 ring-1 ring-inset ring-indigo-500/30">
                              <span className="max-w-[9rem] truncate">{id === NO_BOARD ? "Private" : boardName(id)}</span>
                              <button type="button" onClick={() => toggleBoard(id, false)} title="Remove" className="opacity-70 hover:opacity-100"><svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg></button>
                            </span>
                          ))}
                        </div>
                      )}
                      {/* click to open a searchable list of the boards in use */}
                      <div ref={boardBoxRef} className="relative">
                        <input value={boardQuery} onFocus={() => setBoardOpen(true)} onChange={(e) => { setBoardQuery(e.target.value); setBoardOpen(true); }} placeholder="Click to pick a team…" className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-200 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none" />
                        {boardOpen && (
                          <div className="absolute left-0 right-0 z-40 mt-1 max-h-44 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
                            {showPrivate && (
                              <button type="button" onClick={() => toggleBoard(NO_BOARD, true)} className="flex w-full items-center px-2 py-1.5 text-left text-[11px] text-slate-300 hover:bg-slate-800">Private — only me</button>
                            )}
                            {boardOpts.map((o) => (
                              <button key={o.id} type="button" onClick={() => toggleBoard(o.id, true)} className="flex w-full items-center px-2 py-1.5 text-left text-[11px] text-slate-200 hover:bg-slate-800"><span className="truncate">{o.title}</span></button>
                            ))}
                            {!showPrivate && boardOpts.length === 0 && <p className="px-2 py-2 text-[11px] text-slate-600">{boardQ ? "No teams match." : "All teams selected."}</p>}
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="px-1 py-1 text-[11px] text-slate-600">No boards in use yet.</p>
                  )}
                  {(prios.size > 0 || boardFilter.size > 0) && <button onClick={() => { setPrios(new Set()); setBoardFilter(new Set()); }} className="mt-1.5 w-full rounded px-1 py-1 text-left text-[11px] text-slate-400 hover:text-slate-200">Clear filters</button>}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Body — left rail (New record + saved views) · table/detail. The rail and the table
          share the same top edge, so "New record" lines up with the start of the table. */}
      <div className="flex min-h-0 flex-1 gap-4">
        <aside className="hidden w-48 shrink-0 flex-col gap-3 overflow-y-auto pr-1 sm:flex">
          <div ref={newRef} className="relative">
            <button onClick={() => setNewOpen((o) => !o)} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-500">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>New record
            </button>
            {newOpen && (
              <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
                {ITSM_TYPES.map((t) => (
                  <button key={t.type} onClick={() => createNew(t.type)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-200 hover:bg-slate-800">
                    <span className={`h-2 w-2 rounded-full ${t.dot}`} />{t.label}<span className="ml-auto font-mono text-[10px] text-slate-500">{t.prefix}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <nav className="flex flex-col gap-0.5 text-xs">
            {([["all", "All records"], ["open", "Open"], ["mine", "Assigned to me"], ["unassigned", "Unassigned"], ["sla", "Has target date"]] as [View, string][]).map(([v, label]) => (
              <RailItem key={v} active={view === v} onClick={() => { setView(v); setOpenId(null); }} label={label} />
            ))}
            <div className="my-1.5 border-t border-slate-800" />
            {ITSM_TYPES.map((t) => (
              <RailItem key={t.type} active={view === t.type} onClick={() => { setView(t.type); setOpenId(null); }} label={t.plural} dot={t.dot} />
            ))}
          </nav>
        </aside>

        {/* Main — list or detail */}
        <div className="flex min-w-0 flex-1 flex-col">
          {open ? (
            <RecordDetail
              key={open.id}
              record={open}
              address={address}
              me={me}
              boards={boards}
              onBack={() => setOpenId(null)}
              onSave={saveRecord}
              onDelete={deleteRecord}
              onOpenTicket={onOpenTicket}
              onOpenEvent={onOpenEvent}
              onOpenItsm={(id) => openRec(id)}
              onToast={onToast}
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-800">
              {/* Rows are fitted to the height available and paged; the wrapper still scrolls
                  horizontally when the table is wider than the screen. */}
              <div ref={itsmRows.containerRef} className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
              <table className="w-full min-w-[60rem] border-collapse text-xs">
                <thead ref={itsmRows.headerRef} className="bg-slate-900/95 text-left text-[10px] uppercase tracking-wide text-slate-500">
                  <tr className="border-b border-slate-800">
                    <th className="px-3 py-2 font-medium">Number</th>
                    <th className="px-3 py-2 font-medium">Short description</th>
                    <th className="px-3 py-2 font-medium">Board</th>
                    <th className="px-3 py-2 font-medium">State</th>
                    <th className="px-3 py-2 font-medium">Pri</th>
                    <th className="px-3 py-2 font-medium">Assignee</th>
                    <th className="px-3 py-2 font-medium">Reported by</th>
                    <th className="px-3 py-2 font-medium">Target date</th>
                    <th className="px-3 py-2 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleList.map((r) => {
                    const unseen = isUnseen(r);
                    return (
                      <tr key={r.id} data-row onClick={() => openRec(r.id)} className={`cursor-pointer border-b border-slate-800/60 ${unseen ? "bg-indigo-500/10" : "hover:bg-slate-800/40"}`}>
                        <td className="whitespace-nowrap px-3 py-2"><span className="flex items-center gap-1.5">{unseen && <span title="New" className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />}<TypeDot type={r.type} /><span className={`font-mono font-medium ${itsmMeta(r.type).text}`}>{itsmNumber(r)}</span></span></td>
                        <td className="max-w-[1px] px-3 py-2"><span className={`block truncate ${unseen ? "font-semibold text-white" : "text-slate-200"}`}>{r.shortDescription || <span className="text-slate-500">(no description)</span>}</span></td>
                        <td className="max-w-[11rem] px-3 py-2"><span className={`block truncate ${r.boardId ? "text-slate-300" : "text-slate-500"}`}>{boardName(r.boardId)}</span></td>
                        <td className="whitespace-nowrap px-3 py-2"><StateBadge state={r.state} type={r.type} /></td>
                        <td className="whitespace-nowrap px-3 py-2"><PriorityBadge p={r.priority} /></td>
                        <td className="max-w-[11rem] px-3 py-2"><span className="block truncate text-slate-400">{r.assignee || <span className="text-slate-600">—</span>}</span></td>
                        <td className="max-w-[11rem] px-3 py-2"><span className="block truncate text-slate-400">{r.requestedBy || <span className="text-slate-600">—</span>}</span></td>
                        <td className="whitespace-nowrap px-3 py-2">{r.dueDate ? <span className="text-slate-400">{fmtDate(r.dueDate)}</span> : <span className="text-slate-600">—</span>}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-500">{fmtWhen(r.updatedAt)}</td>
                      </tr>
                    );
                  })}
                  {list.length === 0 && (
                    <tr><td colSpan={9} className="px-3 py-16 text-center text-slate-500">No records{q || prios.size || boardFilter.size ? " match your filters" : view !== "all" ? " in this view" : " yet — create one with “New record”"}.</td></tr>
                  )}
                </tbody>
              </table>
              </div>
              <PaginationBar page={itsmRows.page} totalPages={itsmRows.totalPages} onPage={itsmRows.setPage} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RailItem({ active, onClick, label, dot }: { active: boolean; onClick: () => void; label: string; dot?: string }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors ${active ? "bg-indigo-500/15 text-indigo-200" : "text-slate-300 hover:bg-slate-800/60"}`}>
      {dot && <span className={`h-2 w-2 rounded-full ${dot}`} />}
      <span className="truncate">{label}</span>
    </button>
  );
}

// ── record detail (form) ───────────────────────────────────────
function RecordDetail({ record, address, me, boards, onBack, onSave, onDelete, onOpenTicket, onOpenEvent, onOpenItsm, onToast }: {
  record: ItsmRecord; address: string; me: string; boards: BoardMeta[];
  onBack: () => void;
  onSave: (draft: ItsmRecord, extra?: ActivityEntry[]) => void;
  onDelete: (id: string) => void;
  onOpenTicket?: (boardId: string, ticketId: string) => void;
  onOpenEvent?: (eventId: string) => void;
  onOpenItsm?: (recordId: string) => void;
  onToast?: Toast;
}) {
  // Normalize so list/array fields (attachments, links, activity) are always present, even for
  // records that predate those fields or arrive un-normalized (e.g. via board sync).
  const [draft, setDraft] = useState<ItsmRecord>(() => normalizeRecord(record));
  const [attachOpen, setAttachOpen] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const meta = itsmMeta(draft.type);
  const set = (p: Partial<ItsmRecord>) => setDraft((d) => ({ ...d, ...p }));
  const priority = priorityOf(draft.urgency, draft.impact);
  const identities = useMemo(() => loadIdentities(address), [address]);
  // Name suggestions for the Assignee / Reported-by autocompletes (me + my Access Keys).
  const people = useMemo(() => [me, ...identities.map((i) => i.label || i.address)].filter((v, i, a) => !!v && a.indexOf(v) === i), [me, identities]);
  const mentionList = useMemo(() => mentionPeople(address), [address]);
  const approved = draft.approval?.state === "approved";
  // For approval-gated types, states beyond "Approved" require an approval first.
  const gateIndex = meta.states.indexOf("Approved");
  const stateBlocked = (s: string) => meta.needsApproval && !approved && gateIndex >= 0 && meta.states.indexOf(s) > gateIndex;
  // Team + role: a record on a board is editable by board editors+/managers/owner (or its
  // creator); viewers see it read-only. Boards you can contribute to are offered in the picker.
  const myBoardRole = boards.find((b) => b.id === draft.boardId)?.role;
  const iCreated = record.createdBy === me || record.owner === me;
  const readOnly = !!draft.boardId && !iCreated && !canEdit(myBoardRole);
  const teamMembers = useMemo(() => (draft.boardId ? loadBoardState(draft.boardId).members : []), [draft.boardId]);
  // Resolve an activity actor (stored as a short address / label) to a wallet + display name
  // (your address-book name first, then a member label, then the short address) — clickable to the card.
  const actorOf = (by: string): { address: string; name: string } | null => {
    if (!by) return null;
    const m = teamMembers.find((x) => x.address === by || shortAddr(x.address) === by || x.label === by);
    const addr = m?.address || (isValidArweaveAddress(by) ? by : "");
    if (!addr) return null;
    const idn = identities.find((i) => i.address === addr);
    const name = idn?.label?.trim() || (m && m.label !== "Owner" ? m.label : "") || shortAddr(addr);
    return { address: addr, name };
  };
  const editableBoards = boards.filter((b) => canEdit(b.role));

  // Attachments — vault documents linked to the record. On a shared board, the file's key is
  // granted to the board's members so they can open it (same mechanism as ticket attachments).
  const shareDocsToBoard = async (docs: StoredUpload[]) => {
    const bid = draft.boardId;
    if (!bid || !boards.find((b) => b.id === bid)?.shared) return;
    const recipients = loadBoardState(bid).members.filter((m) => m.address !== address).map((m) => m.address);
    const shareable = docs.filter((d) => d.rawKeyBase64);
    if (recipients.length === 0 || shareable.length === 0) return;
    try {
      const { shareDocuments } = await import("@/lib/sharing");
      await shareDocuments(shareable.map((u) => ({ txId: u.txId, rawKeyBase64: u.rawKeyBase64!, ivBase64: u.ivBase64, originalName: u.originalName, originalType: u.originalType, originalSize: u.originalSize ?? 0, documentType: u.documentType, tags: u.tags })), recipients);
    } catch (e) { onToast?.(e instanceof Error ? e.message : "Couldn't share an attachment with the team.", "error"); }
  };
  const handleAttach = (docs: StoredUpload[]) => {
    const add = docs.filter((d) => !draft.attachments.some((a) => a.txId === d.txId)).map((d): ItsmAttachment => ({ txId: d.txId, name: d.originalName, type: d.originalType, size: d.originalSize }));
    if (add.length) { const next = { ...draft, attachments: [...draft.attachments, ...add] }; setDraft(next); onSave(next); }
    void shareDocsToBoard(docs);
  };
  const removeAttachment = (txId: string) => set({ attachments: draft.attachments.filter((a) => a.txId !== txId) });
  const openAttachment = async (a: ItsmAttachment) => {
    setOpening(a.txId);
    try {
      const raw = (typeof window !== "undefined" && localStorage.getItem(`gtv_aes_${a.txId}`)) || undefined;
      const doc = await fetchAndDecryptByTxId(a.txId, raw ? { rawKeyB64: raw } : undefined);
      const url = URL.createObjectURL(doc.blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : "Couldn't open the attachment.", "error");
    } finally { setOpening(null); }
  };

  const postNote = () => {
    const text = note.trim();
    if (!text) return;
    onSave(draft, [activityEntry(me, "note", text)]);
    setDraft((d) => ({ ...d, activity: [...d.activity, activityEntry(me, "note", text)] }));
    setNote("");
  };
  const decide = (state: "approved" | "rejected") => {
    const approval = { state, by: me, at: Date.now() } as const;
    const next = { ...draft, approval };
    setDraft(next);
    onSave(next, [activityEntry(me, "approval", state === "approved" ? "Approved" : "Rejected")]);
  };

  const activity = [...draft.activity].sort((a, b) => b.at - a.at);

  return (
    <div className="flex flex-col rounded-xl border border-slate-800 bg-slate-900/40">
      {/* header */}
      <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
        <button onClick={onBack} title="Back to list" className="text-slate-400 hover:text-slate-100"><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 6l-6 6 6 6" /></svg></button>
        <span className={`flex items-center gap-1.5 font-mono text-sm font-semibold ${meta.text}`}><TypeDot type={draft.type} />{itsmNumber(draft)}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${meta.chip}`}>{meta.label}</span>
        <PriorityBadge p={priority} />
        <div className="ml-auto flex items-center gap-2">
          {readOnly ? (
            <span className="rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-slate-400">View only · your role: {myBoardRole}</span>
          ) : (
            <>
              <button onClick={() => onSave(draft)} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500">Save</button>
              {confirmDel ? (
                <span className="flex items-center gap-1.5 text-[11px]"><span className="text-slate-400">Delete?</span><button onClick={() => onDelete(draft.id)} className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-500">Yes</button><button onClick={() => setConfirmDel(false)} className="text-slate-400 hover:text-slate-200">No</button></span>
              ) : (
                <button onClick={() => setConfirmDel(true)} title="Delete record" className="rounded-lg border border-slate-700 px-2 py-1.5 text-slate-400 hover:border-red-500/50 hover:text-red-400"><svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg></button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-0 lg:grid-cols-[1fr_20rem]">
        {/* main column — a disabled fieldset makes the whole form read-only for board viewers */}
        <fieldset disabled={readOnly} className="min-w-0 space-y-4 p-4 disabled:opacity-70">
          <div>
            <label className={lbl}>Short description</label>
            <div className="mt-1"><MentionInput autoFocus value={draft.shortDescription} onChange={(v) => set({ shortDescription: v })} people={mentionList} disabled={readOnly} placeholder="One-line summary — @ to mention" className={`${field} text-sm disabled:opacity-60`} /></div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1.4fr]">
            <div>
              <label className={lbl}>Team (board)</label>
              <ThemedSelect
                value={draft.boardId ?? ""}
                disabled={readOnly}
                onChange={(v) => set({ boardId: v || undefined })}
                className={selTrigger}
                options={[
                  { value: "", label: "Private — only me" },
                  ...editableBoards.map((b) => ({ value: b.id, label: `${b.title}${b.shared ? " (shared)" : ""}` })),
                  ...(draft.boardId && !editableBoards.some((b) => b.id === draft.boardId) ? [{ value: draft.boardId, label: boards.find((b) => b.id === draft.boardId)?.title ?? "This board" }] : []),
                ]}
              />
            </div>
            <div className="min-w-0">
              <label className={lbl}>Shared with the team</label>
              <p className="mt-1.5 truncate text-[11px] text-slate-400">{draft.boardId ? (teamMembers.length ? `${teamMembers.length}: ${teamMembers.map((m) => m.label).join(", ")}` : "the board's members (open the board to load roles)") : "No one — private to you"}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className={lbl}>State</label>
              <ThemedSelect
                value={draft.state}
                disabled={readOnly}
                onChange={(v) => set({ state: v })}
                className={selTrigger}
                options={meta.states.map((s) => ({ value: s, label: stateBlocked(s) ? `${s} (needs approval)` : s, disabled: stateBlocked(s) }))}
              />
            </div>
            <div>
              <label className={lbl}>Urgency</label>
              <ThemedSelect value={String(draft.urgency)} disabled={readOnly} onChange={(v) => set({ urgency: +v })} className={selTrigger} options={URGENCY_IMPACT.map((o) => ({ value: String(o.v), label: o.label }))} />
            </div>
            <div>
              <label className={lbl}>Impact</label>
              <ThemedSelect value={String(draft.impact)} disabled={readOnly} onChange={(v) => set({ impact: +v })} className={selTrigger} options={URGENCY_IMPACT.map((o) => ({ value: String(o.v), label: o.label }))} />
            </div>
            <div>
              <label className={lbl}>Priority</label>
              <div className="mt-1.5"><PriorityBadge p={priority} /></div>
            </div>
          </div>
          <TimeBudget record={draft} me={me} canManageBoard={canManage(myBoardRole)} onToast={onToast} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className={lbl}>Assignee</label>
              <ThemedAutocomplete value={draft.assignee ?? ""} disabled={readOnly} onChange={(v) => set({ assignee: v })} onPick={(v) => set({ assignee: v })} suggestions={people} placeholder="Who's working it" className={`${field} mt-1`} />
            </div>
            <div>
              <label className={lbl}>{draft.type === "request" ? "Requested by" : "Reported by"}</label>
              <ThemedAutocomplete value={draft.requestedBy ?? ""} disabled={readOnly} onChange={(v) => set({ requestedBy: v })} onPick={(v) => set({ requestedBy: v })} suggestions={people} placeholder="Caller / requester" className={`${field} mt-1`} />
            </div>
            <div>
              <label className={lbl}>Target date (SLA)</label>
              <div className="mt-1"><DateInput value={draft.dueDate ?? ""} onChange={(v) => set({ dueDate: v })} clearable className={field} /></div>
            </div>
          </div>
          <div>
            <label className={lbl}>Category</label>
            <input value={draft.category ?? ""} onChange={(e) => set({ category: e.target.value })} placeholder="e.g. Network, Access, Hardware" className={`${field} mt-1`} />
          </div>
          <div>
            <label className={lbl}>Description</label>
            <div className="mt-1">
              <RichTextEditor value={draft.description} onChange={(html) => set({ description: html })} editable={!readOnly} allowRefs address={address} onOpenTicket={onOpenTicket} onOpenEvent={onOpenEvent} onOpenItsm={onOpenItsm} placeholder="Full details — reference a ticket, event or record with “+”…" />
            </div>
          </div>
          <div>
            <label className={lbl}>Related records</label>
            <p className="mb-1.5 mt-0.5 text-[10px] text-slate-600">Link the board tickets, calendar events or other records this connects to.</p>
            <RelatedLinks address={address} links={draft.links} onChange={(links) => set({ links })} onOpenTicket={onOpenTicket} onOpenEvent={onOpenEvent} onOpenItsm={onOpenItsm} editable={!readOnly} />
          </div>
          <div>
            <label className={lbl}>Attachments ({draft.attachments.length})</label>
            <p className="mb-1.5 mt-0.5 text-[10px] text-slate-600">Link a vault document or upload a new one — on a shared board it’s shared with the team.</p>
            {/* The form is a disabled <fieldset> for viewers; "open" is a span (not a form control)
                so read-only members can still open files, while attach/remove stay gated. */}
            <div className="space-y-1.5">
              {draft.attachments.map((a) => (
                <div key={a.txId} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-800/40 px-2.5 py-1.5">
                  <AttIcon type={a.type} />
                  <span role="button" tabIndex={0} onClick={() => openAttachment(a)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openAttachment(a); } }} title={`Open ${a.name}`} className={`min-w-0 flex-1 cursor-pointer truncate text-left text-xs text-slate-200 hover:text-indigo-300 hover:underline ${opening === a.txId ? "opacity-60" : ""}`}>{opening === a.txId ? "opening…" : a.name}</span>
                  {!readOnly && (
                    <button type="button" onClick={() => removeAttachment(a.txId)} title="Remove" aria-label="Remove attachment" className="shrink-0 text-slate-600 hover:text-red-400">
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                  )}
                </div>
              ))}
              {draft.attachments.length === 0 && <p className="text-[11px] text-slate-600">No files linked yet.</p>}
              {!readOnly && (
                <button type="button" onClick={() => setAttachOpen(true)} className="flex items-center gap-1.5 rounded-lg border border-dashed border-slate-700 px-2.5 py-1.5 text-[11px] text-slate-400 hover:border-indigo-500 hover:text-indigo-300">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21.44 11.05l-9.19 9.19a5 5 0 01-7.07-7.07l9.19-9.19a3 3 0 014.24 4.24l-9.2 9.19a1 1 0 01-1.41-1.41l8.49-8.49" /></svg>
                  Link or upload a file
                </button>
              )}
            </div>
          </div>

          {/* Approval — requests & changes */}
          {meta.needsApproval && (
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
              <div className="flex items-center gap-2">
                <span className={lbl}>Approval</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${approved ? "bg-emerald-500/15 text-emerald-200 ring-emerald-500/30" : draft.approval?.state === "rejected" ? "bg-rose-500/15 text-rose-200 ring-rose-500/30" : "bg-slate-700/40 text-slate-400 ring-slate-600/40"}`}>
                  {draft.approval?.state === "approved" ? "Approved" : draft.approval?.state === "rejected" ? "Rejected" : "Pending"}
                </span>
                {draft.approval?.by && <span className="text-[10px] text-slate-500">by {draft.approval.by}{draft.approval.at ? ` · ${fmtDay(draft.approval.at)}` : ""}</span>}
              </div>
              <div className="mt-2 flex gap-2">
                <button onClick={() => decide("approved")} disabled={approved} className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-500 disabled:opacity-40">Approve</button>
                <button onClick={() => decide("rejected")} className="rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 hover:border-rose-500/50 hover:text-rose-300">Reject</button>
                {!approved && <span className="self-center text-[10px] text-slate-500">States past “Approved” unlock once approved.</span>}
              </div>
            </div>
          )}
        </fieldset>

        {/* side column — work notes + activity */}
        <div className="space-y-3 border-t border-slate-800 p-4 lg:border-l lg:border-t-0">
          {!readOnly && (
            <div>
              <label className={lbl}>Work note</label>
              <div className="mt-1"><MentionInput multiline value={note} onChange={setNote} people={mentionList} rows={2} placeholder="Add an update… — @ to mention" className={`${field} resize-none`} /></div>
              <button onClick={postNote} disabled={!note.trim()} className="mt-1.5 w-full rounded-lg bg-slate-700 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-slate-600 disabled:opacity-40">Post note</button>
            </div>
          )}
          <div>
            <span className={lbl}>Activity</span>
            <ol className="mt-2 space-y-2.5">
              {activity.map((a) => (
                <li key={a.id} className="text-[11px]">
                  <div className="flex items-center gap-1.5 text-slate-500"><ActivityDot kind={a.kind} />{(() => { const actor = actorOf(a.by); return actor ? <button onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); showUserCard({ address: actor.address, label: actor.name, rect: { top: r.top, left: r.left, bottom: r.bottom } }); }} className="font-medium text-slate-300 hover:text-indigo-300">{actor.name}</button> : <span className="font-medium text-slate-300">{a.by}</span>; })()}<span>· {fmtWhen(a.at)}</span></div>
                  <p className={`ml-3.5 ${a.kind === "note" ? "rounded-md border border-slate-800 bg-slate-950/40 p-2 text-slate-200" : "text-slate-400"}`}><MentionText text={a.text} viewer={address} /></p>
                </li>
              ))}
              {activity.length === 0 && <li className="text-[11px] text-slate-500">No activity yet.</li>}
            </ol>
          </div>
        </div>
      </div>
      {attachOpen && (
        <AttachPicker
          address={address}
          existing={draft.attachments.map((a) => a.txId)}
          onClose={() => setAttachOpen(false)}
          onAttach={handleAttach}
          onToast={onToast ?? (() => {})}
        />
      )}
    </div>
  );
}

function AttIcon({ type }: { type: string }) {
  const isImg = type.startsWith("image/");
  return (
    <svg className="h-4 w-4 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      {isImg ? (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="8.5" cy="9" r="1.5" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 16l-5-5L5 20" />
        </>
      ) : (
        <>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M14 3v5h5" />
        </>
      )}
    </svg>
  );
}

function ActivityDot({ kind }: { kind: ActivityEntry["kind"] }) {
  const c = kind === "note" ? "bg-indigo-400" : kind === "state" ? "bg-amber-400" : kind === "approval" ? "bg-emerald-400" : kind === "created" ? "bg-sky-400" : "bg-slate-500";
  return <span className={`h-1.5 w-1.5 rounded-full ${c}`} />;
}
