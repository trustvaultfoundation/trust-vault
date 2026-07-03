"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Responsive, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import type { StoredUpload } from "@/lib/vault";
import {
  computeWidgets,
  computeBoardWidgets,
  computeItsmWidgets,
  computeTimesheetWidgets,
  ALL_ID,
  loadLayouts,
  saveLayouts,
  loadConfigs,
  saveConfigs,
  defaultConfigs,
  defaultGridFor,
  loadScope,
  saveScope,
  loadRange,
  saveRange,
  rangeMs,
  rangeWindow,
  rangeLabel,
  RANGE_OPTIONS,
  loadGranularity,
  saveGranularity,
  GRAN_OPTIONS,
  fmtHHMM,
  CATEGORY_STYLE,
  type Scope,
  type Viz,
  type GridItem,
  type GridLayouts,
  type WidgetConfig,
  type WidgetData,
  type TableData,
  type MultiSeries,
  type TimeRange,
  type Granularity,
} from "@/lib/dashboard";
import { loadBoards, loadBoardState, boardColumns, type BoardState } from "@/lib/board";
import { allItsmRecords } from "@/lib/itsm";
import { timesheetActivity } from "@/lib/timesheet";
import { downloadCsv, downloadXlsx } from "@/lib/dashboardExport";
import { BarChart, LineChart, DataTable, StatView } from "./DashboardCharts";
import { DateInput } from "./DateInput";
import { TimeField } from "./TimeField";

// Single fixed schema (12 cols) for every width so the layout never reflows: the
// column width fluidly fills the screen, while the row height stays FIXED so card
// heights don't change as the window resizes (only the widths do).
const GRID_COLS = 12;
const GRID_MARGIN = 14;
const ROW_HEIGHT = 42;

type Toast = (m: string, t?: "error" | "info" | "warning") => void;

