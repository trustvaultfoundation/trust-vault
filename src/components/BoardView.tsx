"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BoardState,
  BoardMeta,
  Status,
  Priority,
  Ticket,
  Role,
  Project,
  PRIORITIES,
  Column,
  boardColumns,
  DEFAULT_COLUMNS,
  boardProjects,
  projectColumns,
  canMoveTo,
  visibleColumns,
  columnColor,
  isDoneColumn,
  priorityMeta,
  loadBoards,
  saveBoards,
  loadBoardState,
  saveBoardState,
  createBoard,
  renameBoard,
  deleteBoard,
  loadCurrentBoardId,
  saveCurrentBoardId,
  loadCurrentProjectId,
  saveCurrentProjectId,
  columnRows,
  orderBetween,
  bottomOrder,
  newId,
  boardCode,
  loggedHours,
  fmtDuration,
  canEdit,
  labelColor,
  initials,
  shortAddr,
  dueMeta,
} from "@/lib/board";
import {
  BoardEvent,
  applyEvent,
  loadBoardKey,
  resolveBoardKey,
  discoverSharedBoards,
  foldBoard,
  shareBoard,
  ensureBoardSelfGrant,
  addMember,
  setMemberRole,
  removeMember,
  publishEvents,
  type Pending,
  loadPending,
  savePending,
  appendPending,
  recordBoardEventsLocally,
} from "@/lib/boardSync";
import { StoredUpload, loadStoredUploads } from "@/lib/vault";
import { TicketDrawer } from "./TicketDrawer";
import { MentionText } from "./MentionText";
import { BoardList } from "./BoardList";
import { BoardSettings } from "./BoardSettings";
import { loadDepmSettings, publishProject as publishDepm, snapshotSignature } from "@/lib/depm";
import { ThemedSelect } from "./BoardDropdowns";
import { Loading } from "@/components/Spinner";

type Toast = (m: string, t?: "error" | "info" | "warning") => void;
const EMPTY: BoardState = { tickets: [], members: [], seq: 0 };

