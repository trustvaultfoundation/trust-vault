// Issue-tracker ("board") data model + per-wallet persistence.
//
// A wallet has a LIST of boards (`gtv_boards_<address>`); each board's folded
// contents live under their own key (`gtv_boardstate_<boardId>`) so a board can
// later be shared/synced independently. Private boards stay entirely on-device;
// shared boards additionally sync as an encrypted Arweave event log (boardSync.ts).

export type Status = string; // a column id (columns are configurable per board)
export type Priority = "low" | "medium" | "high" | "urgent";
export type Role = "owner" | "admin" | "editor" | "viewer";

export interface Column {
  id: string;
  label: string;
  done?: boolean; // tickets here count as complete (no overdue highlight)
  hidden?: boolean; // kept but not shown on the board
  // Workflow rule: column ids a ticket in THIS column may move to. Empty/undefined
  // means no restriction (a ticket can go to any column). The current column is
  // always allowed (stay put). Lets the owner shape the process.
  allowedTransitions?: string[];
}

// A project is a named VIEW within a board: an ordered selection of the board's
// columns. A ticket belongs to whichever project(s) include its column, so moving a
// ticket to a column shows it in the project(s) holding that column (and in several
// at once if they share the column). Members are board-wide.
export interface Project {
  id: string;
  name: string;
  columnIds: string[]; // the board columns this project shows, in order
}

export interface Comment {
  id: string;
  author: string;
  text: string;
  createdAt: number;
}

export interface Attachment {
  txId: string;
  name: string;
  type: string;
  size?: number;
}

// A single logged time entry (worklog). `spent` (legacy single number)
// is superseded by the sum of these.
export interface WorkLog {
  id: string;
  title: string;
  date: string; // yyyy-mm-dd
  from: string | null; // HH:MM
  to: string | null; // HH:MM
  hours: number; // decimal hours (2.5 = 2h 30m)
  description: string;
  author: string;
  createdAt: number;
}