export default function DashboardView({
  uploads,
  shared,
  address,
  onToast,
  refreshing,
  onRefresh,
}: {
  uploads: StoredUpload[];
  shared: StoredUpload[];
  address: string;
  onToast: Toast;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const [scope, setScopeState] = useState<Scope>(() => loadScope(address));
  const [layouts, setLayouts] = useState<GridLayouts>(() => loadLayouts(address, loadScope(address)));
  const [configs, setConfigs] = useState<Record<string, WidgetConfig>>(() => loadConfigs(address, loadScope(address)));
  const [range, setRangeState] = useState<TimeRange>(() => loadRange(address));
  const [gran, setGranState] = useState<Granularity>(() => loadGranularity(address));
  const [menu, setMenu] = useState<{ id: string; kind: "filter" | "export" } | null>(null);
  const [tick, setTick] = useState(0);
  // Measure the grid container ourselves (a ResizeObserver) and pass an explicit width to the grid.
  // react-grid-layout's WidthProvider measured the container at 0px on a fresh load (before the
  // flex/scroll layout settled) — rendering every card minuscule AND letting a degenerate
  // 0-width layout get saved. We render the grid only once we have a real width.
  const gridWrapRef = useRef<HTMLDivElement>(null);
  const [gridW, setGridW] = useState(0);
  // Shared hover so a crosshair appears at the same time bucket in every line chart.
  const [hoverBucket, setHoverBucket] = useState<string | null>(null);
  // Live drag-select highlight (times), shown on every line chart at once.
  const [brush, setBrush] = useState<{ start: number; end: number } | null>(null);
  const commitBrush = (b: { start: number; end: number }) => {
    setBrush(null);
    if (b.end - b.start < 1000) return; // ignore tiny click-drags
    setRange({ preset: "custom", customStart: Math.round(b.start), customEnd: Math.round(b.end) });
  };

  // Re-load saved layout/config/range when the wallet changes (per-wallet). Use the wallet's
  // PERSISTED scope — loading without it defaults to the Documents scope and would clobber a
  // Board/Service-Desk layout on every mount, making those scopes always reset their sizes.
  useEffect(() => {
    const s = loadScope(address);
    setScopeState(s);
    setLayouts(loadLayouts(address, s));
    setConfigs(loadConfigs(address, s));
    setRangeState(loadRange(address));
    setGranState(loadGranularity(address));
  }, [address]);

  // Re-evaluate sliding ranges (last 5 min …) periodically so they stay live.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Track the grid container's real width (drives `gridW`, passed to the grid).
  useEffect(() => {
    const el = gridWrapRef.current;
    if (!el) return;
    const measure = () => setGridW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  // Apply the time-range filter, then compute every widget at the chosen bucket
  // granularity. `win` is the actual time window the charts cover — used to map a
  // brush selection (pixels) back to timestamps.
  const { widgets, win } = useMemo(() => {
    const now = Date.now();
    const { start, end } = rangeWindow(range, now);
    const span0 = rangeMs(range);
    const inRange = (t: number) => t >= start && t <= end;
    // For "all time" (start = 0) the window starts at the first item but ENDS AT NOW, so quiet
    // periods read 0 on the line charts instead of the line holding at the last activity.
    const winFor = (times: number[]) => {
      if (start !== 0) return { wStart: start, wEnd: end, span: span0 };
      const ts = times.filter(Boolean);
      if (!ts.length) return { wStart: now, wEnd: now, span: 0 };
      const wStart = Math.min(...ts);
      return { wStart, wEnd: now, span: now - wStart };
    };

    if (scope.kind === "board") {
      // A single board, or (id "*") every board merged into one pseudo-state (union of columns
      // so status ordering / done-detection still work across boards).
      const state = scope.id === ALL_ID ? mergeBoardStates(loadBoards(address).map((b) => loadBoardState(b.id))) : loadBoardState(scope.id ?? "");
      const ft = state.tickets.filter((t) => inRange(t.createdAt || 0));
      const { wStart, wEnd, span } = winFor(ft.map((t) => t.createdAt));
      return { widgets: computeBoardWidgets({ ...state, tickets: ft }, span, gran, wStart, wEnd), win: { start: wStart, end: wEnd } };
    }
    if (scope.kind === "itsm") {
      // A single team's records, or (id "*") every record across all teams.
      const all = allItsmRecords(address);
      const fr = (scope.id === ALL_ID ? all : all.filter((r) => (r.boardId ?? "none") === scope.id)).filter((r) => inRange(r.createdAt || 0));
      const { wStart, wEnd, span } = winFor(fr.map((r) => r.createdAt));
      return { widgets: computeItsmWidgets(fr, span, gran, wStart, wEnd), win: { start: wStart, end: wEnd } };
    }
    if (scope.kind === "timesheet") {
      // One board, or (id "*") every board I belong to. Hours are day-keyed, so the collector
      // works in day resolution over [start, end] (start 0 ⇒ all time).
      const boardIds = scope.id === ALL_ID ? loadBoards(address).map((b) => b.id) : [scope.id ?? ""];
      const items = timesheetActivity(address, boardIds, start, end);
      const times = items.map((it) => new Date(`${it.date}T00:00:00`).getTime());
      const { wStart, wEnd, span } = winFor(times);
      return { widgets: computeTimesheetWidgets(items, span, gran, wStart, wEnd), win: { start: wStart, end: wEnd } };
    }
    const fu = uploads.filter((u) => inRange(u.uploadedAt || 0));
    const fs = shared.filter((u) => inRange(u.uploadedAt || 0));
    const { wStart, wEnd, span } = winFor([...fu, ...fs].map((u) => u.uploadedAt || 0));
    return { widgets: computeWidgets(fu, fs, span, gran, wStart, wEnd), win: { start: wStart, end: wEnd } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, uploads, shared, range, gran, tick, address]);

  // ALWAYS render a layout that exactly matches the current widgets, with valid sizes: take each
  // card's geometry from the saved layout only when it's sane (w,h ≥ 2), otherwise from the scope's
  // default. This makes the grid immune to react-grid-layout's 1×1 fallback — the minuscule-cards
  // bug — no matter what's stale/corrupt/mismatched in the saved layout.
  const gridLayout = useMemo<GridItem[]>(() => {
    const saved = layouts.lg ?? [];
    const defs = defaultGridFor(scope.kind);
    return widgets.map((w, idx) => {
      const s = saved.find((i) => i.i === w.id);
      if (s && s.w >= 2 && s.h >= 2) return s;
      return defs.find((d) => d.i === w.id) ?? { i: w.id, x: 0, y: idx * 4, w: 4, h: 4 };
    });
  }, [widgets, layouts, scope]);

  const setScope = (s: Scope) => {
    setScopeState(s);
    saveScope(address, s);
    setLayouts(loadLayouts(address, s));
    setConfigs(loadConfigs(address, s));
    setMenu(null);
  };

  const onLayoutChange = (_current: Layout[], all: GridLayouts) => {
    setLayouts(all);
    // Don't persist a degenerate layout — react-grid-layout briefly falls back to 1×1 items when a
    // child and its layout mismatch (during a remount/hydration), and saving that would corrupt the
    // stored sizes (the bug that made every card minuscule).
    const lg = all.lg ?? [];
    if (lg.length > 0 && lg.every((i) => i.w >= 2 && i.h >= 2)) saveLayouts(address, scope, all);
  };

  const setRange = (r: TimeRange) => {
    setRangeState(r);
    saveRange(address, r);
  };

  const setGran = (gr: Granularity) => {
    setGranState(gr);
    saveGranularity(address, gr);
  };

  const setViz = (id: string, viz: Viz) =>
    setConfigs((prev) => {
      const next = { ...prev, [id]: { viz, hidden: prev[id]?.hidden ?? [] } };
      saveConfigs(address, scope, next);
      return next;
    });

  const toggleHidden = (id: string, label: string) =>
    setConfigs((prev) => {
      const cur = prev[id]?.hidden ?? [];
      const hidden = cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label];
      const next = { ...prev, [id]: { viz: prev[id]?.viz ?? "bar", hidden } };
      saveConfigs(address, scope, next);
      return next;
    });

  const resetLayout = () => {
    const l = { lg: defaultGridFor(scope.kind) };
    const c = defaultConfigs(scope.kind);
    setLayouts(l);
    setConfigs(c);
    saveLayouts(address, scope, l);
    saveConfigs(address, scope, c);
    onToast("Dashboard layout reset.", "info");
  };

  // The boards I can analyse + the Service-Desk "teams" (distinct boardIds across my records).
  const boards = useMemo(() => loadBoards(address), [address, tick]);
  const itsmTeams = useMemo(() => {
    const ids = [...new Set(allItsmRecords(address).map((r) => r.boardId ?? "none"))];
    return ids
      .map((id) => ({ id, label: id === "none" ? "Private" : (boards.find((b) => b.id === id)?.title ?? "Board") }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [address, boards, tick]);
  // If the saved scope points at a board/team that no longer exists, fall back to Documents.
  // The "*" (all) scopes are always valid, so they're never reset.
  useEffect(() => {
    if (scope.id === ALL_ID) return;
    if (scope.kind === "board" && !boards.some((b) => b.id === scope.id)) setScope({ kind: "documents" });
    else if (scope.kind === "timesheet" && !boards.some((b) => b.id === scope.id)) setScope({ kind: "documents" });
    else if (scope.kind === "itsm" && !itsmTeams.some((t) => t.id === scope.id)) setScope({ kind: "documents" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boards, itsmTeams]);

  return (
    <div className="flex flex-col">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-white shrink-0">Dashboard</h2>
            <ScopeControl scope={scope} boards={boards} teams={itsmTeams} onChange={setScope} />
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Drag a card by its title bar to move it, drag its bottom-right corner to resize. Pick a time range to filter every chart. Changes save automatically.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <GranularityControl gran={gran} onChange={setGran} />
          <TimeRangeControl range={range} onChange={setRange} />
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={refreshing}
              title="Refresh data"
              aria-label="Refresh data"
              className="flex items-center justify-center px-2 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200 disabled:opacity-60 transition-colors shrink-0"
            >
              <svg className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M5.5 14a7 7 0 0011.9 2.5M18.5 10A7 7 0 006.6 7.5" />
              </svg>
            </button>
          )}
          <button
            onClick={resetLayout}
            className="text-xs text-slate-400 border border-slate-700 hover:border-slate-500 hover:text-white px-3 py-1.5 rounded-lg transition-colors shrink-0"
          >
            Reset layout
          </button>
        </div>
      </div>

      <div ref={gridWrapRef} className="overflow-x-hidden">
        {gridW > 0 && (
        <Responsive
          className="layout"
          width={gridW}
          layouts={{ lg: gridLayout }}
          breakpoints={{ lg: 0 }}
          cols={{ lg: GRID_COLS }}
          rowHeight={ROW_HEIGHT}
          margin={[GRID_MARGIN, GRID_MARGIN]}
          containerPadding={[0, 0]}
          draggableHandle=".widget-drag"
          draggableCancel=".widget-no-drag"
          resizeHandles={["se"]}
          onLayoutChange={onLayoutChange}
          isBounded
        >
          {widgets.map((w) => (
            <div key={w.id}>
              <WidgetCard
                w={w}
                config={{ viz: configs[w.id]?.viz ?? w.viz[0], hidden: configs[w.id]?.hidden ?? [] }}
                menu={menu}
                setMenu={setMenu}
                setViz={setViz}
                toggleHidden={toggleHidden}
                onToast={onToast}
                hoverBucket={hoverBucket}
                onHover={setHoverBucket}
                win={win}
                brush={brush}
                onBrush={setBrush}
                onBrushCommit={commitBrush}
              />
            </div>
          ))}
        </Responsive>
        )}
      </div>
    </div>
  );
}

// Merge many boards into one pseudo-state for the "All" scope: all tickets/members
// concatenated, and the UNION of every board's columns (deduped by id, first wins) so the
// board widgets' status ordering and done-detection keep working across boards.
function mergeBoardStates(states: BoardState[]): BoardState {
  const cols: BoardState["columns"] = [];
  const seen = new Set<string>();
  for (const s of states) for (const c of boardColumns(s)) if (!seen.has(c.id)) { seen.add(c.id); cols!.push(c); }
  return { tickets: states.flatMap((s) => s.tickets), members: states.flatMap((s) => s.members), columns: cols, projects: [], seq: 0 };
}

// Pick what the dashboard analyses: the user's Documents, one Board's tickets (or All),
// one Service-Desk team's records (or all), or the Timesheet activity (one board or all). Each
// scope has its own saved layout + widget config.
function ScopeControl({ scope, boards, teams, onChange }: {
  scope: Scope;
  boards: { id: string; title: string }[];
  teams: { id: string; label: string }[];
  onChange: (s: Scope) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  // The trigger shows two parts, consistent across every category: a CATEGORY tag (what kind of
  // data) + the current SELECTION ("All", or the board/team name). This keeps Timesheet looking
  // like the rest (no "Timesheet · …" prefix baked into the label).
  const cat = CATEGORY_STYLE[scope.kind];
  const label = scope.kind === "documents" || scope.id === ALL_ID ? "All"
    : scope.kind === "board" ? (boards.find((b) => b.id === scope.id)?.title ?? "Board")
    : scope.kind === "itsm" ? (teams.find((t) => t.id === scope.id)?.label ?? "Service Desk")
    : (boards.find((b) => b.id === scope.id)?.title ?? "Board");
  const sel = (s: Scope) => { onChange(s); setOpen(false); };
  const itemCls = (active: boolean) => `flex w-full items-center px-3 py-1.5 text-left text-xs ${active ? "bg-indigo-600/20 text-indigo-200" : "text-slate-300 hover:bg-slate-800"}`;
  // A group header carries its category's colour dot, so the palette pattern is visible in the menu too.
  const groupHead = (kind: keyof typeof CATEGORY_STYLE, cls = "pt-2") => (
    <p className={`flex items-center gap-1.5 px-3 pb-1 ${cls} text-[10px] font-semibold uppercase tracking-wide text-slate-500`}>
      <span className={`h-1.5 w-1.5 rounded-full ${CATEGORY_STYLE[kind].dot}`} />{CATEGORY_STYLE[kind].label}
    </p>
  );
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} title="Choose what to analyse" className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 py-1 pl-1.5 pr-3 text-xs font-medium text-slate-200 hover:border-slate-500">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cat.chip}`}>{cat.label}</span>
        <span className="max-w-[10rem] truncate">{label}</span>
        <svg className={`h-3.5 w-3.5 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="absolute left-0 z-50 mt-1 max-h-80 w-60 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-2xl">
          {groupHead("documents", "pt-1")}
          <button onClick={() => sel({ kind: "documents" })} className={itemCls(scope.kind === "documents")}>All</button>
          {boards.length > 0 && groupHead("board")}
          {boards.length > 0 && (
            <button onClick={() => sel({ kind: "board", id: ALL_ID })} className={itemCls(scope.kind === "board" && scope.id === ALL_ID)}>All</button>
          )}
          {boards.map((b) => (
            <button key={b.id} onClick={() => sel({ kind: "board", id: b.id })} className={itemCls(scope.kind === "board" && scope.id === b.id)}>
              <span className="truncate">{b.title}</span>
            </button>
          ))}
          {teams.length > 0 && groupHead("itsm")}
          {teams.length > 0 && (
            <button onClick={() => sel({ kind: "itsm", id: ALL_ID })} className={itemCls(scope.kind === "itsm" && scope.id === ALL_ID)}>All</button>
          )}
          {teams.map((t) => (
            <button key={t.id} onClick={() => sel({ kind: "itsm", id: t.id })} className={itemCls(scope.kind === "itsm" && scope.id === t.id)}>
              <span className="truncate">{t.label}</span>
            </button>
          ))}
          {boards.length > 0 && groupHead("timesheet")}
          {boards.length > 0 && (
            <button onClick={() => sel({ kind: "timesheet", id: ALL_ID })} className={itemCls(scope.kind === "timesheet" && scope.id === ALL_ID)}>All</button>
          )}
          {boards.map((b) => (
            <button key={`ts-${b.id}`} onClick={() => sel({ kind: "timesheet", id: b.id })} className={itemCls(scope.kind === "timesheet" && scope.id === b.id)}>
              <span className="truncate">{b.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function WidgetCard({
  w,
  config,
  menu,
  setMenu,
  setViz,
  toggleHidden,
  onToast,
  hoverBucket,
  onHover,
  win,
  brush,
  onBrush,
  onBrushCommit,
}: {
  w: WidgetData;
  config: WidgetConfig;
  menu: { id: string; kind: "filter" | "export" } | null;
  setMenu: (m: { id: string; kind: "filter" | "export" } | null) => void;
  setViz: (id: string, viz: Viz) => void;
  toggleHidden: (id: string, label: string) => void;
  onToast: Toast;
  hoverBucket: string | null;
  onHover: (bucket: string | null) => void;
  win: { start: number; end: number };
  brush: { start: number; end: number } | null;
  onBrush: (b: { start: number; end: number } | null) => void;
  onBrushCommit: (b: { start: number; end: number }) => void;
}) {
  const viz = w.viz.includes(config.viz) ? config.viz : w.viz[0];
  // Hours widgets render their numeric values as durations (2h 30m) on the chart labels/axis.
  const hoursFmt = w.valueUnit === "hours" ? fmtHHMM : undefined;
  const hoursAxisFmt = w.valueUnit === "hours" ? fmtHHMM : undefined;
  const series = w.series.filter((s) => !config.hidden.includes(s.label));
  // Line view: drop hidden category lines AND hidden time buckets (points).
  // Keep m.color so each line matches its bar.
  const multi: MultiSeries[] = w.multi
    .filter((m) => !config.hidden.includes(m.name))
    .map((m) => ({ name: m.name, color: m.color, points: m.points.filter((p) => !config.hidden.includes(p.label)) }));
  const table: TableData = w.filterable
    ? { ...w.table, rows: w.table.rows.filter((r) => !config.hidden.includes(String(r[w.table.filterCol ?? 0]))) }
    : w.table;

  const exportName = w.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const filterBtnRef = useRef<HTMLButtonElement>(null);
  const exportBtnRef = useRef<HTMLButtonElement>(null);
  const filterOpen = menu?.id === w.id && menu.kind === "filter";
  const exportOpen = menu?.id === w.id && menu.kind === "export";

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">
      {/* header IS the drag handle; controls opt out via .widget-no-drag */}
      <div className="widget-drag flex cursor-move items-center gap-1.5 border-b border-slate-800 px-3 py-2 shrink-0">
        <svg className="w-3.5 h-3.5 shrink-0 text-slate-600" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" /></svg>
        <h3 className="flex-1 min-w-0 truncate text-xs font-semibold text-slate-200" title={w.title}>{w.title}</h3>

        <div className="widget-no-drag flex items-center gap-1.5" onClick={stop} onMouseDown={stop}>
          {/* viz toggle */}
          <div className="flex items-center rounded-md border border-slate-700 bg-slate-800/60 p-0.5">
            {w.viz.map((v) => (
              <Tip key={v} label={VIZ_LABEL[v]}>
                <button onClick={() => setViz(w.id, v)} aria-label={VIZ_LABEL[v]} className={`rounded p-1 transition-colors ${viz === v ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-200"}`}>
                  <VizIcon kind={v} />
                </button>
              </Tip>
            ))}
          </div>

          {/* filter */}
          {w.filterable && (
            <div className="flex items-center">
              <Tip label="Filter categories">
                <button ref={filterBtnRef} onClick={() => setMenu(filterOpen ? null : { id: w.id, kind: "filter" })} aria-label="Filter categories" className={`rounded p-1 transition-colors ${config.hidden.length > 0 ? "text-indigo-400" : "text-slate-500 hover:text-slate-200"}`}>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M3 5h18M6 12h12M10 19h4" /></svg>
                </button>
              </Tip>
              {filterOpen && (
                <Popover anchor={filterBtnRef.current} onClose={() => setMenu(null)}>
                  <div className="w-48">
                    {w.series.length === 0 && <p className="px-3 py-2 text-[11px] text-slate-600">Nothing to filter.</p>}
                    {w.series.map((s) => (
                      <label key={s.label} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs hover:bg-slate-800">
                        <input type="checkbox" checked={!config.hidden.includes(s.label)} onChange={() => toggleHidden(w.id, s.label)} className="accent-indigo-500" />
                        <span className="flex-1 truncate text-slate-300">{s.label}</span>
                        <span className="text-[10px] tabular-nums text-slate-600">{s.value}</span>
                      </label>
                    ))}
                  </div>
                </Popover>
              )}
            </div>
          )}

          {/* export */}
          <div className="flex items-center">
            <Tip label="Export">
              <button ref={exportBtnRef} onClick={() => setMenu(exportOpen ? null : { id: w.id, kind: "export" })} aria-label="Export data" className="rounded p-1 text-slate-500 transition-colors hover:text-slate-200">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></svg>
              </button>
            </Tip>
            {exportOpen && (
              <Popover anchor={exportBtnRef.current} onClose={() => setMenu(null)}>
                <div className="w-32">
                  <button onClick={() => { downloadCsv(exportName, table); setMenu(null); onToast("Exported CSV.", "info"); }} className="block w-full px-3 py-1.5 text-left text-xs text-slate-300 hover:bg-slate-800 hover:text-white">Export CSV</button>
                  <button onClick={async () => { setMenu(null); try { await downloadXlsx(exportName, table); onToast("Exported Excel.", "info"); } catch { onToast("Could not export Excel."); } }} className="block w-full px-3 py-1.5 text-left text-xs text-slate-300 hover:bg-slate-800 hover:text-white">Export Excel</button>
                </div>
              </Popover>
            )}
          </div>
        </div>
      </div>

      {/* body */}
      <div className="flex flex-1 min-h-0 flex-col p-3">
        {viz === "stat" && w.stat ? (
          <StatView value={w.stat.value} sub={w.stat.sub} />
        ) : viz === "table" ? (
          <DataTable table={table} />
        ) : viz === "line" ? (
          <LineChart multi={multi} hoverBucket={hoverBucket} onHover={onHover} win={win} brush={brush} onBrush={onBrush} onBrushCommit={onBrushCommit} valueFmt={hoursFmt} axisFmt={hoursAxisFmt} />
        ) : (
          <BarChart series={series} valueFmt={hoursFmt} axisFmt={hoursAxisFmt} />
        )}
      </div>
    </div>
  );
}

// The dashboard shows times in UTC (X axis + tables), so the picker is UTC too —
// otherwise what you pick wouldn't line up with the chart labels.
function toUtcInput(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16); // "YYYY-MM-DDTHH:MM" (UTC)
}
function fromUtcInput(str: string): number {
  return new Date(`${str.slice(0, 16)}:00Z`).getTime();
}

function TimeRangeControl({ range, onChange }: { range: TimeRange; onChange: (r: TimeRange) => void }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(range.preset === "custom");
  const [startStr, setStartStr] = useState(() => toUtcInput(range.customStart ?? Date.now() - 86_400_000));
  const [endStr, setEndStr] = useState(() => toUtcInput(range.customEnd ?? Date.now()));

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest(".time-range-control") && !el.closest("[data-dateinput-pop]")) setOpen(false);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);

  const applyCustom = () => {
    const start = fromUtcInput(startStr);
    const end = fromUtcInput(endStr);
    if (!start || !end || end <= start) return;
    onChange({ preset: "custom", customStart: start, customEnd: end });
    setOpen(false);
  };

  return (
    <div className="time-range-control relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:border-slate-500 transition-colors"
      >
        <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
        {rangeLabel(range)}
        <svg className="w-3 h-3 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-30 w-56 rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-2xl">
          {RANGE_OPTIONS.map((o) => (
            <button
              key={o.key}
              onClick={() => { onChange({ preset: o.key }); setOpen(false); }}
              className={`block w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-slate-800 ${range.preset === o.key ? "text-indigo-400" : "text-slate-300"}`}
            >
              {o.label}
            </button>
          ))}
          <div className="my-1 border-t border-slate-800" />
          <button
            onClick={() => setCustom((c) => !c)}
            className={`block w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-slate-800 ${range.preset === "custom" ? "text-indigo-400" : "text-slate-300"}`}
          >
            Custom period…
          </button>
          {custom && (
            <div className="space-y-2 px-3 py-2">
              <p className="text-[9px] text-slate-600">Times are UTC (matching the charts).</p>
              <div>
                <span className="text-[9px] uppercase tracking-wide text-slate-500">From</span>
                <div className="mt-0.5 flex gap-1">
                  <DateInput
                    value={startStr.slice(0, 10)}
                    max={endStr.slice(0, 10)}
                    onChange={(d) => setStartStr(`${d}T${startStr.slice(11, 16) || "00:00"}`)}
                    className="h-8 flex-1 rounded border border-slate-700 bg-slate-800 px-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                  <TimeField
                    value={startStr.slice(11, 16)}
                    onChange={(t) => setStartStr(`${startStr.slice(0, 10)}T${t || "00:00"}`)}
                    className="h-8 w-[5.5rem] rounded border border-slate-700 bg-slate-800 px-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
              <div>
                <span className="text-[9px] uppercase tracking-wide text-slate-500">To</span>
                <div className="mt-0.5 flex gap-1">
                  <DateInput
                    value={endStr.slice(0, 10)}
                    min={startStr.slice(0, 10)}
                    onChange={(d) => setEndStr(`${d}T${endStr.slice(11, 16) || "00:00"}`)}
                    className="h-8 flex-1 rounded border border-slate-700 bg-slate-800 px-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                  <TimeField
                    value={endStr.slice(11, 16)}
                    onChange={(t) => setEndStr(`${endStr.slice(0, 10)}T${t || "00:00"}`)}
                    className="h-8 w-[5.5rem] rounded border border-slate-700 bg-slate-800 px-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
              <button onClick={applyCustom} className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-500 py-1.5 text-xs font-semibold text-white transition-colors">
                Apply range
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GranularityControl({ gran, onChange }: { gran: Granularity; onChange: (g: Granularity) => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".gran-control")) setOpen(false);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);
  const cur = GRAN_OPTIONS.find((o) => o.key === gran) ?? GRAN_OPTIONS[0];
  return (
    <div className="gran-control relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Time bucket for the X axis (per minute / hour / day …)"
        className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:border-slate-500 transition-colors"
      >
        <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M4 20V8M10 20V4M16 20v-8M22 20H2" /></svg>
        {cur.short}
        <svg className="w-3 h-3 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-30 w-40 rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-2xl">
          <p className="px-3 pb-1 pt-0.5 text-[9px] uppercase tracking-wide text-slate-600">Group time by</p>
          {GRAN_OPTIONS.map((o) => (
            <button
              key={o.key}
              onClick={() => { onChange(o.key); setOpen(false); }}
              className={`block w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-slate-800 ${gran === o.key ? "text-indigo-400" : "text-slate-300"}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// A dropdown rendered to <body> (so the card's overflow-hidden can't clip it),
// positioned under its anchor with screen-edge collision: it shifts left if it
// would overflow the right, and flips above if it would overflow the bottom.
function Popover({ anchor, onClose, children }: { anchor: HTMLElement | null; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ position: "fixed", top: -9999, left: -9999, visibility: "hidden" });
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const a = anchor.getBoundingClientRect();
    const m = ref.current.getBoundingClientRect();
    const pad = 8;
    let left = a.right - m.width; // right-aligned to the anchor
    if (left + m.width > window.innerWidth - pad) left = window.innerWidth - m.width - pad;
    if (left < pad) left = pad;
    let top = a.bottom + 4;
    if (top + m.height > window.innerHeight - pad) top = Math.max(pad, a.top - m.height - 4); // flip up
    setStyle({ position: "fixed", top, left, visibility: "visible" });
  }, [anchor]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current && !ref.current.contains(t) && anchor && !anchor.contains(t)) onClose();
    };
    const onScroll = () => onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div
      ref={ref}
      style={style}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className="z-[100] max-h-[60vh] overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-2xl"
    >
      {children}
    </div>,
    document.body,
  );
}

// Same styled tooltip as the collapsed sidebar — shows on hover, below the icon.
// The label is portalled to <body> so the card's overflow-hidden can't clip it.
function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [show, setShow] = useState(false);
  return (
    <span
      ref={wrapRef}
      className="inline-flex"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && <TipLabel anchor={wrapRef.current} label={label} />}
    </span>
  );
}

// The floating label: centred under the icon, clamped to stay on-screen (shifts
// left/right past the viewport edges, flips above if it would overflow the bottom).
function TipLabel({ anchor, label }: { anchor: HTMLElement | null; label: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ position: "fixed", top: -9999, left: -9999, visibility: "hidden" });
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const a = anchor.getBoundingClientRect();
    const m = ref.current.getBoundingClientRect();
    const pad = 8;
    let left = a.left + a.width / 2 - m.width / 2; // centred under the icon
    if (left + m.width > window.innerWidth - pad) left = window.innerWidth - m.width - pad;
    if (left < pad) left = pad;
    let top = a.bottom + 6;
    if (top + m.height > window.innerHeight - pad) top = Math.max(pad, a.top - m.height - 6); // flip up
    setStyle({ position: "fixed", top, left, visibility: "visible" });
  }, [anchor]);
  return createPortal(
    <span ref={ref} style={style} className="pointer-events-none z-[120] whitespace-nowrap rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] text-slate-200 shadow-lg">
      {label}
    </span>,
    document.body,
  );
}

const VIZ_LABEL: Record<Viz, string> = { table: "Table view", bar: "Bar chart", line: "Line chart", stat: "Single stat" };

function VizIcon({ kind }: { kind: Viz }) {
  const p = { className: "w-3.5 h-3.5", fill: "none" as const, viewBox: "0 0 24 24", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (kind) {
    case "table":
      return (<svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M3 14h18M9 4v16" /></svg>);
    case "bar":
      return (<svg {...p}><path d="M5 21V10M12 21V4M19 21v-7" /></svg>);
    case "line":
      return (<svg {...p}><path d="M3 17l5-6 4 3 6-8" /></svg>);
    case "stat":
      return (<svg {...p}><path d="M5 12h14M12 5v14" /></svg>);
  }
}
