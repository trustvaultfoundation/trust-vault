// Analytics dashboard: derive widget datasets from the user's documents, plus
// per-wallet persistence of the grid layout and each widget's view config.
//
// Everything is computed in-browser from the same StoredUpload records the vault
// already holds — no new network calls, no server. Layout/config is saved to
// localStorage keyed by wallet, so it survives disconnect/reconnect on this
// browser (cross-device would need a server, which the app deliberately avoids).

import type { StoredUpload } from "./vault";
import { FREE_UPLOAD_LIMIT } from "./turboCredits";
import { boardColumns, isDoneColumn, statusLabel as boardStatusLabel, type BoardState, type Ticket } from "./board";
import { itsmMeta, itsmNumber, isOpen, priorityMeta as itsmPriorityMeta, ITSM_TYPES, type ItsmRecord } from "./itsm";
import type { ActivityItem, SourceKey } from "./timesheet";

export type Viz = "table" | "bar" | "line" | "stat";
export type Granularity = "auto" | "minute" | "hour" | "day" | "month";

export interface Series {
  label: string;
  value: number;
  color?: string;
}
/** One named line: a value at each time bucket (points share the x labels). */
export interface MultiSeries {
  name: string;
  points: Series[];
  color?: string;
}
export interface TableData {
  columns: string[];
  rows: (string | number)[][];
  /** which column the category filter matches on (default 0) — lets a detail table keep a
   *  different first column (e.g. Date) while still filtering by another (e.g. Who). */
  filterCol?: number;
}
export interface WidgetData {
  id: string;
  title: string;
  viz: Viz[]; // which views this widget supports
  series: Series[]; // snapshot per category — for the bar view (+ simple table)
  multi: MultiSeries[]; // one line per category over time — for the line view
  table: TableData; // for the table view + exports
  stat?: { value: string; sub?: string };
  /** true when series labels are categories you'd want to filter (ext, tag…). */
  filterable: boolean;
  /** when "hours", chart axes/labels/tooltips render the numeric value as a duration (2h 30m). */
  valueUnit?: "hours";
}

// Fixed, ordered palette. Colours are assigned BY POSITION (1st, 2nd, …) so the
// pattern is the same in every chart: the first series is always this indigo,
// the second always this green, etc. Single-metric widgets (AR, upload count)
// use one colour for all bars because they're all the same thing.
export const PALETTE = [
  "#818cf8", // indigo
  "#34d399", // emerald
  "#fbbf24", // amber
  "#f472b6", // pink
  "#22d3ee", // cyan
  "#c084fc", // violet
  "#fb7185", // rose
  "#a3e635", // lime
  "#2dd4bf", // teal
  "#fb923c", // orange
  "#60a5fa", // blue
  "#facc15", // yellow
];
export function colorAt(i: number): string {
  return PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length];
}

// ── helpers ──────────────────────────────────────────────────────────────────