// Format decimal hours: 2.5 → "2h 30m", 4 → "4h", 0.75 → "45m". Minutes
// roll up intelligently (a 60m total reads as "1h", never "60m").
export function fmtDuration(hours: number | null | undefined): string {
  if (hours == null || hours <= 0) return "0m";
  const totalMin = Math.round(hours * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return [h ? `${h}h` : "", m ? `${m}m` : ""].filter(Boolean).join(" ") || "0m";
}

// Parse "2h 30m" / "2h" / "30m" / "2.5h" / "2.5" (plain number = hours) → decimal hours.
export function parseDuration(str: string): number | null {
  const s = (str ?? "").trim().toLowerCase();
  if (!s) return null;
  let total = 0;
  let matched = false;
  const h = s.match(/(\d+(?:\.\d+)?)\s*h/);
  const m = s.match(/(\d+(?:\.\d+)?)\s*m/);
  if (h) { total += parseFloat(h[1]) * 60; matched = true; }
  if (m) { total += parseFloat(m[1]); matched = true; }
  if (!matched) { const n = parseFloat(s); if (Number.isFinite(n)) { total = n * 60; matched = true; } }
  return matched ? Math.round(total) / 60 : null;
}

export interface Ticket {
  id: string; // internal uuid
  num: number; // per-board sequence; display key = boardCode(title) + "-" + num
  title: string;
  description: string; // HTML (Tiptap); legacy plain text renders as a paragraph
  status: Status;
  priority: Priority;
  assignee: string; // member label or free text
  labels: string[];
  dueDate: string | null; // yyyy-mm-dd or null
  startDate: string | null; // yyyy-mm-dd or null
  estimate: number | null; // hours estimated
  spent: number | null; // legacy single "time spent" (superseded by worklog)
  worklog: WorkLog[]; // logged time entries
  createdBy: string; // member label/address at creation
  comments: Comment[];
  attachments: Attachment[];
  links?: string[]; // related reference tokens (events, other tickets, Service Desk records)
  parentId: string | null; // sub-ticket: id of the parent ticket, or null
  createdAt: number;
  updatedAt: number;
  order: number; // sort position within its column
}

export interface Member {
  address: string;
  label: string;
  role: Role;
  addedAt: number;
  inactive?: boolean; // removed from the board, but kept so their tickets keep a name
}

// The folded contents of one board (cached at gtv_boardstate_<boardId>).
// A single timesheet entry — hours a member logged against a board (optionally a
// project/ticket) on a given day. Synced via the board event log so managers can review.
export type TimesheetStatus = "draft" | "submitted" | "approved" | "rejected";
export interface TimesheetEntry {
  id: string;
  author: string;        // the wallet that logged the time (== event author)
  authorLabel: string;   // display name at log time
  boardId: string;
  projectId?: string;
  ticketId?: string;     // optional linked ticket
  date: string;          // YYYY-MM-DD (start day for a span)
  endDate?: string;      // YYYY-MM-DD (inclusive end, for a "Normal" period/month span)
  kind?: "normal" | "holiday"; // a generic marker — all-day, or timed via from/to. "holiday" needs approval.
  from?: string;         // HH:MM (a timed "Normal" entry on a single day)
  to?: string;           // HH:MM
  title?: string;        // label for a "Normal" entry
  links?: string[];      // related reference tokens (RelatedLinks)
  hours: number;         // decimal hours (0 for a marker)
  note?: string;
  status: TimesheetStatus;
  approvedBy?: string;   // manager who approved/rejected
  updatedAt: number;     // last-writer-wins tiebreak
}

export interface BoardState {
  tickets: Ticket[];
  members: Member[];
  columns?: Column[]; // the board's column pool; falls back to DEFAULT_COLUMNS
  projects?: Project[]; // named column-views; falls back to one "Main" with all columns
  timesheets?: TimesheetEntry[]; // logged hours (timesheet feature)
  itsmBudget?: Record<number, number>; // per-priority Service Desk time budget (hours), manager-set
  seq: number; // last issued ticket number (feeds the GTV-N key)
}

// One entry in a wallet's board list (gtv_boards_<addr>).
export interface BoardMeta {
  id: string;
  title: string;
  owner: string; // owner wallet address
  shared: boolean; // false = private/local, true = shared on Arweave
  role: Role; // my role on this board
  updatedAt: number;
}

export const DEFAULT_COLUMNS: Column[] = [
  { id: "backlog", label: "Backlog" },
  { id: "open", label: "Open" },
  { id: "ready", label: "Ready" },
  { id: "in_progress", label: "In Progress" },
  { id: "in_review", label: "In Review" },
  { id: "done", label: "Done", done: true },
];

// Built-in extras a board can add from Settings (not present by default).
export const EXTRA_COLUMNS: Column[] = [
  { id: "todo", label: "To Do" },
  { id: "func_refinement", label: "Functional Refinement" },
  { id: "tech_refinement", label: "Technical Refinement" },
  { id: "arch_analysis", label: "Architectural Analysis" },
  { id: "blocked", label: "Blocked" },
  { id: "testing", label: "Testing" },
  { id: "released", label: "Released", done: true },
];

const COLUMN_COLORS = ["bg-slate-500", "bg-slate-400", "bg-indigo-400", "bg-amber-400", "bg-emerald-400", "bg-sky-400", "bg-rose-400", "bg-violet-400", "bg-teal-400"];
export const columnColor = (i: number) => COLUMN_COLORS[i % COLUMN_COLORS.length];

// The board's columns (with the default fallback for legacy boards).
export function boardColumns(state: BoardState): Column[] {
  return state.columns && state.columns.length ? state.columns : DEFAULT_COLUMNS;
}
// Visible columns only (hidden ones are kept but not rendered).
export const visibleColumns = (state: BoardState): Column[] => boardColumns(state).filter((c) => !c.hidden);
export const isDoneColumn = (state: BoardState, status: Status): boolean => !!boardColumns(state).find((c) => c.id === status)?.done;

export const MAIN_PROJECT_ID = "main";

// A board's projects (column-views). Falls back to a single "Main" view over all of
// the board's columns when none are defined (so legacy boards just work).
export function boardProjects(state: BoardState): Project[] {
  if (state.projects && state.projects.length) return state.projects;
  return [{ id: MAIN_PROJECT_ID, name: "Main", columnIds: boardColumns(state).map((c) => c.id) }];
}
// The columns shown in a project, in the project's order, limited to columns that
// still exist on the board (a deleted/renamed-away column is simply skipped).
export function projectColumns(state: BoardState, projectId: string): Column[] {
  const cols = boardColumns(state);
  const projs = boardProjects(state);
  const proj = projs.find((p) => p.id === projectId) ?? projs[0];
  return proj.columnIds.map((id) => cols.find((c) => c.id === id)).filter((c): c is Column => !!c);
}
// Workflow check: may a ticket in column `from` move to `to`? (Same column is always
// allowed; an empty/missing rule means no restriction.)
export function canMoveTo(state: BoardState, from: Status, to: Status): boolean {
  if (from === to) return true;
  const allowed = boardColumns(state).find((c) => c.id === from)?.allowedTransitions;
  return !allowed || allowed.length === 0 || allowed.includes(to);
}

export const ROLES: { id: Role; label: string; rank: number }[] = [
  { id: "owner", label: "Owner", rank: 3 },
  { id: "admin", label: "Admin", rank: 2 },
  { id: "editor", label: "Editor", rank: 1 },
  { id: "viewer", label: "Viewer", rank: 0 },
];
export const roleRank = (r: Role) => ROLES.find((x) => x.id === r)?.rank ?? 0;
export const canEdit = (r: Role | undefined) => !!r && roleRank(r) >= 1; // editor+
export const canManage = (r: Role | undefined) => !!r && roleRank(r) >= 2; // admin+

export const PRIORITIES: { id: Priority; label: string; chip: string; dot: string }[] = [
  { id: "urgent", label: "Urgent", chip: "bg-red-500/15 text-red-300 border-red-500/30", dot: "bg-red-400" },
  { id: "high", label: "High", chip: "bg-amber-500/15 text-amber-300 border-amber-500/30", dot: "bg-amber-400" },
  { id: "medium", label: "Medium", chip: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30", dot: "bg-indigo-400" },
  { id: "low", label: "Low", chip: "bg-slate-500/15 text-slate-300 border-slate-500/30", dot: "bg-slate-400" },
];

export const statusLabel = (s: Status) => [...DEFAULT_COLUMNS, ...EXTRA_COLUMNS].find((x) => x.id === s)?.label ?? s;
export const priorityMeta = (p: Priority) => PRIORITIES.find((x) => x.id === p) ?? PRIORITIES[2];

// ── persistence ──────────────────────────────────────────────────────────────

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);

const boardsKey = (addr: string) => `gtv_boards_${addr}`;
const stateKey = (boardId: string) => `gtv_boardstate_${boardId}`;
const currentKey = (addr: string) => `gtv_board_current_${addr}`;

export function emptyState(owner: string): BoardState {
  return { tickets: [], members: [{ address: owner, label: "You", role: "owner", addedAt: Date.now() }], columns: DEFAULT_COLUMNS, seq: 0 };
}

// Backfill new ticket fields (num from a legacy "PREFIX-12" key, plus the v2
// fields) so older boards keep working.
export function normalizeTicket(raw: unknown, i: number): Ticket {
  const t = raw as Partial<Ticket> & { key?: string };
  const num = typeof t.num === "number" ? t.num : (() => { const m = String(t.key ?? "").match(/(\d+)\s*$/); return m ? Number(m[1]) : i + 1; })();
  return {
    id: t.id ?? `t${i}`,
    num,
    title: t.title ?? "Untitled",
    description: t.description ?? "",
    status: t.status ?? "backlog",
    priority: t.priority ?? "medium",
    assignee: t.assignee ?? "",
    labels: t.labels ?? [],
    dueDate: t.dueDate ?? null,
    startDate: t.startDate ?? null,
    estimate: t.estimate ?? null,
    spent: t.spent ?? null,
    worklog: t.worklog ?? [],
    createdBy: t.createdBy ?? "",
    comments: t.comments ?? [],
    attachments: t.attachments ?? [],
    links: t.links ?? [],
    parentId: t.parentId ?? null,
    createdAt: t.createdAt ?? Date.now(),
    updatedAt: t.updatedAt ?? Date.now(),
    order: t.order ?? i,
  };
}

export function loadBoardState(boardId: string): BoardState {
  if (typeof window === "undefined") return { tickets: [], members: [], seq: 0 };
  try {
    const raw = localStorage.getItem(stateKey(boardId));
    if (raw) {
      const s = JSON.parse(raw) as BoardState;
      const tickets = (s.tickets ?? []).map(normalizeTicket);
      const seq = s.seq ?? tickets.reduce((m, t) => Math.max(m, t.num), 0);
      // projects (the per-project column views) MUST be loaded too — without them
      // boardProjects() falls back to the default "Main" view (all columns), which is
      // exactly the "default columns flash before the right ones load" bug.
      return { tickets, members: s.members ?? [], columns: s.columns, projects: s.projects, timesheets: s.timesheets ?? [], itsmBudget: s.itsmBudget, seq };
    }
  } catch {}
  return { tickets: [], members: [], seq: 0 };
}

export function saveBoardState(boardId: string, state: BoardState): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(stateKey(boardId), JSON.stringify(state)); } catch {}
}

