// IT Service Management records — incidents, service requests, changes and
// problems. Local to this wallet on the device (like the calendar/board); durable + synced
// across the user's devices via the encrypted Arweave snapshot (stateSync registers
// `gtv_itsm_<addr>`). Records cross-reference board tickets and calendar events through the
// shared reference-chip system (RefChipNode / resolveToken).

import { loadBoardState } from "./board";

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);

export type ItsmType = "incident" | "request" | "change" | "problem";

export interface ItsmTypeMeta {
  type: ItsmType;
  prefix: string;        // INC / REQ / CHG / PRB
  label: string;         // "Incident"
  plural: string;        // "Incidents"
  states: string[];      // ordered lifecycle
  openStates: string[];  // states that count as active (drive "Open" + SLA)
  working: string[];     // states that mean "actively being worked" — accrue time spent
  needsApproval: boolean; // requests + changes gate on approval
  dot: string; chip: string; text: string; // theme tokens
}

// The type registry — extensible (add License/Asset etc. here later without touching the rest).
export const ITSM_TYPES: ItsmTypeMeta[] = [
  { type: "incident", prefix: "INC", label: "Incident", plural: "Incidents",
    states: ["New", "In Progress", "On Hold", "Resolved", "Closed", "Cancelled"],
    openStates: ["New", "In Progress", "On Hold"], working: ["In Progress"], needsApproval: false,
    dot: "bg-rose-400", chip: "bg-rose-500/15 text-rose-200 ring-rose-500/30", text: "text-rose-300" },
  { type: "request", prefix: "REQ", label: "Service Request", plural: "Requests",
    states: ["Requested", "Approved", "In Progress", "Fulfilled", "Closed", "Cancelled"],
    openStates: ["Requested", "Approved", "In Progress"], working: ["In Progress"], needsApproval: true,
    dot: "bg-sky-400", chip: "bg-sky-500/15 text-sky-200 ring-sky-500/30", text: "text-sky-300" },
  { type: "change", prefix: "CHG", label: "Change", plural: "Changes",
    states: ["Draft", "Assess", "Authorize", "Implement", "Review", "Closed", "Cancelled"],
    openStates: ["Draft", "Assess", "Authorize", "Implement", "Review"], working: ["Implement"], needsApproval: true,
    dot: "bg-amber-400", chip: "bg-amber-500/15 text-amber-200 ring-amber-500/30", text: "text-amber-300" },
  { type: "problem", prefix: "PRB", label: "Problem", plural: "Problems",
    states: ["New", "Analysis", "Known Error", "Resolved", "Closed", "Cancelled"],
    openStates: ["New", "Analysis", "Known Error"], working: ["Analysis"], needsApproval: false,
    dot: "bg-violet-400", chip: "bg-violet-500/15 text-violet-200 ring-violet-500/30", text: "text-violet-300" },
];
export const itsmMeta = (type: ItsmType): ItsmTypeMeta => ITSM_TYPES.find((t) => t.type === type) ?? ITSM_TYPES[0];
export const ITSM_PREFIXES = ITSM_TYPES.map((t) => t.prefix); // ["INC","REQ","CHG","PRB"]

export type ApprovalState = "not_requested" | "requested" | "approved" | "rejected";
export interface Approval { state: ApprovalState; by?: string; at?: number; note?: string }

export interface ActivityEntry { id: string; at: number; by: string; kind: "created" | "note" | "state" | "field" | "approval"; text: string }

// A vault document linked to a record (same shape as a board ticket's attachment). The file
// stays encrypted in the vault; on a shared record its key is granted to the board's members.
export interface ItsmAttachment { txId: string; name: string; type: string; size?: number }

export interface ItsmRecord {
  id: string;
  type: ItsmType;
  num: number;              // per-type sequence; display = prefix + padded num
  shortDescription: string;
  description: string;      // rich-text HTML (RefChip-enabled)
  state: string;
  urgency: number;          // 1 High · 2 Medium · 3 Low
  impact: number;           // 1 High · 2 Medium · 3 Low
  priority: number;         // 1-4, derived from urgency × impact
  category?: string;
  assignee?: string;        // address or free label
  requestedBy?: string;     // caller / requester
  dueDate?: string;         // yyyy-mm-dd (SLA target) — surfaces on the calendar
  links: string[];          // reference tokens (CODE-NUM tickets, EVT-ids, INC…/REQ… records)
  attachments: ItsmAttachment[]; // vault documents linked to this record
  activity: ActivityEntry[]; // work notes + state/field/approval history
  approval?: Approval;      // requests + changes
  boardId?: string;         // the board (team) this record belongs to — drives sharing + roles
  owner?: string;           // wallet that created it (set on shared records; mine when absent)
  createdBy?: string;
  createdAt: number;
  updatedAt: number;
}