export default function BoardView({ address, onToast, openTicket, onTicketOpened, onOpenEvent, onOpenItsm, onOpenTicketCross }: { address: string; onToast: Toast; openTicket?: { boardId: string; ticketId: string } | null; onTicketOpened?: () => void; onOpenEvent?: (eventId: string) => void; onOpenItsm?: (recordId: string) => void; onOpenTicketCross?: (boardId: string, ticketId: string) => void }) {
  const [boards, setBoards] = useState<BoardMeta[]>(() => loadBoards(address));
  const [currentId, setCurrentId] = useState<string | null>(() => {
    const list = loadBoards(address);
    const saved = loadCurrentBoardId(address);
    return (saved && list.some((b) => b.id === saved) ? saved : list[0]?.id) ?? null;
  });
  const [state, setState] = useState<BoardState>(() => (currentId ? loadBoardState(currentId) : EMPTY));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchFocus, setSearchFocus] = useState(false);
  const [searchActive, setSearchActive] = useState(0); // keyboard-highlighted search result
  const searchActiveRef = useRef<HTMLButtonElement>(null);
  const [prioFilter, setPrioFilter] = useState<Priority | "all">("all");
  const [creating, setCreating] = useState<Status | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ status: Status; index: number } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncedBoardId, setSyncedBoardId] = useState<string | null>(null); // a board whose first fold has completed
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectId, setProjectId] = useState<string>(() => loadCurrentProjectId(address, currentId) ?? ""); // current project (column-view) within the board, restored per board
  const dragId = useRef<string | null>(null);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushBid = useRef<string | null>(null);
  const pendingWraps = useRef<Record<string, string>>({});

  const meta = boards.find((b) => b.id === currentId) ?? null;
  const myRole: Role = meta?.role ?? "owner";
  const editable = canEdit(myRole);
  const myLabel = state.members.find((m) => m.address === address)?.label || "You";
  const code = boardCode(meta?.title ?? "");
  // Tags already used on this board, offered as suggestions in the ticket editor.
  const allLabels = useMemo(() => [...new Set(state.tickets.flatMap((t) => t.labels ?? []))].sort((a, b) => a.localeCompare(b)), [state]);

  // ── projects = named column-views within the board ──
  const projects = useMemo(() => boardProjects(state), [state]);
  const curProjectId = projects.some((p) => p.id === projectId) ? projectId : projects[0]?.id ?? "";
  const cols = useMemo(() => projectColumns(state, curProjectId).filter((c) => !c.hidden), [state, curProjectId]);
  // A shared board's real columns are only known once its state has been folded (its
  // columns set). Until then we show a skeleton rather than flashing DEFAULT_COLUMNS —
  // which would briefly render columns the user has since removed. Local boards (and
  // any board with explicit columns cached) are ready immediately.
  const columnsReady = !meta?.shared || state.columns != null || syncedBoardId === currentId;
  // Publish the projects config of the CURRENT board (rides the columns plumbing).
  const onProjects = (next: Project[]) => dispatch({ t: "board.projects", projects: next });
  const setProjectColumns = (id: string, columnIds: string[]) => onProjects(projects.map((p) => (p.id === id ? { ...p, columnIds } : p)));
  // ── project CRUD that works on ANY board (the switcher lives in the board dropdown) ──
  const projectsFor = (boardId: string) => boardProjects(boardId === currentId ? state : loadBoardState(boardId));
  const applyProjects = (boardId: string, next: Project[]) => {
    if (boardId === currentId) { dispatch({ t: "board.projects", projects: next }); return; }
    const st = loadBoardState(boardId);
    saveBoardState(boardId, { ...st, projects: next });
    const m = loadBoards(address).find((b) => b.id === boardId);
    if (m?.shared) { const key = loadBoardKey(boardId); if (key) { const eid = newId(); recordPublished(boardId, { t: "board.projects", projects: next }, eid); publishEvents(boardId, address, key, [{ id: eid, event: { t: "board.projects", projects: next } }]).catch(() => {}); } }
    setBoards(loadBoards(address)); // force a re-render so the flyout reflects the edit
  };
  const onSelectProject = (boardId: string, projId: string) => { if (boardId !== currentId) selectBoard(boardId); setProjectId(projId); saveCurrentProjectId(address, boardId, projId); };
  const onAddProject = (boardId: string, name: string) => { const id = `p_${newId().slice(0, 6)}`; applyProjects(boardId, [...projectsFor(boardId), { id, name: name.trim() || "Project", columnIds: [] }]); if (boardId !== currentId) selectBoard(boardId); setProjectId(id); saveCurrentProjectId(address, boardId, id); };
  const onRenameProject = (boardId: string, projId: string, name: string) => applyProjects(boardId, projectsFor(boardId).map((p) => (p.id === projId ? { ...p, name: name.trim() || p.name } : p)));
  const onDeleteProject = (boardId: string, projId: string) => { const ps = projectsFor(boardId); if (ps.length <= 1) return; const next = ps.filter((p) => p.id !== projId); applyProjects(boardId, next); if (boardId === currentId && projId === curProjectId) { const nid = next[0]?.id ?? ""; setProjectId(nid); saveCurrentProjectId(address, boardId, nid); } };
  // Add a column to a project — creates it in the board pool if new. Both changes go
  // in ONE dispatch so the two events don't clobber each other's state.
  const onAddColumn = (col: Column, projId: string) => {
    const pool = boardColumns(state);
    const events: BoardEvent[] = [];
    if (!pool.some((c) => c.id === col.id)) events.push({ t: "board.columns", columns: [...pool, col] });
    const proj = projects.find((p) => p.id === projId);
    if (proj && !proj.columnIds.includes(col.id)) events.push({ t: "board.projects", projects: projects.map((p) => (p.id === projId ? { ...p, columnIds: [...p.columnIds, col.id] } : p)) });
    if (events.length) dispatch(...events);
  };

  // ── reload the wallet's board list + active board on wallet change ──
  useEffect(() => {
    const list = loadBoards(address);
    setBoards(list);
    const saved = loadCurrentBoardId(address);
    const id = (saved && list.some((b) => b.id === saved) ? saved : list[0]?.id) ?? null;
    setCurrentId(id);
    setState(id ? loadBoardState(id) : EMPTY);
    setSelectedId(null);
  }, [address]);

  // ── discover boards shared WITH me; merge into the list ──
  useEffect(() => {
    let alive = true;
    discoverSharedBoards(address)
      .then((refs) => {
        if (!alive || refs.length === 0) return;
        // Stash every wrapped key so a board can be unlocked even if its key cache
        // was cleared; merge any boards not already in the local index.
        for (const r of refs) pendingWraps.current[r.boardId] = r.wrappedKey;
        const metas = loadBoards(address);
        const have = new Set(metas.map((b) => b.id));
        const add = refs.filter((r) => !have.has(r.boardId));
        if (add.length === 0) return;
        for (const r of add) metas.push({ id: r.boardId, title: "Shared board", owner: r.owner, shared: true, role: r.role, updatedAt: r.at });
        saveBoards(address, metas);
        setBoards(metas);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [address]);

  // ── publish unpublished pending events for a board (debounced batch sign) ──
  const flush = async (bid: string) => {
    if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null; }
    const key = loadBoardKey(bid);
    const toPublish = loadPending(bid).filter((p) => !p.published);
    if (!key || toPublish.length === 0) return;
    try {
      await publishEvents(bid, address, key, toPublish.map((p) => ({ id: p.id, event: p.event })));
      savePending(bid, loadPending(bid).map((p) => (toPublish.some((q) => q.id === p.id) ? { ...p, published: true } : p)));
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Couldn't sync changes to Arweave.", "error");
    }
  };
  const scheduleFlush = (bid: string) => {
    flushBid.current = bid;
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => flush(bid), 1500);
  };
  useEffect(() => () => { if (flushBid.current) flush(flushBid.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── apply events locally (+ persist) and, on a shared board, log them as pending
  // (durable) and schedule a publish. The pending log is what survives a refresh.
  const dispatch = (...events: BoardEvent[]) => {
    const items: Pending[] = events.map((event) => ({ id: newId(), event, published: false }));
    const next = items.reduce((s, it) => applyEvent(s, it.event), state);
    setState(next);
    if (currentId) { saveBoardState(currentId, next); recordBoardEventsLocally(currentId, address, events); }
    if (meta?.shared && currentId) {
      savePending(currentId, appendPending(loadPending(currentId), items));
      scheduleFlush(currentId);
    }
  };
  // Record an already-published event (e.g. a member change) as confirmed-pending
  // so the next fold keeps it until it indexes on-chain.
  const recordPublished = (bid: string, event: BoardEvent, id: string) => {
    savePending(bid, [...loadPending(bid), { id, event, published: true }]);
  };

  // ── sync a shared board from Arweave (fold the encrypted event log) ──
  const sync = async (boardId: string) => {
    const m = loadBoards(address).find((b) => b.id === boardId);
    if (!m?.shared) return;
    // Cached → no prompt; uncached → unwrap ONCE (deduped) and cache. Without this the 30s poll and
    // concurrent syncs each re-unwrapped, piling up wallet decrypt prompts.
    const wrapped = pendingWraps.current[boardId];
    const key = await resolveBoardKey(boardId, wrapped);
    if (!key) {
      if (wrapped) onToast("Couldn't unlock the shared board (wallet declined).", "error");
      return;
    }
    // Heal: if I own this board, make sure my key copy lives on-chain (self-grant) so it's
    // recoverable on any device — not just in this browser. Idempotent + silent.
    if (m.owner === address && key) void ensureBoardSelfGrant(boardId, address, key);
    setSyncing(true);
    try {
      const { title, state: folded0, confirmedIds } = await foldBoard(boardId, m.owner, key);
      // Keep the cached column AND project config if the fold hasn't caught up to a
      // board.columns/board.projects event yet (indexing delay). Otherwise columns
      // flash to the defaults, and — the project bug — projects momentarily go empty,
      // making boardProjects() fall back to "Main over ALL columns" and briefly show
      // columns the user removed from a project. Resolve columns to DEFAULT_COLUMNS as
      // a last resort so the state always has explicit columns afterwards.
      const cached = loadBoardState(boardId);
      const folded: BoardState = { ...folded0, columns: folded0.columns ?? cached.columns ?? DEFAULT_COLUMNS, projects: folded0.projects ?? cached.projects };
      // Reconcile pending: drop events the fold now confirms, re-apply the rest on
      // top so local changes survive until they index. THIS is what stops a refresh
      // (which triggers a sync) from looking like nothing changed.
      const pending = loadPending(boardId).filter((p) => !confirmedIds.includes(p.id));
      savePending(boardId, pending);
      const merged = pending.reduce((s, p) => applyEvent(s, p.event), folded);
      saveBoardState(boardId, merged);
      // A pending rename wins over the (possibly stale) fold title.
      const pt = [...pending].reverse().find((p) => p.event.t === "board.update");
      const pendingTitle = pt && pt.event.t === "board.update" ? pt.event.title : undefined;
      const newTitle = pendingTitle ?? title ?? m.title;
      const myNewRole: Role = merged.members.find((mm) => mm.address === address)?.role ?? (m.owner === address ? "owner" : "viewer");
      if (newTitle !== m.title || myNewRole !== m.role) {
        const metas = loadBoards(address).map((b) => (b.id === boardId ? { ...b, title: newTitle, role: myNewRole } : b));
        saveBoards(address, metas); setBoards(metas);
      }
      if (boardId === currentId) setState(merged);
      // Re-publish anything that never reached Arweave (e.g. lost on a refresh).
      const unpub = pending.filter((p) => !p.published);
      if (unpub.length) {
        publishEvents(boardId, address, key, unpub.map((p) => ({ id: p.id, event: p.event })))
          .then(() => savePending(boardId, loadPending(boardId).map((p) => (unpub.some((q) => q.id === p.id) ? { ...p, published: true } : p))))
          .catch(() => {});
      }
    } catch (e) { onToast(e instanceof Error ? e.message : "Couldn't sync the board.", "error"); }
    finally { setSyncing(false); setSyncedBoardId(boardId); }
  };

  // sync on opening a shared board + auto-poll for others' changes (~30s; Arweave
  // indexing of ~minutes is the real limit, so this is as live as it can get).
  useEffect(() => {
    if (!meta?.shared || !currentId) return;
    sync(currentId);
    const id = setInterval(() => sync(currentId), 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, meta?.shared]);

  // DePM: if this board is public, keep its public snapshot in sync automatically — re-publish a few
  // seconds after the board changes (debounced), so the owner never has to click "update". Publishing
  // is signed by the wallet's DePM key (no popup). We only re-publish when the snapshot CONTENT actually
  // changed — otherwise the 30s sync poll (which makes a fresh state object with identical data) would
  // trigger a needless publish every 30s.
  const depmSig = useRef<Record<string, string>>({});
  useEffect(() => {
    if (!currentId) return;
    const s = loadDepmSettings(currentId);
    if (!s.isPublic) return;
    const bid = currentId;
    const sig = snapshotSignature(bid, state, s);
    if (depmSig.current[bid] === sig) return; // nothing changed → no write
    const id = setTimeout(() => { depmSig.current[bid] = sig; void publishDepm(address, bid, state, s).catch(() => {}); }, 4000);
    return () => clearTimeout(id);
  }, [state, currentId, address]);

  const selectBoard = (id: string) => {
    if (flushBid.current) flush(flushBid.current); // publish the old board's queued edits
    setCurrentId(id);
    saveCurrentBoardId(address, id);
    setProjectId(loadCurrentProjectId(address, id) ?? ""); // keep the project you were last on for this board
    setState(loadBoardState(id));
    setSelectedId(null);
    setCreating(null);
    setSettingsOpen(false);
  };
  const newBoard = (title: string) => { const m = createBoard(address, title); setBoards(loadBoards(address)); selectBoard(m.id); };
  const renameB = (id: string, title: string) => {
    setBoards(renameBoard(address, id, title));
    // For a shared board, publish the new title as a board.update so it sticks
    // (and reaches members). Via the pending log if it's the open board.
    const m = loadBoards(address).find((b) => b.id === id);
    if (!m?.shared) return;
    if (id === currentId) {
      dispatch({ t: "board.update", title });
    } else {
      const key = loadBoardKey(id);
      if (key) { const eid = newId(); recordPublished(id, { t: "board.update", title }, eid); publishEvents(id, address, key, [{ id: eid, event: { t: "board.update", title } }]).catch(() => {}); }
    }
  };
  const removeB = (id: string) => {
    const remaining = deleteBoard(address, id);
    setBoards(remaining);
    if (currentId === id) {
      const next = remaining[0]?.id ?? null;
      if (next) selectBoard(next);
      else { setCurrentId(null); setState(EMPTY); }
    }
  };

  // Open a specific ticket when navigated here from a chat (a clicked ticket key).
  useEffect(() => {
    if (!openTicket) return;
    if (boards.some((b) => b.id === openTicket.boardId)) {
      if (openTicket.boardId !== currentId) selectBoard(openTicket.boardId);
      setSelectedId(openTicket.ticketId);
    } else {
      onToast("That ticket's board isn't on this device.", "warning");
    }
    onTicketOpened?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTicket]);

  // ── ticket actions (build events; gated by role) ──
  const seedTicket = (status: Status): Ticket => {
    const now = Date.now();
    return { id: newId(), num: state.seq + 1, title: "", description: "", status, priority: "medium", assignee: "", labels: [], dueDate: null, startDate: null, estimate: null, spent: null, worklog: [], createdBy: myLabel, comments: [], attachments: [], parentId: null, createdAt: now, updatedAt: now, order: bottomOrder(state, status) };
  };
  const createTicketFrom = (ticket: Ticket) => { if (editable) dispatch({ t: "ticket.create", ticket }); setCreating(null); };
  const onDropColumn = (status: Status) => {
    const id = dragId.current;
    if (id && editable) {
      const moved = state.tickets.find((t) => t.id === id);
      if (moved && !canMoveTo(state, moved.status, status)) {
        // Workflow rule blocks this transition.
        onToast(`Moving to “${boardColumns(state).find((c) => c.id === status)?.label ?? status}” isn't allowed from “${boardColumns(state).find((c) => c.id === moved.status)?.label ?? moved.status}”.`, "warning");
      } else {
        // Sub-tickets glue under their parent (ordered by number), so a dropped card is
        // positioned only among the ROOT tickets, at the snapped drop boundary.
        const rws = columnRows(state, status).filter((r) => matches(r.ticket));
        const dropIdx = drop?.status === status ? drop.index : rws.length;
        const roots = rws.filter((r) => r.depth === 0 && r.ticket.id !== id).map((r) => r.ticket);
        const before = rws.slice(0, dropIdx).filter((r) => r.depth === 0 && r.ticket.id !== id).length;
        dispatch({ t: "ticket.move", ticketId: id, status, order: orderBetween(roots[before - 1]?.order, roots[before]?.order) });
      }
    }
    dragId.current = null; setDraggingId(null); setDrop(null);
  };

  // ── sharing / member management (owner & admin) ──
  const shareCurrent = async () => {
    if (!currentId || !meta || meta.shared) return;
    setBusy(true);
    try {
      const { seed } = await shareBoard(currentId, address, meta.title, state, []);
      const metas = loadBoards(address).map((b) => (b.id === currentId ? { ...b, shared: true } : b));
      saveBoards(address, metas); setBoards(metas);
      const next: BoardState = { ...state, members: [{ address, label: myLabel, role: "owner", addedAt: Date.now() }] };
      setState(next); saveBoardState(currentId, next);
      // Track seeded tickets/members as pending so the first sync doesn't empty the board.
      savePending(currentId, [...loadPending(currentId), ...seed.map((s) => ({ id: s.id, event: s.event, published: true }))]);
      onToast("Board shared. Add members to collaborate.", "info");
    } catch (e) { onToast(e instanceof Error ? e.message : "Couldn't share the board.", "error"); }
    finally { setBusy(false); }
  };
  const withKey = (fn: (key: Uint8Array) => Promise<void>) => async () => {
    if (!currentId) return;
    const key = loadBoardKey(currentId);
    if (!key) { onToast("Open the board first to load its key.", "error"); return; }
    setBusy(true);
    try { await fn(key); await sync(currentId); }
    catch (e) { onToast(e instanceof Error ? e.message : "Action failed.", "error"); }
    finally { setBusy(false); }
  };
  const onAddMember = (token: string, label: string, role: Role) =>
    withKey(async (key) => {
      const r = await addMember(currentId!, address, key, token, label, role);
      if ("error" in r) { onToast(r.error, "error"); return; }
      recordPublished(currentId!, { t: "member.add", member: r.member }, r.eventId); // survive the sync until indexed
      onToast("Member added.", "info");
      await reshareAttachmentsTo(r.address); // give them access to existing attachments
    })();
  const onSetRole = (addr: string, role: Role) =>
    withKey(async (key) => { const eid = await setMemberRole(currentId!, address, key, addr, role); recordPublished(currentId!, { t: "member.role", address: addr, role }, eid); })();
  const onRemoveMember = (addr: string) =>
    withKey(async (key) => { const eid = await removeMember(currentId!, address, key, addr); recordPublished(currentId!, { t: "member.remove", address: addr }, eid); })();

  // Attachments are vault documents; on a shared board they must be granted to
  // members so they can open them (same mechanism as document sharing).
  const toShareable = (u: StoredUpload) => ({ txId: u.txId, rawKeyBase64: u.rawKeyBase64!, ivBase64: u.ivBase64, originalName: u.originalName, originalType: u.originalType, originalSize: u.originalSize ?? 0, documentType: u.documentType, tags: u.tags });
  const shareDocsWithMembers = async (docs: StoredUpload[], to?: string[]) => {
    if (!meta?.shared) return;
    const recipients = to ?? state.members.filter((m) => m.address !== address).map((m) => m.address);
    const shareable = docs.filter((d) => d.rawKeyBase64);
    if (recipients.length === 0 || shareable.length === 0) return;
    try { const { shareDocuments } = await import("@/lib/sharing"); await shareDocuments(shareable.map(toShareable), recipients); }
    catch (e) { onToast(e instanceof Error ? e.message : "Couldn't share an attachment with members.", "error"); }
  };
  const reshareAttachmentsTo = async (addr: string) => {
    const txIds = [...new Set(state.tickets.flatMap((t) => t.attachments.map((a) => a.txId)))];
    if (txIds.length === 0) return;
    const owned = loadStoredUploads(address).filter((u) => txIds.includes(u.txId));
    await shareDocsWithMembers(owned, [addr]);
  };

  // Apply a new column config; tickets in deleted columns move to the first column.
  const onColumns = (columns: Column[]) => {
    const removed = boardColumns(state).filter((c) => !columns.some((n) => n.id === c.id)).map((c) => c.id);
    const firstId = columns[0]?.id;
    const events: BoardEvent[] = [{ t: "board.columns", columns }];
    if (removed.length && firstId) {
      let i = 0;
      for (const tk of state.tickets) if (removed.includes(tk.status)) events.push({ t: "ticket.move", ticketId: tk.id, status: firstId, order: Date.now() + i++ });
    }
    dispatch(...events);
  };

  const qMatch = (t: Ticket, q: string) =>
    t.title.toLowerCase().includes(q) ||
    `${code}-${t.num}`.toLowerCase().includes(q) ||
    t.assignee.toLowerCase().includes(q) ||
    t.labels.some((l) => l.toLowerCase().includes(q)) ||
    t.description.toLowerCase().includes(q);
  const matches = (t: Ticket) => {
    if (prioFilter !== "all" && t.priority !== prioFilter) return false;
    const q = query.trim().toLowerCase();
    return !q || qMatch(t, q);
  };
  // Search results across ALL tickets — INCLUDING ones in hidden columns — so the
  // dropdown can reach and open a ticket the board itself won't render.
  const searchQ = query.trim().toLowerCase();
  const searchResults = searchQ ? state.tickets.filter((t) => qMatch(t, searchQ)).slice(0, 25) : [];
  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { setSearchFocus(false); (e.target as HTMLInputElement).blur(); return; }
    if (!searchResults.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setSearchActive((a) => Math.min(searchResults.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSearchActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); const t = searchResults[searchActive]; if (t) { setSelectedId(t.id); setSearchFocus(false); } }
  };
  useEffect(() => { setSearchActive(0); }, [searchQ]);
  useEffect(() => { searchActiveRef.current?.scrollIntoView({ block: "nearest" }); }, [searchActive]);
  const colOf = (status: Status) => boardColumns(state).find((c) => c.id === status);

  const total = state.tickets.length;
  const shown = useMemo(() => state.tickets.filter(matches).length, [state, query, prioFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  const selected = selectedId ? state.tickets.find((t) => t.id === selectedId) ?? null : null;

  return (
    <div className="flex h-[calc(100vh-9rem)] flex-col">
      {/* header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-lg font-semibold text-white shrink-0">Board</h2>
            <BoardList boards={boards} currentId={currentId} myAddress={address} editable={editable} currentProjectId={curProjectId} getProjects={projectsFor} onSelect={selectBoard} onCreate={newBoard} onRename={renameB} onDelete={removeB} onSelectProject={onSelectProject} onAddProject={onAddProject} onRenameProject={onRenameProject} onDeleteProject={onDeleteProject} />
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {meta?.shared
              ? `Shared board · your role: ${myRole}. Changes sync through Arweave (~minutes).`
              : "Private to this wallet. Drag cards between columns, click a card to edit."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="M21 21l-4-4" />
            </svg>
            <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKey} onFocus={() => setSearchFocus(true)} onBlur={() => setTimeout(() => setSearchFocus(false), 120)} placeholder="Search tickets…" className="w-44 rounded-lg border border-slate-700 bg-slate-800 py-1.5 pl-8 pr-2 text-xs text-slate-200 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none" />
            {searchFocus && searchQ && (
              <div className="absolute left-0 top-full z-40 mt-1 max-h-72 w-80 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-2xl">
                <p className="px-3 py-1 text-[10px] uppercase tracking-wide text-slate-500">{searchResults.length} match{searchResults.length === 1 ? "" : "es"}</p>
                {searchResults.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-slate-500">No tickets found.</p>
                ) : (
                  searchResults.map((t, i) => {
                    const c = colOf(t.status);
                    return (
                      <button key={t.id} ref={i === searchActive ? searchActiveRef : undefined} onMouseMove={() => setSearchActive(i)} onMouseDown={(e) => { e.preventDefault(); setSelectedId(t.id); setSearchFocus(false); }} className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${i === searchActive ? "bg-slate-800" : "hover:bg-slate-800"}`}>
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${priorityMeta(t.priority).dot}`} />
                        <span className="shrink-0 text-[10px] font-medium text-slate-500">{code}-{t.num}</span>
                        <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{t.title || "Untitled"}</span>
                        <span className="shrink-0 text-[10px] text-slate-500">{c?.label ?? t.status}{c?.hidden ? " · hidden" : ""}</span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
          <div className="w-36">
            <ThemedSelect
              value={prioFilter}
              options={[{ value: "all", label: "All priorities" }, ...PRIORITIES.map((p) => ({ value: p.id, label: p.label, dot: p.dot }))]}
              onChange={(v) => setPrioFilter(v as Priority | "all")}
            />
          </div>
          {meta?.shared && (
            <button onClick={() => currentId && sync(currentId)} disabled={syncing} title="Refresh from Arweave" aria-label="Refresh" className="flex items-center justify-center px-2 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200 disabled:opacity-60 transition-colors">
              <svg className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M5.5 14a7 7 0 0011.9 2.5M18.5 10A7 7 0 006.6 7.5" /></svg>
            </button>
          )}
          <button onClick={() => setSettingsOpen(true)} title="Board settings (members & columns)" aria-label="Board settings" className="group flex items-center justify-center px-2 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200 transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <g style={{ transformBox: "fill-box", transformOrigin: "center" }} className="scale-90 transition-transform duration-700 group-hover:rotate-90">
                <circle cx="12" cy="12" r="3" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
              </g>
            </svg>
          </button>
        </div>
      </div>

      {/* columns */}
      <div className="flex-1 min-h-0 flex gap-4 overflow-x-auto pb-2">
        {!columnsReady && (
          <div className="flex flex-1 items-center justify-center"><Loading label="Loading board…" /></div>
        )}
        {columnsReady && cols.length === 0 && (
          <div className="flex flex-1 items-center justify-center text-center text-sm text-slate-500">
            <p>This project has no columns yet.{editable ? " Add some in Settings → Columns (pick this project in the dropdown)." : ""}</p>
          </div>
        )}
        {columnsReady && cols.map((col, ci) => {
          const rows = columnRows(state, col.id).filter((r) => matches(r.ticket));
          const isDropCol = drop?.status === col.id;
          // A drop may only land at a ROOT boundary — never between a parent and its
          // sub-tickets. If a hover index falls inside a group, snap past the indented
          // children to the end of that group.
          const snapDrop = (raw: number) => { let j = raw; while (j < rows.length && rows[j].depth > 0) j++; return j; };
          return (
            <div
              key={col.id}
              className="flex w-72 shrink-0 flex-col rounded-xl border border-slate-800 bg-slate-900/40"
              onDragOver={(e) => { if (dragId.current && editable) { e.preventDefault(); setDrop({ status: col.id, index: rows.length }); } }}
              onDrop={(e) => { e.preventDefault(); onDropColumn(col.id); }}
            >
              <div className="flex items-center justify-between gap-2 px-3 py-2.5 shrink-0 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${columnColor(ci)}`} />
                  <span className="text-xs font-medium text-slate-200">{col.label}</span>
                  <span className="rounded-full bg-slate-800 px-1.5 text-[10px] text-slate-400 tabular-nums">{rows.length}</span>
                </div>
                {editable && (
                  <button onClick={() => setCreating(col.id)} title={`Add to ${col.label}`} className="text-slate-500 hover:text-indigo-300 transition-colors">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
                  </button>
                )}
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
                {rows.length === 0 && drop?.status !== col.id && (
                  <p className="px-1 py-6 text-center text-[11px] text-slate-600">No tickets</p>
                )}
                {rows.map(({ ticket: t, depth }, i) => {
                  // Last child of its parent? (a parent's children are contiguous in
                  // `rows`, so a later row with the same parentId means a later sibling.)
                  const lastKid = depth > 0 && !rows.slice(i + 1).some((r) => r.ticket.parentId === t.parentId);
                  return (
                  <div key={t.id} style={depth ? { marginLeft: (depth - 1) * 14 } : undefined}>
                    {isDropCol && drop!.index === i && <DropBar />}
                    <div className={depth ? "relative pl-3.5" : undefined}>
                      {depth > 0 && (
                        <>
                          {/* subtle L connector: vertical trunk (continues past this row unless it's the last child) + a short branch to the card */}
                          <span className={`pointer-events-none absolute left-[6px] top-[-10px] w-px bg-slate-700 ${lastKid ? "h-[24px]" : "bottom-0"}`} />
                          <span className="pointer-events-none absolute left-[6px] top-[14px] h-px w-2 bg-slate-700" />
                        </>
                      )}
                      <TicketCard
                        ticket={t}
                        address={address}
                        code={code}
                        done={isDoneColumn(state, t.status)}
                        subCount={state.tickets.filter((x) => x.parentId === t.id).length}
                        draggable={editable}
                        dragging={draggingId === t.id}
                        onOpen={() => setSelectedId(t.id)}
                        onDragStart={() => { dragId.current = t.id; setDraggingId(t.id); }}
                        onDragEnd={() => { dragId.current = null; setDraggingId(null); setDrop(null); }}
                        onDragOver={(e, half) => {
                          if (!dragId.current) return;
                          e.preventDefault(); e.stopPropagation();
                          setDrop({ status: col.id, index: snapDrop(half === "bottom" ? i + 1 : i) });
                        }}
                      />
                    </div>
                  </div>
                  );
                })}
                {isDropCol && drop!.index >= rows.length && <DropBar />}

                {editable && (
                  <button onClick={() => setCreating(col.id)} className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-slate-500 hover:bg-slate-800/60 hover:text-slate-300 transition-colors">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
                    Add ticket
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selected && (
        <TicketDrawer
          ticket={selected}
          code={code}
          members={state.members}
          columns={boardColumns(state)}
          allLabels={allLabels}
          tickets={state.tickets}
          address={address}
          readOnly={!editable}
          onClose={() => setSelectedId(null)}
          onOpenTicket={(id) => setSelectedId(id)}
          onOpenTicketCross={onOpenTicketCross}
          onOpenEvent={onOpenEvent}
          onOpenItsm={onOpenItsm}
          onPatch={(patch) => editable && dispatch({ t: "ticket.update", ticketId: selected.id, patch: { ...patch, updatedAt: Date.now() } })}
          onLinkChild={(childId, parentId) => editable && dispatch({ t: "ticket.update", ticketId: childId, patch: { parentId, updatedAt: Date.now() } })}
          onCreateChild={(parentId, title) => { if (!editable) return; const col = state.tickets.find((x) => x.id === parentId)?.status ?? visibleColumns(state)[0]?.id ?? "backlog"; dispatch({ t: "ticket.create", ticket: { ...seedTicket(col), title: title.trim(), parentId } }); }}
          onDelete={() => { dispatch({ t: "ticket.delete", ticketId: selected.id }); setSelectedId(null); onToast("Ticket deleted.", "info"); }}
          onAddComment={(text) => dispatch({ t: "comment.add", ticketId: selected.id, comment: { id: newId(), author: myLabel, text, createdAt: Date.now() } })}
          onDeleteComment={(cid) => dispatch({ t: "comment.delete", ticketId: selected.id, commentId: cid })}
          onToast={onToast}
          onAttachShare={shareDocsWithMembers}
        />
      )}

      {creating !== null && (
        <TicketDrawer
          mode="create"
          ticket={seedTicket(creating)}
          code={code}
          members={state.members}
          columns={boardColumns(state)}
          allLabels={allLabels}
          tickets={state.tickets}
          address={address}
          onClose={() => setCreating(null)}
          onOpenTicketCross={onOpenTicketCross}
          onOpenEvent={onOpenEvent}
          onOpenItsm={onOpenItsm}
          onCreate={createTicketFrom}
          onPatch={() => {}}
          onDelete={() => {}}
          onAddComment={() => {}}
          onDeleteComment={() => {}}
          onToast={onToast}
          onAttachShare={shareDocsWithMembers}
        />
      )}

      {settingsOpen && meta && (
        <BoardSettings
          address={address}
          meta={meta}
          state={state}
          myRole={myRole}
          busy={busy}
          onClose={() => setSettingsOpen(false)}
          onToast={onToast}
          onShare={shareCurrent}
          onAddMember={onAddMember}
          onSetRole={onSetRole}
          onRemoveMember={onRemoveMember}
          onColumns={onColumns}
          projects={projects}
          currentProjectId={curProjectId}
          onProjectColumns={setProjectColumns}
          onAddColumn={onAddColumn}
        />
      )}
    </div>
  );
}

function DropBar() {
  return <div className="my-1 h-0.5 rounded-full bg-indigo-400/70" />;
}

function TicketCard({
  ticket: t,
  address,
  code,
  done,
  subCount,
  draggable,
  dragging,
  onOpen,
  onDragStart,
  onDragEnd,
  onDragOver,
}: {
  ticket: Ticket;
  address: string;
  code: string;
  done: boolean;
  subCount: number;
  draggable: boolean;
  dragging: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent, half: "top" | "bottom") => void;
}) {
  const pm = priorityMeta(t.priority);
  const due = dueMeta(t.dueDate, done);
  const logged = loggedHours(t);
  const time = logged > 0 || t.estimate != null ? `${fmtDuration(logged)}${t.estimate != null ? ` / ${fmtDuration(t.estimate)}` : ""}` : null;
  return (
    <div
      draggable={draggable}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart(); }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onDragOver(e, e.clientY - r.top > r.height / 2 ? "bottom" : "top");
      }}
      onClick={onOpen}
      className={`group cursor-pointer rounded-lg border border-slate-700/70 bg-slate-800/70 p-2.5 text-left shadow-sm transition-colors hover:border-slate-600 ${dragging ? "opacity-40" : ""}`}
    >
      <div className="mb-1 flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${pm.dot}`} title={pm.label} />
        <span className="text-[10px] font-medium text-slate-500">{code}-{t.num}</span>
        <span className="ml-auto flex items-center gap-1.5 text-[10px] text-slate-500">
          {subCount > 0 && (
            <span className="flex items-center gap-0.5" title={`${subCount} sub-ticket(s)`}>
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7 4v8a3 3 0 003 3h7M7 4a2 2 0 10-2 2 2 2 0 002-2zm10 11a2 2 0 102 2 2 2 0 00-2-2z" /></svg>
              {subCount}
            </span>
          )}
          {(t.attachments?.length ?? 0) > 0 && (
            <span className="flex items-center gap-0.5" title={`${t.attachments!.length} attachment(s)`}>
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21.44 11.05l-9.19 9.19a5 5 0 01-7.07-7.07l9.19-9.19a3 3 0 014.24 4.24l-9.2 9.19a1 1 0 01-1.41-1.41l8.49-8.49" /></svg>
              {t.attachments!.length}
            </span>
          )}
          {(t.comments?.length ?? 0) > 0 && (
            <span className="flex items-center gap-0.5" title={`${t.comments!.length} comment(s)`}>
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 15a2 2 0 01-2 2H8l-4 4V5a2 2 0 012-2h13a2 2 0 012 2z" /></svg>
              {t.comments!.length}
            </span>
          )}
        </span>
      </div>
      <p className="text-xs leading-snug text-slate-100"><MentionText text={t.title} viewer={address} /></p>
      {(t.labels?.length ?? 0) > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {t.labels.map((l) => (
            <span key={l} className={`rounded border px-1.5 py-px text-[9px] ${labelColor(l)}`}>{l}</span>
          ))}
        </div>
      )}
      {(due || t.assignee || time) && (
        <div className="mt-1.5 flex items-center gap-2">
          {due && (
            <span className={`flex items-center gap-1 text-[10px] ${due.tone}`}>
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 10h18M8 2v4M16 2v4" /></svg>
              {due.label}
            </span>
          )}
          {time && (
            <span className="flex items-center gap-1 text-[10px] text-slate-400" title="Time spent / estimate">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="9" /><path strokeLinecap="round" d="M12 7v5l3 2" /></svg>
              {time}
            </span>
          )}
          {t.assignee && (
            <span className="ml-auto flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600/30 text-[9px] font-medium text-indigo-200" title={t.assignee}>
              {initials(t.assignee)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