export function saveBoards(addr: string | null, metas: BoardMeta[]): void {
  if (!addr || typeof window === "undefined") return;
  try { localStorage.setItem(boardsKey(addr), JSON.stringify(metas)); } catch {}
}

// A wallet's board list. On first run, migrates a legacy single board
// (`gtv_board_<addr>`) into the list, else seeds one empty "My Board".
export function loadBoards(addr: string | null): BoardMeta[] {
  if (!addr || typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(boardsKey(addr));
    if (raw) return JSON.parse(raw) as BoardMeta[];
    const legacy = localStorage.getItem(`gtv_board_${addr}`);
    const id = uid();
    const meta: BoardMeta = { id, title: "Main", owner: addr, shared: false, role: "owner", updatedAt: Date.now() };
    if (legacy) {
      const b = JSON.parse(legacy) as { tickets?: Ticket[]; seq?: number };
      saveBoardState(id, { tickets: b.tickets ?? [], members: emptyState(addr).members, seq: b.seq ?? (b.tickets?.length ?? 0) });
    } else {
      saveBoardState(id, emptyState(addr));
    }
    saveBoards(addr, [meta]);
    return [meta];
  } catch {
    return [];
  }
}

export function createBoard(addr: string, title: string): BoardMeta {
  const id = uid();
  const meta: BoardMeta = { id, title: title.trim() || "Untitled board", owner: addr, shared: false, role: "owner", updatedAt: Date.now() };
  saveBoardState(id, emptyState(addr));
  saveBoards(addr, [...loadBoards(addr), meta]);
  return meta;
}