// ── priority matrix (Urgency × Impact → P1-P4) ──────────────────────────────────
// urgency/impact: 1 = High, 2 = Medium, 3 = Low. The standard 3×3 collapsed to P1-P4.
const PRIO_MATRIX: Record<number, Record<number, number>> = {
  1: { 1: 1, 2: 2, 3: 3 },
  2: { 1: 2, 2: 3, 3: 4 },
  3: { 1: 3, 2: 4, 3: 4 },
};
export const priorityOf = (urgency: number, impact: number): number => PRIO_MATRIX[urgency]?.[impact] ?? 3;

export interface PriorityMeta { p: number; label: string; short: string; chip: string; dot: string }
export const PRIORITIES: Record<number, PriorityMeta> = {
  1: { p: 1, label: "P1 · Critical", short: "P1", chip: "bg-rose-500/15 text-rose-200 ring-rose-500/30", dot: "bg-rose-500" },
  2: { p: 2, label: "P2 · High", short: "P2", chip: "bg-orange-500/15 text-orange-200 ring-orange-500/30", dot: "bg-orange-400" },
  3: { p: 3, label: "P3 · Moderate", short: "P3", chip: "bg-amber-500/15 text-amber-200 ring-amber-500/30", dot: "bg-amber-400" },
  4: { p: 4, label: "P4 · Low", short: "P4", chip: "bg-slate-500/15 text-slate-300 ring-slate-500/30", dot: "bg-slate-400" },
};
export const priorityMeta = (p: number): PriorityMeta => PRIORITIES[p] ?? PRIORITIES[3];
export const URGENCY_IMPACT = [{ v: 1, label: "1 · High" }, { v: 2, label: "2 · Medium" }, { v: 3, label: "3 · Low" }];

export const isOpen = (r: ItsmRecord): boolean => itsmMeta(r.type).openStates.includes(r.state);
export const isTerminal = (r: ItsmRecord): boolean => r.state === "Closed" || r.state === "Cancelled";
export const isWorkingState = (type: ItsmType, state: string): boolean => itsmMeta(type).working.includes(state);

// ── time spent in "working" states (the "time wasted") ──────────────────────────
// Reconstructed from the record's own history: each state change is logged as a
// `State: X → Y` activity entry with a timestamp, so we know exactly when it entered and
// left each state. Sum the spans it sat in a working state (still counting up if it's in
// one now). No live timer needed — accurate even when the app was closed.

const ymdLocal = (t: number): string => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function stateTimeline(record: ItsmRecord): { at: number; state: string }[] {
  const tl: { at: number; state: string }[] = [{ at: record.createdAt, state: itsmMeta(record.type).states[0] }];
  for (const a of record.activity) {
    if (a.kind !== "state") continue;
    const to = a.text.split("→")[1]?.trim();
    if (to) tl.push({ at: a.at, state: to });
  }
  return tl.sort((a, b) => a.at - b.at);
}

// Hours spent in working states, split across the calendar days they fall on (so a span
// crossing midnight is attributed to each day).
export function workingTimeByDay(record: ItsmRecord): Record<string, number> {
  const tl = stateTimeline(record);
  const out: Record<string, number> = {};
  const now = Date.now();
  for (let i = 0; i < tl.length; i++) {
    if (!isWorkingState(record.type, tl[i].state)) continue;
    let cur = tl[i].at;
    const end = i + 1 < tl.length ? tl[i + 1].at : now;
    while (cur < end) {
      const d = new Date(cur);
      const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
      const segEnd = Math.min(end, dayEnd);
      out[ymdLocal(cur)] = (out[ymdLocal(cur)] ?? 0) + (segEnd - cur) / 3_600_000;
      cur = segEnd;
    }
  }
  return out;
}

export const totalWorkingHours = (record: ItsmRecord): number =>
  Object.values(workingTimeByDay(record)).reduce((a, b) => a + b, 0);