function ext(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return m ? m[1] : "none";
}
// File size as a plain KB number (no unit — the column header carries the "(KB)" metric,
// so every row is a bare, comparable number instead of a mix of "79 KB" / "1 MB").
function sizeKb(n: number): string {
  if (!n) return "0";
  return (n / 1024).toFixed(1);
}
// Date + hours:minutes (the "period" shown in the transaction tables).
function fmtDateTime(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}
// The cost of an upload: the EXACT amount Turbo charged (recorded at upload time) when we have it,
// otherwise the size-based estimate. 0 for free-tier uploads.
function arCost(u: StoredUpload): number {
  return u.costAr ?? estAr(u.originalSize);
}
// AR cost as a bare number (no "AR" suffix — the column header already says "AR (est.)",
// so the rows stay numbers-only). 0 for free-tier uploads.
function fmtArCost(u: StoredUpload): string {
  const ar = arCost(u);
  return ar === 0 ? "0" : ar.toFixed(5);
}
type Gran = "minute" | "hour" | "day" | "month";
// Pick a time-bucket size that suits the selected range, so short ranges (last
// 5 min) bucket by minute and long ones by month.
function granularityFor(rangeMs: number): Gran {
  if (rangeMs > 0 && rangeMs <= 2 * 60 * 60_000) return "minute";
  if (rangeMs > 0 && rangeMs <= 2 * 24 * 60 * 60_000) return "hour";
  if (rangeMs > 0 && rangeMs <= 90 * 24 * 60 * 60_000) return "day";
  return "month";
}
function bucket(ms: number, g: Gran): string {
  if (!ms) return "—";
  const iso = new Date(ms).toISOString();
  if (g === "minute") return iso.slice(5, 16).replace("T", " "); // MM-DD HH:MM
  if (g === "hour") return `${iso.slice(5, 13).replace("T", " ")}h`; // MM-DD HHh
  if (g === "day") return iso.slice(0, 10); // YYYY-MM-DD
  return iso.slice(0, 7); // YYYY-MM
}
// Every bucket in [start, end] at granularity g, each paired with the timestamp at
// the END of that bucket period (`t`), so empty periods still get a point (a 0) and
// point-in-time "snapshot" charts can ask "what was true as of this bucket?". `cap`
// is only a runaway guard (e.g. minute over years) so the browser can't freeze; for
// realistic spans EVERY bucket from start→end is returned (no clamping).
function bucketGrid(start: number, end: number, g: Gran, cap = 200_000): { label: string; t: number }[] {
  if (!(end > 0)) return [];
  if (g === "month") {
    const out: { label: string; t: number }[] = [];
    const d = new Date(end);
    d.setUTCDate(1);
    d.setUTCHours(0, 0, 0, 0);
    while (d.getTime() >= start && out.length < cap) {
      const next = new Date(d);
      next.setUTCMonth(next.getUTCMonth() + 1);
      out.push({ label: bucket(d.getTime(), g), t: next.getTime() - 1 });
      d.setUTCMonth(d.getUTCMonth() - 1);
    }
    return out.reverse();
  }
  const step = g === "minute" ? 60_000 : g === "hour" ? 3_600_000 : 86_400_000;
  const endA = Math.floor(end / step) * step;
  const startA = Math.floor(Math.max(start, 0) / step) * step;
  const lo = Math.max(startA, endA - (cap - 1) * step);
  const out: { label: string; t: number }[] = [];
  for (let t = lo; t <= endA; t += step) out.push({ label: bucket(t, g), t: t + step - 1 });
  return out;
}
// Just the labels (the common case — flow charts that bucket items at their event time).
function bucketRange(start: number, end: number, g: Gran, cap = 200_000): string[] {
  return bucketGrid(start, end, g, cap).map((b) => b.label);
}
// Storage price per upload. Files at/under Turbo's free tier cost NOTHING, so those are 0 — only
// larger files draw a real charge, estimated from a probe-measured base + per-byte rate
// (~0.00146 AR + ~1629 winston/byte). `bytes` is the original file size; the free-tier boundary is
// the same order of magnitude on the encrypted item, so it's the right cut-off for a "(est.)".
function estAr(bytes: number): number {
  if (bytes <= FREE_UPLOAD_LIMIT) return 0;
  return (1_462_094_232 + 1629 * bytes) / 1e12;
}
function toSeries(counts: Map<string, number>): Series[] {
  return [...counts.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}
// Colour by POSITION so the pattern matches across charts.
function colored(series: Series[]): Series[] {
  return series.map((s, i) => ({ ...s, color: colorAt(i) }));
}
// One colour for every bar — for single-metric widgets (all the same token/thing).
function singleColored(series: Series[]): Series[] {
  return series.map((s) => ({ ...s, color: colorAt(0) }));
}
// Colour each line by its category's colour in `series`, so the line for "pdf"
// is the SAME colour as the "pdf" bar (falls back to position otherwise).
function matchColors(multi: MultiSeries[], series: Series[]): MultiSeries[] {
  const map = new Map(series.map((s) => [s.label, s.color]));
  return multi.map((m, i) => ({ ...m, color: map.get(m.name) ?? colorAt(i) }));
}
function seriesTable(series: Series[], columns: [string, string]): TableData {
  return { columns, rows: series.map((s) => [s.label, s.value]) };
}
function countBy<T>(items: T[], key: (t: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) m.set(key(it), (m.get(key(it)) ?? 0) + 1);
  return m;
}
function sortedBuckets(items: StoredUpload[], g: Gran): string[] {
  return [...new Set(items.map((u) => bucket(u.uploadedAt, g)))].sort((a, b) => a.localeCompare(b));
}
function bucketCounts(items: StoredUpload[], buckets: string[], g: Gran): Series[] {
  const m = countBy(items, (u) => bucket(u.uploadedAt, g));
  return buckets.map((b) => ({ label: b, value: m.get(b) ?? 0 }));
}
// One line per category, each with a value at every shared time bucket (0 where
// absent). Categories sorted by total so the busiest lines come first.
function multiByCategory(items: StoredUpload[], buckets: string[], cat: (u: StoredUpload) => string[], g: Gran): MultiSeries[] {
  const byCat = new Map<string, Map<string, number>>();
  for (const u of items) {
    const b = bucket(u.uploadedAt, g);
    for (const c of cat(u)) {
      let mm = byCat.get(c);
      if (!mm) { mm = new Map(); byCat.set(c, mm); }
      mm.set(b, (mm.get(b) ?? 0) + 1);
    }
  }
  return [...byCat.entries()]
    .map(([name, mm]) => ({ name, total: [...mm.values()].reduce((a, c) => a + c, 0), points: buckets.map((b) => ({ label: b, value: mm.get(b) ?? 0 })) }))
    .sort((a, b) => b.total - a.total)
    .map(({ name, points }) => ({ name, points }));
}

/** Compute every widget's dataset from the (already range-filtered) owned +
 *  shared documents. Bar/table use the snapshot `series`; line uses `multi`
 *  (one coloured line per category over time). Time buckets use `granularity`
 *  ("auto" ⇒ derive from rangeMs). */
export function computeWidgets(
  uploads: StoredUpload[],
  shared: StoredUpload[],
  rangeMs = 0,
  granularity: Granularity = "auto",
  windowStart?: number,
  windowEnd?: number,
): WidgetData[] {
  const g: Gran = granularity === "auto" ? granularityFor(rangeMs) : granularity;
  // Continuous buckets over the window (0-fills empty periods); falls back to
  // data-only buckets only when no window is given.
  const win = windowStart !== undefined && windowEnd !== undefined ? bucketRange(windowStart, windowEnd, g) : [];
  const uBuckets = win.length ? win : sortedBuckets(uploads, g);
  const osBuckets = win.length ? win : sortedBuckets([...uploads, ...shared], g);

  // 1 — recent transactions: per-transaction table (Time first w/ HH:MM, + AR)
  const recent = [...uploads].sort((a, b) => b.uploadedAt - a.uploadedAt);
  const txTable: TableData = {
    columns: ["Time", "Document", "Type", "Size (KB)", "AR (est.)", "Transaction"],
    rows: recent.slice(0, 300).map((u) => [fmtDateTime(u.uploadedAt), u.originalName, u.documentType || ext(u.originalName), sizeKb(u.originalSize), fmtArCost(u), u.txId]),
  };
  const txSeries = singleColored(bucketCounts(uploads, uBuckets, g));

  // 2 — AR spent (estimated): per-transaction table so each amount shows its tx
  const totalAr = uploads.reduce((s, u) => s + arCost(u), 0);
  const arMap = new Map<string, number>();
  for (const u of uploads) arMap.set(bucket(u.uploadedAt, g), (arMap.get(bucket(u.uploadedAt, g)) ?? 0) + arCost(u));
  const arSeries = singleColored(uBuckets.map((b) => ({ label: b, value: Number((arMap.get(b) ?? 0).toFixed(5)) })));
  const arTable: TableData = {
    columns: ["Time", "Document", "AR (est.)", "Transaction"],
    rows: recent.slice(0, 300).map((u) => [fmtDateTime(u.uploadedAt), u.originalName, fmtArCost(u), u.txId]),
  };

  // 3 — by extension, 4 — owned vs shared, 5 — by tag, 6 — distinct tag count
  const extSeries = colored(toSeries(countBy(uploads, (u) => ext(u.originalName))));
  const ownedShared = colored([
    { label: "Owned", value: uploads.length },
    { label: "Shared with me", value: shared.length },
  ]);
  const tagSeries = colored(toSeries(countBy(uploads.flatMap((u) => (u.tags ?? []).map((t) => ({ t }))), (x) => x.t)));
  const distinctTags = new Set(uploads.flatMap((u) => u.tags ?? [])).size;

  return [
    { id: "recent-tx", title: "Recent Transactions", viz: ["table", "bar", "line"], series: txSeries, multi: [{ name: "Uploads", points: txSeries, color: colorAt(0) }], table: txTable, filterable: false },
    {
      id: "ar-spent",
      title: "AR Spent on Storage (est.)",
      viz: ["stat", "bar", "line", "table"],
      series: arSeries,
      multi: [{ name: "AR (est.)", points: arSeries, color: colorAt(0) }],
      table: arTable,
      stat: { value: `${totalAr.toFixed(5)} AR`, sub: `estimated · ${uploads.length} upload${uploads.length !== 1 ? "s" : ""}` },
      filterable: false,
    },
    { id: "by-ext", title: "Files by Extension", viz: ["bar", "line", "table"], series: extSeries, multi: matchColors(multiByCategory(uploads, uBuckets, (u) => [ext(u.originalName)], g), extSeries), table: seriesTable(extSeries, ["Extension", "Files"]), filterable: true },
    {
      id: "owned-shared",
      title: "Owned vs Shared",
      viz: ["bar", "line", "table"],
      series: ownedShared,
      multi: matchColors(
        [
          { name: "Owned", points: bucketCounts(uploads, osBuckets, g) },
          { name: "Shared with me", points: bucketCounts(shared, osBuckets, g) },
        ],
        ownedShared,
      ),
      table: seriesTable(ownedShared, ["Access", "Files"]),
      filterable: true,
    },
    { id: "by-tag", title: "Files by Tag", viz: ["bar", "line", "table"], series: tagSeries, multi: matchColors(multiByCategory(uploads, uBuckets, (u) => u.tags ?? [], g), tagSeries), table: seriesTable(tagSeries, ["Tag", "Files"]), filterable: true },
    {
      id: "tag-count",
      title: "Tags in Use",
      viz: ["stat", "table"],
      series: tagSeries,
      multi: [],
      table: seriesTable(tagSeries, ["Tag", "Files"]),
      stat: { value: String(distinctTags), sub: "distinct tags" },
      filterable: false,
    },
  ];
}

// ── board & service-desk scopes ────────────────────────────────────────────────
// The dashboard analyses one of three "scopes": the user's documents (computeWidgets
// above), a single board's tickets, or one Service-Desk team's records. Each produces
// the same WidgetData[] shape, so the grid / cards / charts are reused unchanged.

export type ScopeKind = "documents" | "board" | "itsm" | "timesheet";
/** A chosen scope. `id` = boardId (board/timesheet) or team key — a boardId or "none" (itsm).
 *  The sentinel `id === "*"` means "all" — aggregate across every board / team the wallet has. */
export interface Scope { kind: ScopeKind; id?: string }
export const ALL_ID = "*";
export const isAllScope = (s: Scope): boolean => s.id === ALL_ID;

// One canonical colour per category, used site-wide so a category always reads the same way.
// The tints reuse the Timesheet page's source palette where it maps (Boards ≈ board-ticket sky,
// Service Desk = amber, Timesheet = the "Normal" emerald); Documents gets the brand indigo.
export const CATEGORY_STYLE: Record<ScopeKind, { label: string; chip: string; dot: string }> = {
  documents: { label: "Documents", chip: "bg-indigo-500/15 text-indigo-300", dot: "bg-indigo-400" },
  board: { label: "Boards", chip: "bg-sky-500/15 text-sky-300", dot: "bg-sky-400" },
  itsm: { label: "Service Desk", chip: "bg-amber-500/15 text-amber-300", dot: "bg-amber-400" },
  timesheet: { label: "Timesheet", chip: "bg-emerald-500/15 text-emerald-300", dot: "bg-emerald-400" },
};
export function scopeKey(s: Scope): string {
  return s.kind === "documents" ? "documents" : `${s.kind}:${s.id ?? ""}`;
}

// Generic time-series helpers (the document ones above are typed to StoredUpload).
function tsBuckets(times: number[], g: Gran): string[] {
  return [...new Set(times.filter(Boolean).map((t) => bucket(t, g)))].sort((a, b) => a.localeCompare(b));
}
function bucketCountsT<T>(items: T[], buckets: string[], time: (t: T) => number, g: Gran): Series[] {
  const m = new Map<string, number>();
  for (const it of items) { const b = bucket(time(it), g); m.set(b, (m.get(b) ?? 0) + 1); }
  return buckets.map((b) => ({ label: b, value: m.get(b) ?? 0 }));
}
function multiByCatT<T>(items: T[], buckets: string[], time: (t: T) => number, cats: (t: T) => string[], g: Gran): MultiSeries[] {
  const byCat = new Map<string, Map<string, number>>();
  for (const it of items) {
    const b = bucket(time(it), g);
    for (const c of cats(it)) { let mm = byCat.get(c); if (!mm) { mm = new Map(); byCat.set(c, mm); } mm.set(b, (mm.get(b) ?? 0) + 1); }
  }
  return [...byCat.entries()]
    .map(([name, mm]) => ({ name, total: [...mm.values()].reduce((a, c) => a + c, 0), points: buckets.map((b) => ({ label: b, value: mm.get(b) ?? 0 })) }))
    .sort((a, b) => b.total - a.total)
    .map(({ name, points }) => ({ name, points }));
}
// Point-in-time SNAPSHOT over time: for every bucket, count the items whose category
// value AT THAT BUCKET'S TIME is c — so an item contributes to a category for the whole
// span it held that value and drops out the moment it changes (the "stays 3 days then
// removed" behaviour), rather than being counted once at its creation. `valueAt` returns
// the item's category as of time t (or null = not applicable then). Items count only from
// `created` onward. Lines are ordered by their latest (current) value, matching the bars.
function multiSnapshotT<T>(items: T[], grid: { label: string; t: number }[], created: (it: T) => number, valueAt: (it: T, t: number) => string | null): MultiSeries[] {
  const byCat = new Map<string, number[]>();
  const lane = (c: string) => { let a = byCat.get(c); if (!a) { a = new Array(grid.length).fill(0); byCat.set(c, a); } return a; };
  for (const it of items) {
    const born = created(it);
    for (let i = 0; i < grid.length; i++) {
      if (born > grid[i].t) continue; // not yet created as of this bucket
      const v = valueAt(it, grid[i].t);
      if (v == null) continue;
      lane(v)[i] += 1;
    }
  }
  const last = grid.length - 1;
  return [...byCat.entries()]
    .map(([name, counts]) => ({ name, latest: counts[last] ?? 0, points: grid.map((b, i) => ({ label: b.label, value: counts[i] })) }))
    .sort((a, b) => b.latest - a.latest)
    .map(({ name, points }) => ({ name, points }));
}
// Reconstruct an ITSM record's state as of time `t` from its activity log. State changes
// are logged as `State: <old> → <new>` (kind "state"); before the first change the state
// was that entry's `old`, and a record with no logged change kept its current state.
function itsmStateAt(r: ItsmRecord, t: number): string {
  const changes = r.activity
    .filter((a) => a.kind === "state")
    .map((a) => { const m = /State:\s*(.+?)\s*→\s*(.+)$/.exec(a.text); return m ? { at: a.at, from: m[1].trim(), to: m[2].trim() } : null; })
    .filter((c): c is { at: number; from: string; to: string } => !!c)
    .sort((a, b) => a.at - b.at);
  if (changes.length === 0) return r.state;
  if (t < changes[0].at) return changes[0].from;
  let s = changes[0].to;
  for (const c of changes) { if (c.at <= t) s = c.to; else break; }
  return s;
}
// A category series in a FIXED order (board columns / priorities / types), keeping zero rows.
function orderedSeries(order: { id: string; label: string }[], counts: Map<string, number>): Series[] {
  return colored(order.map((o) => ({ label: o.label, value: counts.get(o.id) ?? 0 })));
}

const BOARD_PRIO_ORDER = [
  { id: "urgent", label: "Urgent" }, { id: "high", label: "High" }, { id: "medium", label: "Medium" }, { id: "low", label: "Low" },
];

/** Widgets for ONE board (its kanban tickets). */
export function computeBoardWidgets(state: BoardState, rangeMsArg = 0, granularity: Granularity = "auto", windowStart?: number, windowEnd?: number): WidgetData[] {
  const g: Gran = granularity === "auto" ? granularityFor(rangeMsArg) : granularity;
  const tickets = state.tickets;
  const win = windowStart !== undefined && windowEnd !== undefined ? bucketRange(windowStart, windowEnd, g) : tsBuckets(tickets.map((t) => t.createdAt), g);
  const time = (t: Ticket) => t.createdAt;
  const prioLabel = (p: string) => BOARD_PRIO_ORDER.find((x) => x.id === p)?.label ?? p;

  const statusSeries = orderedSeries(boardColumns(state).map((c) => ({ id: c.id, label: c.label })), countBy(tickets, (t) => t.status));
  const prioSeries = orderedSeries(BOARD_PRIO_ORDER, countBy(tickets, (t) => t.priority));
  const assigneeSeries = colored(toSeries(countBy(tickets, (t) => t.assignee || "Unassigned")));
  const labelSeries = colored(toSeries(countBy(tickets.flatMap((t) => (t.labels.length ? t.labels : ["(none)"]).map((l) => ({ l }))), (x) => x.l)));
  const done = tickets.filter((t) => isDoneColumn(state, t.status)).length;
  const open = tickets.length - done;
  const openDone = colored([{ label: "Open", value: open }, { label: "Done", value: done }]);
  const createdPts = bucketCountsT(tickets, win, time, g);
  const recent = [...tickets].sort((a, b) => b.createdAt - a.createdAt);
  const recentTable: TableData = {
    columns: ["Created", "Title", "Status", "Priority", "Assignee", "Due"],
    rows: recent.slice(0, 300).map((t) => [fmtDateTime(t.createdAt), t.title, boardStatusLabel(t.status), prioLabel(t.priority), t.assignee || "—", t.dueDate || "—"]),
  };

  return [
    { id: "b-status", title: "Tickets by Status", viz: ["bar", "line", "table"], series: statusSeries, multi: matchColors(multiByCatT(tickets, win, time, (t) => [boardStatusLabel(t.status)], g), statusSeries), table: seriesTable(statusSeries, ["Status", "Tickets"]), filterable: true },
    { id: "b-priority", title: "Tickets by Priority", viz: ["bar", "line", "table"], series: prioSeries, multi: matchColors(multiByCatT(tickets, win, time, (t) => [prioLabel(t.priority)], g), prioSeries), table: seriesTable(prioSeries, ["Priority", "Tickets"]), filterable: true },
    { id: "b-assignee", title: "Tickets by Assignee", viz: ["bar", "line", "table"], series: assigneeSeries, multi: matchColors(multiByCatT(tickets, win, time, (t) => [t.assignee || "Unassigned"], g), assigneeSeries), table: seriesTable(assigneeSeries, ["Assignee", "Tickets"]), filterable: true },
    { id: "b-open", title: "Open vs Done", viz: ["stat", "bar", "table"], series: openDone, multi: [], table: seriesTable(openDone, ["State", "Tickets"]), stat: { value: String(open), sub: `open · ${tickets.length} total` }, filterable: true },
    { id: "b-created", title: "Tickets Created", viz: ["line", "bar", "table"], series: singleColored(createdPts), multi: [{ name: "Created", points: createdPts, color: colorAt(0) }], table: { columns: ["Period", "Tickets"], rows: createdPts.map((s) => [s.label, s.value]) }, filterable: false },
    { id: "b-label", title: "Tickets by Label", viz: ["bar", "line", "table"], series: labelSeries, multi: matchColors(multiByCatT(tickets, win, time, (t) => (t.labels.length ? t.labels : ["(none)"]), g), labelSeries), table: seriesTable(labelSeries, ["Label", "Tickets"]), filterable: true },
    { id: "b-recent", title: "Recent Tickets", viz: ["table", "line", "bar"], series: singleColored(createdPts), multi: [{ name: "Created", points: createdPts, color: colorAt(0) }], table: recentTable, filterable: false },
  ];
}

/** Widgets for ONE Service-Desk team (its records). */
export function computeItsmWidgets(records: ItsmRecord[], rangeMsArg = 0, granularity: Granularity = "auto", windowStart?: number, windowEnd?: number): WidgetData[] {
  const g: Gran = granularity === "auto" ? granularityFor(rangeMsArg) : granularity;
  const wEnd = windowEnd ?? Date.now();
  const wStart = windowStart ?? (records.length ? Math.min(...records.map((r) => r.createdAt)) : wEnd);
  const grid = bucketGrid(wStart, wEnd, g);
  const win = grid.map((b) => b.label);
  const time = (r: ItsmRecord) => r.createdAt;

  // Bars (and table totals) reflect the CURRENT snapshot — how many records are in each
  // category right now. The over-time lines use multiSnapshotT so a record counts toward a
  // category for the whole span it held that value (state from its activity history), then
  // drops out when it changes — instead of being counted once at creation.
  const typeSeries = orderedSeries(ITSM_TYPES.map((t) => ({ id: t.type, label: t.plural })), countBy(records, (r) => r.type));
  const stateSeries = colored(toSeries(countBy(records, (r) => r.state)));
  const prioSeries = orderedSeries([1, 2, 3, 4].map((p) => ({ id: String(p), label: itsmPriorityMeta(p).short })), countBy(records, (r) => String(r.priority)));
  const assigneeSeries = colored(toSeries(countBy(records, (r) => r.assignee || "Unassigned")));
  const openN = records.filter((r) => isOpen(r)).length;
  const openClosed = colored([{ label: "Open", value: openN }, { label: "Closed", value: records.length - openN }]);
  const createdPts = bucketCountsT(records, win, time, g);
  const recent = [...records].sort((a, b) => b.createdAt - a.createdAt);
  const ui = (v: number) => (v === 1 ? "High" : v === 2 ? "Medium" : "Low");
  const recentTable: TableData = {
    columns: ["Created", "Number", "Short description", "Type", "State", "Priority", "Urgency", "Impact", "Category", "Assignee", "Requested by", "Target date", "Updated"],
    rows: recent.slice(0, 300).map((r) => [
      fmtDateTime(r.createdAt), itsmNumber(r), r.shortDescription || "(no description)", itsmMeta(r.type).label, r.state,
      itsmPriorityMeta(r.priority).short, ui(r.urgency), ui(r.impact), r.category || "—", r.assignee || "—",
      r.requestedBy || "—", r.dueDate || "—", fmtDateTime(r.updatedAt),
    ]),
  };

  return [
    { id: "i-type", title: "Records by Type", viz: ["bar", "line", "table"], series: typeSeries, multi: matchColors(multiSnapshotT(records, grid, time, (r) => itsmMeta(r.type).plural), typeSeries), table: seriesTable(typeSeries, ["Type", "Records"]), filterable: true },
    { id: "i-priority", title: "Records by Priority", viz: ["bar", "line", "table"], series: prioSeries, multi: matchColors(multiSnapshotT(records, grid, time, (r) => itsmPriorityMeta(r.priority).short), prioSeries), table: seriesTable(prioSeries, ["Priority", "Records"]), filterable: true },
    { id: "i-open", title: "Open vs Closed", viz: ["stat", "bar", "table"], series: openClosed, multi: [], table: seriesTable(openClosed, ["State", "Records"]), stat: { value: String(openN), sub: `open · ${records.length} total` }, filterable: true },
    { id: "i-state", title: "Records by State", viz: ["bar", "line", "table"], series: stateSeries, multi: matchColors(multiSnapshotT(records, grid, time, (r, t) => itsmStateAt(r, t)), stateSeries), table: seriesTable(stateSeries, ["State", "Records"]), filterable: true },
    { id: "i-assignee", title: "Records by Assignee", viz: ["bar", "line", "table"], series: assigneeSeries, multi: matchColors(multiSnapshotT(records, grid, time, (r) => r.assignee || "Unassigned"), assigneeSeries), table: seriesTable(assigneeSeries, ["Assignee", "Records"]), filterable: true },
    { id: "i-created", title: "Records Created", viz: ["line", "bar", "table"], series: singleColored(createdPts), multi: [{ name: "Created", points: createdPts, color: colorAt(0) }], table: { columns: ["Period", "Records"], rows: createdPts.map((s) => [s.label, s.value]) }, filterable: false },
    { id: "i-recent", title: "Recent Records", viz: ["table", "line", "bar"], series: singleColored(createdPts), multi: [{ name: "Created", points: createdPts, color: colorAt(0) }], table: recentTable, filterable: false },
  ];
}

// ── timesheet scope ─────────────────────────────────────────────────────────────
// The timesheet dashboard aggregates HOURS (not counts) from the same activity items the
// Timesheet page shows — manual entries, board-card worklog, calendar events, Service Desk
// working time — for one board or (id "*") every board the wallet belongs to. Callers pass
// pre-collected ActivityItem[] (via timesheet.ts) so this module stays free of that heavy
// aggregation. Each item's timestamp is its day (+ its start-time when a timed block).

const TS_SOURCE_LABEL: Record<SourceKey, string> = {
  manual: "Manual", worklog: "Board tickets", calendar: "Calendar", servicedesk: "Service Desk", normal: "Normal", holiday: "Holiday / Vacation",
};
const r2 = (n: number): number => Math.round(n * 100) / 100;
const itemTime = (it: ActivityItem): number => new Date(`${it.date}T00:00:00`).getTime() + (it.startMin ?? 0) * 60_000;

// Decimal hours → a "HH:MM" duration (2.5 → "02:30", 0.017 → "00:01"), rounded to the minute.
// Used everywhere hours appear — tables, the stat, and chart axes/labels/tooltips — so the whole
// dashboard reads time the same way. HH can exceed 24 for long totals (e.g. "126:00").
export function fmtHHMM(hours: number): string {
  const totalMin = Math.round(hours * 60);
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
// Minutes-from-midnight → "HH:MM" clock (a timed block's start/end); "—" when untimed.
const clockHM = (min?: number): string => (min == null ? "—" : `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`);

// Spread ONE item's hours across the time buckets it actually spans, so the LINE reflects real
// time-spent-per-period instead of a spike at the start. A timed session (start→end within a day)
// contributes its OVERLAP with each bucket: e.g. a 24h day by hour → 1h in each of 24 buckets
// (a flat line); a 09:30–11:30 session by hour → 30m + 1h + 30m. An untimed entry (no from/to)
// has no span, so all its hours land in its date's single bucket.
function itemBucketHours(it: ActivityItem, g: Gran): { label: string; hours: number }[] {
  const dayMs = new Date(`${it.date}T00:00:00`).getTime();
  if (it.startMin == null || it.endMin == null || it.endMin <= it.startMin) {
    return [{ label: bucket(dayMs + (it.startMin ?? 0) * 60_000, g), hours: it.hours }];
  }
  const startMs = dayMs + it.startMin * 60_000;
  const endMs = dayMs + it.endMin * 60_000;
  const out: { label: string; hours: number }[] = [];
  if (g === "month") {
    let cur = startMs;
    while (cur < endMs && out.length < 1000) {
      const d = new Date(cur);
      const monthEnd = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
      const segEnd = Math.min(endMs, monthEnd);
      out.push({ label: bucket(cur, g), hours: (segEnd - cur) / 3_600_000 });
      cur = segEnd;
    }
    return out;
  }
  const step = g === "minute" ? 60_000 : g === "hour" ? 3_600_000 : 86_400_000;
  let cur = startMs;
  while (cur < endMs && out.length < 2000) {
    const segEnd = Math.min(endMs, Math.floor(cur / step) * step + step);
    out.push({ label: bucket(cur, g), hours: (segEnd - cur) / 3_600_000 });
    cur = segEnd;
  }
  return out;
}
// Sum HOURS per time bucket (the hours analogue of bucketCountsT) — hours are spread across the
// buckets each session spans (see itemBucketHours) so the line shows time-spent-per-period.
function hoursByBucket(items: ActivityItem[], buckets: string[], g: Gran): Series[] {
  const m = new Map<string, number>();
  for (const it of items) for (const c of itemBucketHours(it, g)) m.set(c.label, (m.get(c.label) ?? 0) + c.hours);
  return buckets.map((b) => ({ label: b, value: r2(m.get(b) ?? 0) }));
}
// Sum HOURS by a category (source / person / board) — snapshot TOTAL per category (not spread),
// sorted busiest-first. Used by bars/tables/filter, which show totals.
function hoursByCat(items: ActivityItem[], cat: (it: ActivityItem) => string): Series[] {
  const m = new Map<string, number>();
  for (const it of items) { const c = cat(it); m.set(c, (m.get(c) ?? 0) + it.hours); }
  return [...m.entries()].map(([label, value]) => ({ label, value: r2(value) })).sort((a, b) => b.value - a.value);
}
// One line per category, spreading each session's HOURS across the buckets it spans (0 where absent).
function multiHoursByCat(items: ActivityItem[], buckets: string[], cat: (it: ActivityItem) => string, g: Gran): MultiSeries[] {
  const byCat = new Map<string, Map<string, number>>();
  for (const it of items) {
    const c = cat(it);
    let mm = byCat.get(c); if (!mm) { mm = new Map(); byCat.set(c, mm); }
    for (const contrib of itemBucketHours(it, g)) mm.set(contrib.label, (mm.get(contrib.label) ?? 0) + contrib.hours);
  }
  return [...byCat.entries()]
    .map(([name, mm]) => ({ name, total: [...mm.values()].reduce((a, c) => a + c, 0), points: buckets.map((b) => ({ label: b, value: r2(mm.get(b) ?? 0) })) }))
    .sort((a, b) => b.total - a.total)
    .map(({ name, points }) => ({ name, points }));
}

/** Widgets for the Timesheet scope (one board, or every board when aggregated). */
export function computeTimesheetWidgets(items: ActivityItem[], rangeMsArg = 0, granularity: Granularity = "auto", windowStart?: number, windowEnd?: number): WidgetData[] {
  const g: Gran = granularity === "auto" ? granularityFor(rangeMsArg) : granularity;
  const wEnd = windowEnd ?? Date.now();
  const wStart = windowStart ?? (items.length ? Math.min(...items.map(itemTime)) : wEnd);
  const win = bucketRange(wStart, wEnd, g);

  const total = items.reduce((s, it) => s + it.hours, 0);
  const hoursPts = hoursByBucket(items, win, g);
  const sourceSeries = colored(hoursByCat(items, (it) => TS_SOURCE_LABEL[it.source]));
  const personSeries = colored(hoursByCat(items, (it) => it.whoLabel || "You"));
  const boardSeries = colored(hoursByCat(items, (it) => it.boardTitle));
  const recent = [...items].sort((a, b) => itemTime(b) - itemTime(a));
  // Each row is one work session: Start / End clock times (HH:MM), the Duration between them as
  // HH:MM (the actual time spent), the Source TYPE (matching "Hours by Source") next to the Item,
  // and the Item NAME carrying its reference (ticket key / record number) when it has one.
  const itemName = (it: ActivityItem): string => (it.sub && it.sub !== it.title ? `${it.title} · ${it.sub}` : it.title);
  // Date first; the person filter targets the "Who" column via filterCol, so filtering a person
  // still hides their rows here in step with hiding their line/bar (the filter affects the whole
  // widget — line, bar and this detailed table).
  const recentTable: TableData = {
    columns: ["Date", "Who", "Board", "Start", "End", "Duration", "Source", "Item"],
    rows: recent.slice(0, 300).map((it) => [it.date, it.whoLabel || "You", it.boardTitle, clockHM(it.startMin), clockHM(it.endMin), fmtHHMM(it.hours), TS_SOURCE_LABEL[it.source], itemName(it)]),
    filterCol: 1,
  };
  // Category tables show the summed time as HH:MM; the CHART series stay numeric (decimal hours)
  // so the bars/lines still scale — the "hours" valueUnit tells the card to render those numbers
  // as HH:MM durations on the axis/labels/tooltips.
  const durTable = (series: Series[], head: string): TableData => ({ columns: [head, "Time"], rows: series.map((s) => [s.label, fmtHHMM(s.value)]) });

  return [
    { id: "ts-hours", title: "Hours Logged", viz: ["line", "bar", "table"], series: singleColored(hoursPts), multi: [{ name: "Hours", points: hoursPts, color: colorAt(0) }], table: { columns: ["Period", "Time"], rows: hoursPts.map((s) => [s.label, fmtHHMM(s.value)]) }, filterable: false, valueUnit: "hours" },
    { id: "ts-source", title: "Hours by Source", viz: ["bar", "line", "table"], series: sourceSeries, multi: matchColors(multiHoursByCat(items, win, (it) => TS_SOURCE_LABEL[it.source], g), sourceSeries), table: durTable(sourceSeries, "Source"), filterable: true, valueUnit: "hours" },
    { id: "ts-person", title: "Hours by Person", viz: ["bar", "line", "table"], series: personSeries, multi: matchColors(multiHoursByCat(items, win, (it) => it.whoLabel || "You", g), personSeries), table: durTable(personSeries, "Person"), filterable: true, valueUnit: "hours" },
    { id: "ts-board", title: "Hours by Board", viz: ["bar", "line", "table"], series: boardSeries, multi: matchColors(multiHoursByCat(items, win, (it) => it.boardTitle, g), boardSeries), table: durTable(boardSeries, "Board"), filterable: true, valueUnit: "hours" },
    { id: "ts-total", title: "Total Hours", viz: ["stat", "bar", "table"], series: sourceSeries, multi: [], table: durTable(sourceSeries, "Source"), stat: { value: fmtHHMM(total), sub: `${items.length} entr${items.length !== 1 ? "ies" : "y"}` }, filterable: false, valueUnit: "hours" },
    { id: "ts-recent", title: "Recent Activity", viz: ["table", "line", "bar"], series: personSeries, multi: matchColors(multiHoursByCat(items, win, (it) => it.whoLabel || "You", g), personSeries), table: recentTable, filterable: true, valueUnit: "hours" },
  ];
}

// Remember the selected scope per wallet, so the dashboard reopens where you left it.
const scopeStoreKey = (addr: string) => `gtv_dashboard_scope_${addr}`;
export function loadScope(addr: string | null): Scope {
  if (!addr || typeof window === "undefined") return { kind: "documents" };
  try { const raw = localStorage.getItem(scopeStoreKey(addr)); if (raw) return JSON.parse(raw) as Scope; } catch {}
  return { kind: "documents" };
}
export function saveScope(addr: string | null, scope: Scope): void {
  if (!addr || typeof window === "undefined") return;
  try { localStorage.setItem(scopeStoreKey(addr), JSON.stringify(scope)); } catch {}
}

// ── persistence: grid layout (react-grid-layout) + per-widget view config ──────

export interface WidgetConfig {
  viz: Viz;
  hidden: string[]; // series labels filtered out of the chart/export
}
export interface GridItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export type GridLayouts = Record<string, GridItem[]>;

// Widget ids / default grid / default view — one set per scope kind.
export const WIDGET_IDS = ["recent-tx", "ar-spent", "by-ext", "owned-shared", "by-tag", "tag-count"];
const BOARD_WIDGET_IDS = ["b-status", "b-priority", "b-assignee", "b-open", "b-created", "b-label", "b-recent"];
const ITSM_WIDGET_IDS = ["i-type", "i-priority", "i-open", "i-state", "i-assignee", "i-created", "i-recent"];
const TS_WIDGET_IDS = ["ts-hours", "ts-source", "ts-person", "ts-board", "ts-total", "ts-recent"];

const DEFAULT_VIZ: Record<string, Viz> = {
  "recent-tx": "table", "ar-spent": "stat", "by-ext": "bar", "owned-shared": "bar", "by-tag": "bar", "tag-count": "stat",
};
const BOARD_VIZ: Record<string, Viz> = {
  "b-status": "bar", "b-priority": "bar", "b-assignee": "bar", "b-open": "stat", "b-created": "line", "b-label": "bar", "b-recent": "table",
};
const ITSM_VIZ: Record<string, Viz> = {
  "i-type": "bar", "i-priority": "bar", "i-open": "stat", "i-state": "bar", "i-assignee": "bar", "i-created": "line", "i-recent": "table",
};
const TS_VIZ: Record<string, Viz> = {
  "ts-hours": "line", "ts-source": "bar", "ts-person": "bar", "ts-board": "bar", "ts-total": "stat", "ts-recent": "table",
};

// 12-column grid, rowHeight ~44px.
export const DEFAULT_GRID: GridItem[] = [
  { i: "recent-tx", x: 0, y: 0, w: 7, h: 7 },
  { i: "ar-spent", x: 7, y: 0, w: 5, h: 3 },
  { i: "by-ext", x: 7, y: 3, w: 5, h: 4 },
  { i: "owned-shared", x: 0, y: 7, w: 4, h: 4 },
  { i: "by-tag", x: 4, y: 7, w: 5, h: 4 },
  { i: "tag-count", x: 9, y: 7, w: 3, h: 4 },
];
const BOARD_GRID: GridItem[] = [
  { i: "b-status", x: 0, y: 0, w: 5, h: 4 },
  { i: "b-priority", x: 5, y: 0, w: 4, h: 4 },
  { i: "b-open", x: 9, y: 0, w: 3, h: 4 },
  { i: "b-created", x: 0, y: 4, w: 7, h: 4 },
  { i: "b-assignee", x: 7, y: 4, w: 5, h: 4 },
  { i: "b-label", x: 0, y: 8, w: 5, h: 4 },
  { i: "b-recent", x: 5, y: 8, w: 7, h: 5 },
];
const ITSM_GRID: GridItem[] = [
  { i: "i-recent", x: 0, y: 0, w: 12, h: 5 }, // first row — full-width all-columns table
  { i: "i-type", x: 0, y: 5, w: 4, h: 4 },
  { i: "i-priority", x: 4, y: 5, w: 4, h: 4 },
  { i: "i-open", x: 8, y: 5, w: 4, h: 4 },
  { i: "i-state", x: 0, y: 9, w: 4, h: 4 }, // state · assignee · created share one row
  { i: "i-assignee", x: 4, y: 9, w: 4, h: 4 },
  { i: "i-created", x: 8, y: 9, w: 4, h: 4 },
];
const TS_GRID: GridItem[] = [
  { i: "ts-hours", x: 0, y: 0, w: 7, h: 4 },
  { i: "ts-total", x: 7, y: 0, w: 5, h: 4 },
  { i: "ts-source", x: 0, y: 4, w: 4, h: 4 }, // source · person · board share one row
  { i: "ts-person", x: 4, y: 4, w: 4, h: 4 },
  { i: "ts-board", x: 8, y: 4, w: 4, h: 4 },
  { i: "ts-recent", x: 0, y: 8, w: 12, h: 5 }, // full-width detail table
];

const KIND_IDS: Record<ScopeKind, string[]> = { documents: WIDGET_IDS, board: BOARD_WIDGET_IDS, itsm: ITSM_WIDGET_IDS, timesheet: TS_WIDGET_IDS };
const KIND_GRID: Record<ScopeKind, GridItem[]> = { documents: DEFAULT_GRID, board: BOARD_GRID, itsm: ITSM_GRID, timesheet: TS_GRID };
const KIND_VIZ: Record<ScopeKind, Record<string, Viz>> = { documents: DEFAULT_VIZ, board: BOARD_VIZ, itsm: ITSM_VIZ, timesheet: TS_VIZ };

export function defaultGridFor(kind: ScopeKind): GridItem[] { return KIND_GRID[kind]; }
export function defaultConfigs(kind: ScopeKind = "documents"): Record<string, WidgetConfig> {
  const c: Record<string, WidgetConfig> = {};
  for (const id of KIND_IDS[kind]) c[id] = { viz: KIND_VIZ[kind][id], hidden: [] };
  return c;
}

// `documents` keeps the legacy (un-suffixed) key for back-compat; other scopes are suffixed.
const layoutKey = (addr: string, scope: Scope) => `gtv_dashboard_layout_${addr}${scope.kind === "documents" ? "" : "_" + scopeKey(scope)}`;
const configKey = (addr: string, scope: Scope) => `gtv_dashboard_config_${addr}${scope.kind === "documents" ? "" : "_" + scopeKey(scope)}`;

export function loadLayouts(addr: string | null, scope: Scope = { kind: "documents" }): GridLayouts {
  const grid = KIND_GRID[scope.kind];
  const ids = KIND_IDS[scope.kind];
  if (!addr || typeof window === "undefined") return { lg: grid };
  try {
    const raw = localStorage.getItem(layoutKey(addr, scope));
    const saved = raw ? (JSON.parse(raw) as GridLayouts) : null;
    if (saved && saved.lg?.length) {
      // Keep only this scope's widgets and ensure each has a layout item (a missing
      // item makes react-grid-layout drop/mis-place that card). Also REPAIR degenerate
      // (1×1) items: react-grid-layout falls back to 1×1 when a child and its layout
      // briefly mismatch (remount/hydration), and an earlier bug let those get saved —
      // so any too-small item is restored to its default geometry.
      for (const bp of Object.keys(saved)) {
        const items = saved[bp]
          .filter((i) => ids.includes(i.i))
          .map((i) => (i.w >= 2 && i.h >= 2 ? i : grid.find((g) => g.i === i.i) ?? i));
        let y = items.reduce((m, i) => Math.max(m, i.y + i.h), 0);
        for (const id of ids) {
          if (!items.some((i) => i.i === id)) {
            const d = grid.find((g) => g.i === id)!;
            items.push({ ...d, x: 0, y });
            y += d.h;
          }
        }
        saved[bp] = items;
      }
      return saved;
    }
  } catch {}
  return { lg: grid };
}
export function saveLayouts(addr: string | null, scope: Scope, layouts: GridLayouts): void {
  if (!addr || typeof window === "undefined") return;
  try { localStorage.setItem(layoutKey(addr, scope), JSON.stringify(layouts)); } catch {}
}

export function loadConfigs(addr: string | null, scope: Scope = { kind: "documents" }): Record<string, WidgetConfig> {
  const base = defaultConfigs(scope.kind);
  if (!addr || typeof window === "undefined") return base;
  try {
    const raw = localStorage.getItem(configKey(addr, scope));
    const saved = raw ? (JSON.parse(raw) as Record<string, Partial<WidgetConfig>>) : {};
    for (const id of KIND_IDS[scope.kind]) {
      const s = saved[id];
      base[id] = { viz: s?.viz ?? base[id].viz, hidden: Array.isArray(s?.hidden) ? s!.hidden! : base[id].hidden };
    }
  } catch {}
  return base;
}
export function saveConfigs(addr: string | null, scope: Scope, configs: Record<string, WidgetConfig>): void {
  if (!addr || typeof window === "undefined") return;
  try { localStorage.setItem(configKey(addr, scope), JSON.stringify(configs)); } catch {}
}

// ── global time-range filter (applies to every widget) ─────────────────────────

export interface TimeRange {
  preset: string; // one of RANGE_OPTIONS keys, or "custom"
  customStart?: number; // ms timestamp (inclusive) when preset === "custom"
  customEnd?: number; // ms timestamp (inclusive) when preset === "custom"
}

// No "All time" preset: an unbounded window at a fine granularity (e.g. minute over weeks) renders
// tens of thousands of line points and lags. The default is Last 1 day; for a wider view the user
// picks a Custom period (which they can keep as tight or as wide as they need).
export const RANGE_OPTIONS: { key: string; label: string; ms: number }[] = [
  { key: "5m", label: "Last 5 min", ms: 5 * 60_000 },
  { key: "15m", label: "Last 15 min", ms: 15 * 60_000 },
  { key: "30m", label: "Last 30 min", ms: 30 * 60_000 },
  { key: "1h", label: "Last 1 hour", ms: 60 * 60_000 },
  { key: "3h", label: "Last 3 hours", ms: 3 * 60 * 60_000 },
  { key: "6h", label: "Last 6 hours", ms: 6 * 60 * 60_000 },
  { key: "1d", label: "Last 1 day", ms: 24 * 60 * 60_000 },
  { key: "3d", label: "Last 3 days", ms: 3 * 24 * 60 * 60_000 },
  { key: "1w", label: "Last 1 week", ms: 7 * 24 * 60 * 60_000 },
];
export const DEFAULT_RANGE: TimeRange = { preset: "1d" };

/** Span of a range in ms (0 = all time / unbounded). Used to pick granularity. */
export function rangeMs(range: TimeRange): number {
  if (range.preset === "custom") return Math.max(0, (range.customEnd ?? 0) - (range.customStart ?? 0));
  return RANGE_OPTIONS.find((o) => o.key === range.preset)?.ms ?? 0;
}

/** The actual [start, end] window the range covers, relative to `now`. */
export function rangeWindow(range: TimeRange, now: number): { start: number; end: number } {
  if (range.preset === "custom") return { start: range.customStart ?? 0, end: range.customEnd ?? now };
  const ms = rangeMs(range);
  return ms > 0 ? { start: now - ms, end: now } : { start: 0, end: now };
}

export function rangeLabel(range: TimeRange): string {
  if (range.preset === "custom") {
    const s = range.customStart ? fmtDateTime(range.customStart) : "…";
    const e = range.customEnd ? fmtDateTime(range.customEnd) : "…";
    return `${s} → ${e}`;
  }
  return RANGE_OPTIONS.find((o) => o.key === range.preset)?.label ?? "All time";
}

const rangeKey = (addr: string) => `gtv_dashboard_range_${addr}`;

export function loadRange(addr: string | null): TimeRange {
  if (!addr || typeof window === "undefined") return DEFAULT_RANGE;
  try {
    const raw = localStorage.getItem(rangeKey(addr));
    if (raw) {
      const r = JSON.parse(raw) as TimeRange;
      // Migrate a saved range whose preset no longer exists (e.g. the removed "all time") to the
      // default, so the dashboard doesn't fall back to an unbounded, laggy window.
      if (r.preset !== "custom" && !RANGE_OPTIONS.some((o) => o.key === r.preset)) return DEFAULT_RANGE;
      return r;
    }
  } catch {}
  return DEFAULT_RANGE;
}
export function saveRange(addr: string | null, range: TimeRange): void {
  if (!addr || typeof window === "undefined") return;
  try { localStorage.setItem(rangeKey(addr), JSON.stringify(range)); } catch {}
}

// ── time-bucket granularity (the metric for the X axis) ────────────────────────

export const GRAN_OPTIONS: { key: Granularity; label: string; short: string }[] = [
  { key: "auto", label: "Auto", short: "Auto" },
  { key: "minute", label: "By minute", short: "Min" },
  { key: "hour", label: "By hour", short: "Hour" },
  { key: "day", label: "By day", short: "Day" },
  { key: "month", label: "By month", short: "Month" },
];

const granKey = (addr: string) => `gtv_dashboard_gran_${addr}`;

export function loadGranularity(addr: string | null): Granularity {
  if (!addr || typeof window === "undefined") return "auto";
  try {
    const raw = localStorage.getItem(granKey(addr));
    if (raw) return JSON.parse(raw) as Granularity;
  } catch {}
  return "auto";
}
export function saveGranularity(addr: string | null, gran: Granularity): void {
  if (!addr || typeof window === "undefined") return;
  try { localStorage.setItem(granKey(addr), JSON.stringify(gran)); } catch {}
}