export function renameBoard(addr: string, boardId: string, title: string): BoardMeta[] {
  const metas = loadBoards(addr).map((m) => (m.id === boardId ? { ...m, title: title.trim() || m.title, updatedAt: Date.now() } : m));
  saveBoards(addr, metas);
  return metas;
}

export function deleteBoard(addr: string, boardId: string): BoardMeta[] {
  const metas = loadBoards(addr).filter((m) => m.id !== boardId);
  saveBoards(addr, metas);
  try { localStorage.removeItem(stateKey(boardId)); } catch {}
  return metas;
}

export function loadCurrentBoardId(addr: string | null): string | null {
  if (!addr || typeof window === "undefined") return null;
  try { return localStorage.getItem(currentKey(addr)); } catch { return null; }
}

export function saveCurrentBoardId(addr: string | null, id: string): void {
  if (!addr || typeof window === "undefined") return;
  try { localStorage.setItem(currentKey(addr), id); } catch {}
}

// Remember the selected project (column-view) PER board, so reopening a board keeps
// the project you were on instead of snapping back to the first one.
const projectKey = (addr: string) => `gtv_board_project_${addr}`;
function loadProjectMap(addr: string | null): Record<string, string> {
  if (!addr || typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(projectKey(addr)) || "{}"); } catch { return {}; }
}
export function loadCurrentProjectId(addr: string | null, boardId: string | null): string | null {
  if (!boardId) return null;
  return loadProjectMap(addr)[boardId] ?? null;
}
export function saveCurrentProjectId(addr: string | null, boardId: string, projectId: string): void {
  if (!addr || typeof window === "undefined") return;
  try { const m = loadProjectMap(addr); m[boardId] = projectId; localStorage.setItem(projectKey(addr), JSON.stringify(m)); } catch {}
}