// The actual working INTERVALS per day (minutes-from-midnight), so the timesheet can place
// Service Desk time at the real time it happened — not a fake all-day block.
export function workingSpansByDay(record: ItsmRecord): Record<string, { start: number; end: number }[]> {
  const tl = stateTimeline(record);
  const out: Record<string, { start: number; end: number }[]> = {};
  const now = Date.now();
  for (let i = 0; i < tl.length; i++) {
    if (!isWorkingState(record.type, tl[i].state)) continue;
    let cur = tl[i].at;
    const end = i + 1 < tl.length ? tl[i + 1].at : now;
    while (cur < end) {
      const d = new Date(cur);
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const dayEnd = dayStart + 86_400_000;
      const segEnd = Math.min(end, dayEnd);
      const start = Math.floor((cur - dayStart) / 60_000);
      const finish = Math.min(1440, Math.max(start + 1, Math.ceil((segEnd - dayStart) / 60_000)));
      (out[ymdLocal(cur)] ??= []).push({ start, end: finish });
      cur = segEnd;
    }
  }
  return out;
}

// ── per-priority time budget ("how much time they have") ────────────────────────
// Managers set it per board (synced via the board event log → BoardState.itsmBudget);
// everyone else just sees spent-vs-budget. Records with no board use the defaults.
export const DEFAULT_ITSM_BUDGET: Record<number, number> = { 1: 4, 2: 8, 3: 24, 4: 80 };

export function itsmBudget(boardId: string | null | undefined): Record<number, number> {
  if (boardId) {
    const b = loadBoardState(boardId).itsmBudget;
    if (b) return { ...DEFAULT_ITSM_BUDGET, ...b };
  }
  return DEFAULT_ITSM_BUDGET;
}

// The budgeted hours for a record (by its priority + its board's budget table).
export const budgetForRecord = (r: ItsmRecord): number => itsmBudget(r.boardId)[r.priority] ?? DEFAULT_ITSM_BUDGET[r.priority];

// ── per-wallet store ────────────────────────────────────────────────────────────
export interface ItsmStore { records: ItsmRecord[]; seq: Record<ItsmType, number> }
const storageKey = (addr: string) => `gtv_itsm_${addr}`;
const emptySeq = (): Record<ItsmType, number> => ({ incident: 0, request: 0, change: 0, problem: 0 });

export function normalizeRecord(r: ItsmRecord): ItsmRecord {
  const urgency = r.urgency ?? 2;
  const impact = r.impact ?? 2;
  return { ...r, links: r.links ?? [], attachments: r.attachments ?? [], activity: r.activity ?? [], urgency, impact, priority: r.priority ?? priorityOf(urgency, impact) };
}

export function loadItsm(addr: string | null): ItsmStore {
  if (!addr || typeof window === "undefined") return { records: [], seq: emptySeq() };
  try {
    const raw = localStorage.getItem(storageKey(addr));
    if (!raw) return { records: [], seq: emptySeq() };
    const s = JSON.parse(raw) as ItsmStore;
    return { records: (s.records ?? []).map(normalizeRecord), seq: { ...emptySeq(), ...(s.seq ?? {}) } };
  } catch {
    return { records: [], seq: emptySeq() };
  }
}

export function saveItsm(addr: string | null, store: ItsmStore): void {
  if (!addr || typeof window === "undefined") return;
  try { localStorage.setItem(storageKey(addr), JSON.stringify(store)); } catch { /* quota */ }
}

export function itsmNumber(rec: { type: ItsmType; num: number }): string {
  return `${itsmMeta(rec.type).prefix}${String(rec.num).padStart(7, "0")}`;
}

// ── "seen" marks (notification dot) — recordId → the updatedAt I last saw ──────
const seenKey = (addr: string) => `gtv_itsmseen_${addr}`;
export function loadItsmSeen(addr: string | null): Record<string, number> {
  if (!addr || typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(seenKey(addr)) || "{}") as Record<string, number>; } catch { return {}; }
}
export function saveItsmSeen(addr: string | null, map: Record<string, number>): void {
  if (!addr || typeof window === "undefined") return;
  try { localStorage.setItem(seenKey(addr), JSON.stringify(map)); } catch { /* quota */ }
}

export function newRecord(type: ItsmType, by?: string): ItsmRecord {
  const now = Date.now();
  const meta = itsmMeta(type);
  return {
    id: uid(), type, num: 0, shortDescription: "", description: "",
    state: meta.states[0], urgency: 2, impact: 2, priority: priorityOf(2, 2),
    category: "", assignee: "", requestedBy: by ?? "", dueDate: "",
    links: [], attachments: [], activity: [], approval: meta.needsApproval ? { state: "not_requested" } : undefined,
    boardId: undefined, owner: by, createdBy: by, createdAt: now, updatedAt: now,
  };
}

// Insert or update a record; assigns the next per-type number on first insert. Returns the
// saved store (and the inserted/updated record via store.records).
export function upsertRecord(addr: string | null, rec: ItsmRecord): ItsmStore {
  const store = loadItsm(addr);
  const exists = store.records.some((r) => r.id === rec.id);
  let next = { ...rec, priority: priorityOf(rec.urgency, rec.impact), updatedAt: Date.now() };
  if (!exists && next.num === 0) {
    const n = (store.seq[rec.type] ?? 0) + 1;
    store.seq = { ...store.seq, [rec.type]: n };
    next = { ...next, num: n };
  }
  store.records = exists ? store.records.map((r) => (r.id === rec.id ? next : r)) : [next, ...store.records];
  saveItsm(addr, store);
  return store;
}

export function removeRecord(addr: string | null, id: string): ItsmStore {
  const store = loadItsm(addr);
  store.records = store.records.filter((r) => r.id !== id);
  saveItsm(addr, store);
  return store;
}

export function activityEntry(by: string, kind: ActivityEntry["kind"], text: string): ActivityEntry {
  return { id: uid(), at: Date.now(), by, kind, text };
}

// ── shared-records cache (records folded from boards I'm a member of) ───────────
// A local cache so the cross-link pickers (resolveToken / itsmLinkTargets, all synchronous)
// can see records SHARED to me via a team — not just my own local ones. Written by ITSMView's
// discovery; NOT in the snapshot registry (it rebuilds from Arweave, like gtv_calshared_).
const sharedKey = (addr: string) => `gtv_itsmshared_${addr}`;
export function loadSharedItsm(addr: string | null): ItsmRecord[] {
  if (!addr || typeof window === "undefined") return [];
  try { return (JSON.parse(localStorage.getItem(sharedKey(addr)) || "[]") as ItsmRecord[]).map(normalizeRecord); } catch { return []; }
}
export function saveSharedItsm(addr: string | null, records: ItsmRecord[]): void {
  if (!addr || typeof window === "undefined") return;
  try { localStorage.setItem(sharedKey(addr), JSON.stringify(records)); } catch { /* quota */ }
}
// Every record I can see — my own (local) plus team-shared (cache), newest per id wins.
export function allItsmRecords(addr: string | null): ItsmRecord[] {
  if (!addr) return [];
  const m = new Map<string, ItsmRecord>();
  for (const r of loadSharedItsm(addr)) m.set(r.id, r);
  for (const r of loadItsm(addr).records) { const s = m.get(r.id); if (!s || r.updatedAt >= s.updatedAt) m.set(r.id, r); }
  return [...m.values()];
}

// ── reference targets (mirror board.ts ticketLinkTargets / ticketKeyIndex) ──────
export interface ItsmLinkTarget { token: string; label: string; type: ItsmType; state: string }
export function itsmLinkTargets(addr: string | null): ItsmLinkTarget[] {
  if (!addr) return [];
  return allItsmRecords(addr).map((r) => ({ token: itsmNumber(r), label: r.shortDescription || "(no description)", type: r.type, state: r.state }));
}
export interface ItsmRef { id: string; type: ItsmType; short: string; state: string }
export function itsmKeyIndex(addr: string | null): Record<string, ItsmRef> {
  const out: Record<string, ItsmRef> = {};
  if (!addr) return out;
  for (const r of allItsmRecords(addr)) out[itsmNumber(r)] = { id: r.id, type: r.type, short: r.shortDescription || "(no description)", state: r.state };
  return out;
}

// ── SLA due dates for the calendar (mirror calendar.boardTicketDues) ────────────
export interface ItsmDue { id: string; date: string; number: string; type: ItsmType; short: string; recordId: string }
export function itsmDues(addr: string | null): ItsmDue[] {
  if (!addr) return [];
  const out: ItsmDue[] = [];
  for (const r of allItsmRecords(addr)) {
    if (r.dueDate && isOpen(r)) out.push({ id: `itsmdue_${r.id}`, date: r.dueDate, number: itsmNumber(r), type: r.type, short: r.shortDescription || "(no description)", recordId: r.id });
  }
  return out;
}