// ── pure helpers (return a NEW state so React updates cleanly) ─────────────────

export const newId = uid;

// Tickets of one column, in display order.
export function columnTickets(board: BoardState, status: Status): Ticket[] {
  return board.tickets.filter((t) => t.status === status).sort((a, b) => a.order - b.order);
}

// Fractional ordering so a move only needs to set the MOVED ticket's order (no
// sibling renumbering) — which keeps it to one event and avoids cross-client
// order collisions on shared boards.
export function orderBetween(prev: number | undefined, next: number | undefined): number {
  if (prev === undefined && next === undefined) return 0;
  if (prev === undefined) return (next as number) - 1;
  if (next === undefined) return prev + 1;
  return (prev + next) / 2;
}
export function orderForIndex(state: BoardState, status: Status, index: number, excludeId?: string): number {
  const items = columnTickets(state, status).filter((t) => t.id !== excludeId);
  return orderBetween(items[index - 1]?.order, items[index]?.order);
}
export function bottomOrder(state: BoardState, status: Status): number {
  const items = columnTickets(state, status);
  return items.length ? items[items.length - 1].order + 1 : 0;
}

// Ticket display key = board-name prefix + the ticket's stable number, so
// renaming a board re-prefixes every key (numbers preserved, no stored key).
export function boardCode(title: string): string {
  const code = (title || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return code ? code.slice(0, 16) : "BOARD";
}
export const ticketKey = (code: string, num: number) => `${code}-${num}`;

// Every ticket across this wallet's boards, for searchable pickers (e.g. linking a
// calendar task to a ticket).
export function listAllTickets(addr: string | null): { boardId: string; ticketId: string; key: string; title: string; boardTitle: string }[] {
  if (!addr) return [];
  const out: { boardId: string; ticketId: string; key: string; title: string; boardTitle: string }[] = [];
  for (const b of loadBoards(addr)) {
    const code = boardCode(b.title);
    for (const t of loadBoardState(b.id).tickets) out.push({ boardId: b.id, ticketId: t.id, key: `${code}-${t.num}`, title: t.title || "Untitled", boardTitle: b.title });
  }
  return out;
}

// Map every ticket's display key (e.g. "DESIGN-12") → where to find it, across all
// of this wallet's boards. Used to turn ticket keys typed in chat into links.
export interface TicketLinkTarget { key: string; title: string; boardId: string; ticketId: string; boardTitle: string }
// Tickets (sub-tickets included — they're tickets too) as search targets for the
// chat "+" link picker.
export function ticketLinkTargets(addr: string | null): TicketLinkTarget[] {
  if (!addr) return [];
  const out: TicketLinkTarget[] = [];
  for (const b of loadBoards(addr)) {
    const code = boardCode(b.title);
    for (const t of loadBoardState(b.id).tickets) out.push({ key: `${code}-${t.num}`, title: t.title || "Untitled", boardId: b.id, ticketId: t.id, boardTitle: b.title });
  }
  return out;
}

export function ticketKeyIndex(addr: string | null): Record<string, { boardId: string; ticketId: string; boardTitle: string }> {
  const out: Record<string, { boardId: string; ticketId: string; boardTitle: string }> = {};
  if (!addr) return out;
  for (const b of loadBoards(addr)) {
    const code = boardCode(b.title);
    for (const t of loadBoardState(b.id).tickets) out[`${code}-${t.num}`] = { boardId: b.id, ticketId: t.id, boardTitle: b.title };
  }
  return out;
}

// Direct sub-tickets (children) of a ticket, in display order.
export function subTickets(tickets: Ticket[], parentId: string): Ticket[] {
  return tickets.filter((t) => t.parentId === parentId).sort((a, b) => a.order - b.order);
}

// A column's tickets arranged for display: top-level tickets (whose parent is NOT
// in this column) sorted by `order`, each immediately followed by its in-column
// sub-tickets (recursively, sorted by number asc) — so a sub-ticket sits grouped &
// indented right under its parent. `depth` (0 = root) drives the indentation.
export function columnRows(state: BoardState, status: Status): { ticket: Ticket; depth: number }[] {
  const inCol = state.tickets.filter((t) => t.status === status);
  const ids = new Set(inCol.map((t) => t.id));
  const kids = (pid: string) => inCol.filter((t) => t.parentId === pid).sort((a, b) => a.num - b.num);
  const roots = inCol.filter((t) => !t.parentId || !ids.has(t.parentId)).sort((a, b) => a.order - b.order);
  const out: { ticket: Ticket; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (t: Ticket, depth: number) => {
    if (seen.has(t.id)) return;
    seen.add(t.id);
    out.push({ ticket: t, depth });
    for (const c of kids(t.id)) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  for (const t of inCol) if (!seen.has(t.id)) walk(t, 0); // safety: anything left (e.g. a cycle) as a root
  return out;
}

// Every descendant id of a ticket — used to forbid re-parenting that would make a
// cycle (you can't make a ticket a child of one of its own descendants).
export function descendantIds(tickets: Ticket[], rootId: string): Set<string> {
  const out = new Set<string>();
  const walk = (pid: string) => { for (const t of tickets) if (t.parentId === pid && !out.has(t.id)) { out.add(t.id); walk(t.id); } };
  walk(rootId);
  return out;
}

// Total hours logged on a ticket (worklog sum; falls back to the legacy `spent`).
export function loggedHours(t: { worklog?: WorkLog[]; spent?: number | null }): number {
  if (t.worklog && t.worklog.length) return t.worklog.reduce((s, w) => s + (w.hours || 0), 0);
  return t.spent ?? 0;
}

// ── small presentation helpers (pure, shared by the board UI components) ───────

const LABEL_COLORS = [
  "bg-sky-500/15 text-sky-300 border-sky-500/30",
  "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "bg-violet-500/15 text-violet-300 border-violet-500/30",
  "bg-pink-500/15 text-pink-300 border-pink-500/30",
  "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "bg-teal-500/15 text-teal-300 border-teal-500/30",
];

// Deterministic colour for a label chip so the same label always looks the same.
export function labelColor(label: string): string {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return LABEL_COLORS[h % LABEL_COLORS.length];
}

export const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";

export const shortAddr = (a: string) => (a && a.length > 10 ? `${a.slice(0, 5)}…${a.slice(-4)}` : a || "You");

const DAY = 86_400_000;

// Due-date chip text + colour tone, relative to today and whether it's done.
export function dueMeta(dueDate: string | null, done: boolean): { label: string; tone: string } | null {
  if (!dueDate) return null;
  const due = new Date(dueDate + "T00:00:00").getTime();
  if (Number.isNaN(due)) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((due - today.getTime()) / DAY);
  const label = new Date(due).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (done) return { label, tone: "text-slate-500" };
  if (days < 0) return { label: `${label} · overdue`, tone: "text-red-400" };
  if (days === 0) return { label: `${label} · today`, tone: "text-amber-400" };
  if (days <= 2) return { label, tone: "text-amber-400" };
  return { label, tone: "text-slate-400" };
}
