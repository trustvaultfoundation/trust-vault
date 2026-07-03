"use client";

import { useEffect, useRef, useState } from "react";
import { BoardMeta, loadBoards, canEdit } from "@/lib/board";
import { DocPage, loadDocs, saveDocs, newDoc } from "@/lib/boardDocs";
import { RichTextEditor } from "./RichTextEditor";
import { ThemedSelect } from "./BoardDropdowns";
import { loadIdentities } from "@/lib/accessKeys";
import { showUserCard } from "@/lib/profileNav";

const fmtWhen = (ms: number) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const shortAddr = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

// Documentation: one space PER BOARD, pages in a tree, rich-text
// editor. Personal & local to this wallet (not synced to other members).
export default function DocsView({ address, onToast, onOpenTicket, onOpenEvent, onOpenItsm, openDoc, onDocOpened }: { address: string; onToast?: (m: string, t?: "error" | "info" | "warning") => void; onOpenTicket?: (boardId: string, ticketId: string) => void; onOpenEvent?: (eventId: string) => void; onOpenItsm?: (recordId: string) => void; openDoc?: { boardId: string; pageId: string } | null; onDocOpened?: () => void }) {
  const [boards, setBoards] = useState<BoardMeta[]>(() => loadBoards(address));
  const [spaceId, setSpaceId] = useState<string | null>(() => loadBoards(address)[0]?.id ?? null);
  const [docs, setDocs] = useState<DocPage[]>(() => (loadBoards(address)[0] ? loadDocs(loadBoards(address)[0].id) : []));
  const [pageId, setPageId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [editing, setEditing] = useState(false); // pages open in read/view mode by default

  // Editing the docs requires edit permission on the board (the space) — viewers
  // can read but not change. Private/owned boards are always editable by you.
  const canEditDocs = canEdit(boards.find((b) => b.id === spaceId)?.role);

  // Name shown for a page's last editor — your address-book label, else "You" (self) / short address.
  const authorName = (addr: string) => loadIdentities(address).find((i) => i.address === addr)?.label?.trim() || (addr === address ? "You" : shortAddr(addr));

  // A specific page to select once its space loads (set when opening a doc from a profile).
  const pendingPage = useRef<string | null>(null);

  useEffect(() => { const b = loadBoards(address); setBoards(b); setSpaceId((s) => (s && b.some((x) => x.id === s) ? s : b[0]?.id ?? null)); }, [address]);
  useEffect(() => {
    if (!spaceId) { setDocs([]); setPageId(null); return; }
    const d = loadDocs(spaceId);
    setDocs(d);
    const want = pendingPage.current && d.some((x) => x.id === pendingPage.current) ? pendingPage.current : d[0]?.id ?? null;
    pendingPage.current = null;
    setPageId(want);
    setExpanded(new Set(d.map((x) => x.id))); // expand all by default
    setEditing(false);
  }, [spaceId]);

  // Open a specific documentation page (from a profile activity row).
  useEffect(() => {
    if (!openDoc) return;
    pendingPage.current = openDoc.pageId;
    if (spaceId === openDoc.boardId) {
      const d = loadDocs(openDoc.boardId);
      setDocs(d);
      if (d.some((x) => x.id === openDoc.pageId)) { setPageId(openDoc.pageId); setExpanded(new Set(d.map((x) => x.id))); setEditing(false); }
      pendingPage.current = null;
    } else {
      setSpaceId(openDoc.boardId);
    }
    onDocOpened?.();
  }, [openDoc]); // eslint-disable-line react-hooks/exhaustive-deps

  // All mutations go through a FUNCTIONAL update so a late editor onChange can't
  // re-save a stale `docs` (which would resurrect a just-deleted page).
  const update = (fn: (prev: DocPage[]) => DocPage[]) => setDocs((prev) => { const next = fn(prev); if (spaceId) saveDocs(spaceId, next); return next; });
  const childrenOf = (pid: string | null) => docs.filter((d) => d.parentId === pid).sort((a, b) => a.order - b.order);
  const childrenIn = (list: DocPage[], pid: string | null) => list.filter((d) => d.parentId === pid).sort((a, b) => a.order - b.order);
  const create = (parentId: string | null) => {
    const d = newDoc("Untitled", parentId, Date.now(), "page", address);
    update((prev) => { const order = childrenIn(prev, parentId).reduce((m, x) => Math.max(m, x.order + 1), Date.now()); return [...prev, { ...d, order }]; });
    setPageId(d.id);
    setEditing(true); // a freshly created page opens ready to edit
    if (parentId) setExpanded((s) => new Set(s).add(parentId));
  };
  const patch = (id: string, p: Partial<DocPage>) => update((prev) => prev.map((d) => (d.id === id ? { ...d, ...p, updatedAt: Date.now(), updatedBy: address } : d)));
  const remove = (id: string) => {
    setConfirmDel(null);
    update((prev) => {
      const kill = new Set<string>();
      const collect = (pid: string) => { kill.add(pid); prev.filter((d) => d.parentId === pid).forEach((c) => collect(c.id)); };
      collect(id);
      const next = prev.filter((d) => !kill.has(d.id));
      if (pageId && kill.has(pageId)) setTimeout(() => setPageId(next[0]?.id ?? null), 0);
      return next;
    });
  };
  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // A click anywhere (other than the confirm controls) cancels a pending delete.
  useEffect(() => {
    if (!confirmDel) return;
    const onDown = () => setConfirmDel(null);
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [confirmDel]);

  // ── drag to reorder / re-parent pages in the tree ──
  const dragId = useRef<string | null>(null);
  const [dropT, setDropT] = useState<{ id: string | null; zone: "before" | "inside" | "after" } | null>(null);
  const descendantsOf = (id: string) => { const set = new Set<string>(); const walk = (x: string) => { set.add(x); docs.filter((d) => d.parentId === x).forEach((c) => walk(c.id)); }; walk(id); return set; };
  const movePage = (id: string, targetId: string | null, zone: "before" | "inside" | "after") => {
    if (id === targetId) return;
    if (targetId && descendantsOf(id).has(targetId)) return; // can't move into own subtree
    update((prev) => {
      const target = targetId ? prev.find((d) => d.id === targetId) : null;
      const newParent = zone === "inside" ? targetId : target ? target.parentId : null;
      const updated = prev.map((d) => (d.id === id ? { ...d, parentId: newParent } : d));
      const sibs = updated.filter((d) => d.parentId === newParent && d.id !== id).sort((a, b) => a.order - b.order);
      let idx = sibs.length;
      if (zone !== "inside" && targetId) { const ti = sibs.findIndex((s) => s.id === targetId); idx = ti < 0 ? sibs.length : zone === "before" ? ti : ti + 1; }
      const ordered = [...sibs]; ordered.splice(idx, 0, updated.find((d) => d.id === id)!);
      const orderMap = new Map(ordered.map((d, i) => [d.id, i] as const));
      if (newParent) setExpanded((s) => new Set(s).add(newParent));
      return updated.map((d) => (orderMap.has(d.id) ? { ...d, order: orderMap.get(d.id)!, updatedAt: d.id === id ? Date.now() : d.updatedAt } : d));
    });
  };

  const selected = docs.find((d) => d.id === pageId) ?? null;

  const renderTree = (parentId: string | null, depth: number): React.ReactNode =>
    childrenOf(parentId).map((d) => {
      const kids = childrenOf(d.id);
      const open = expanded.has(d.id);
      const dt = dropT?.id === d.id ? dropT.zone : null;
      return (
        <div key={d.id}>
          <div
            draggable={canEditDocs}
            onDragStart={(e) => { e.stopPropagation(); dragId.current = d.id; }}
            onDragEnd={() => { dragId.current = null; setDropT(null); }}
            onDragOver={(e) => {
              if (!dragId.current || dragId.current === d.id) return;
              e.preventDefault(); e.stopPropagation();
              const r = e.currentTarget.getBoundingClientRect();
              const y = e.clientY - r.top;
              setDropT({ id: d.id, zone: y < r.height * 0.3 ? "before" : y > r.height * 0.7 ? "after" : "inside" });
            }}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragId.current && dt) movePage(dragId.current, d.id, dt); setDropT(null); }}
            className={`group flex items-center gap-0.5 rounded-lg pr-1 ${d.id === pageId ? "bg-slate-800" : "hover:bg-slate-800/50"} ${dt === "inside" ? "ring-1 ring-indigo-400/60" : ""} ${dt === "before" ? "border-t-2 border-indigo-400" : ""} ${dt === "after" ? "border-b-2 border-indigo-400" : ""}`}
            style={{ paddingLeft: 4 + depth * 12 }}
          >
            <button onClick={() => kids.length && toggle(d.id)} className="flex h-5 w-4 shrink-0 items-center justify-center text-slate-500">
              {kids.length > 0 ? (
                <svg className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M9 6l6 6-6 6" /></svg>
              ) : (
                <span className="h-1 w-1 rounded-full bg-slate-600" />
              )}
            </button>
            <button onClick={() => { setPageId(d.id); setEditing(false); }} className="min-w-0 flex-1 truncate py-1.5 text-left text-xs text-slate-200">{d.title || "Untitled"}</button>
            {canEditDocs && (
              <button onClick={() => { setPageId(d.id); setEditing(true); }} title="Edit page" className="shrink-0 p-1 text-slate-600 opacity-0 transition-opacity hover:text-indigo-300 group-hover:opacity-100">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>
              </button>
            )}
            {canEditDocs && (
              <button onClick={() => create(d.id)} title="Add subpage" className="shrink-0 p-1 text-slate-600 opacity-0 transition-opacity hover:text-indigo-300 group-hover:opacity-100">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
              </button>
            )}
            {canEditDocs && (confirmDel === d.id ? (
              <span className="flex shrink-0 items-center gap-0.5" onMouseDown={(e) => e.stopPropagation()}>
                <button onClick={() => remove(d.id)} title="Delete page + subpages" className="p-1 text-red-400 hover:text-red-300"><svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M5 13l4 4L19 7" /></svg></button>
                <button onClick={() => setConfirmDel(null)} title="Cancel" className="p-1 text-slate-500 hover:text-slate-200"><svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg></button>
              </span>
            ) : (
              <button onClick={() => setConfirmDel(d.id)} title="Delete page" className="shrink-0 p-1 text-slate-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"><svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12" /></svg></button>
            ))}
          </div>
          {open && renderTree(d.id, depth + 1)}
        </div>
      );
    });

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-4 shrink-0">
        <h2 className="text-lg font-semibold text-white">Documentation</h2>
        <p className="text-xs text-slate-500 mt-0.5">A documentation space per board — write nested pages. Saved to this wallet on your device.</p>
      </div>

      {boards.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-slate-500">Create a board first — each board gets its own documentation space.</div>
      ) : (
        <div className="flex flex-1 items-start gap-4">
          {/* tree / space — sticky so it stays while the page scrolls */}
          <div className="flex w-64 shrink-0 flex-col self-start rounded-xl border border-slate-800 bg-slate-900/40 md:sticky md:top-0 md:max-h-[calc(100vh-8rem)]">
            <div className="border-b border-slate-800 p-2">
              <ThemedSelect value={spaceId ?? ""} options={boards.map((b) => ({ value: b.id, label: b.title }))} onChange={setSpaceId} />
            </div>
            <div
              className="flex-1 min-h-0 overflow-y-auto p-2"
              onDragOver={(e) => { if (dragId.current) e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); if (dragId.current) { movePage(dragId.current, null, "inside"); setDropT(null); } }}
            >
              {docs.length === 0 && <p className="px-1 py-6 text-center text-[11px] text-slate-600">No pages yet.</p>}
              {renderTree(null, 0)}
              {canEditDocs && <p className="px-1 pt-2 text-center text-[10px] text-slate-700">Drag pages to reorder or nest them.</p>}
            </div>
            {canEditDocs && (
              <div className="border-t border-slate-800 p-2">
                <button onClick={() => create(null)} className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-indigo-300 hover:bg-slate-800/60">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
                  New page
                </button>
              </div>
            )}
          </div>

          {/* editor — borderless, document-style; flows so the whole page scrolls as one */}
          <div className="flex min-w-0 flex-1 flex-col">
            {selected ? (
              <div className="mx-auto w-full max-w-6xl px-4">
                <div className="flex items-start justify-between gap-2">
                  {canEditDocs && editing ? (
                    <input value={selected.title} onChange={(e) => patch(selected.id, { title: e.target.value })} placeholder="Untitled" className="w-full bg-transparent pt-1 text-2xl font-bold text-white placeholder:text-slate-700 focus:outline-none" />
                  ) : (
                    <h1 className="w-full break-words pt-1 text-2xl font-bold text-white">{selected.title || "Untitled"}</h1>
                  )}
                  {canEditDocs && (
                    <button onClick={() => setEditing((v) => !v)} title={editing ? "Done editing" : "Edit page"} className="mt-1.5 flex shrink-0 items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-400 transition-colors hover:border-indigo-500/50 hover:text-indigo-300">
                      {editing ? (
                        <><svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>Done</>
                      ) : (
                        <><svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>Edit</>
                      )}
                    </button>
                  )}
                </div>
                <p className="mb-2 flex flex-wrap items-center gap-x-1 text-[10px] text-slate-600">
                  <span>Updated {fmtWhen(selected.updatedAt)}</span>
                  {selected.updatedBy && (
                    <>
                      <span>· by</span>
                      <button
                        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); showUserCard({ address: selected.updatedBy!, label: authorName(selected.updatedBy!), rect: { top: r.top, left: r.left, bottom: r.bottom } }); }}
                        className="font-medium text-indigo-300 hover:text-indigo-200 hover:underline"
                      >{authorName(selected.updatedBy)}</button>
                    </>
                  )}
                  {!canEditDocs && <span>· view only</span>}
                </p>
                <RichTextEditor key={selected.id} value={selected.content} onChange={(html) => patch(selected.id, { content: html })} placeholder="Write documentation…" bare allowWhiteboard allowAttachments allowRefs refBoardId={spaceId ?? undefined} address={address} onToast={onToast} onOpenTicket={onOpenTicket} onOpenEvent={onOpenEvent} onOpenItsm={onOpenItsm} editable={canEditDocs && editing} />
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center text-center">
                <div>
                  <p className="text-sm text-slate-500">{canEditDocs ? "No page selected." : "No documentation to show."}</p>
                  {canEditDocs && <button onClick={() => create(null)} className="mt-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500">Create your first page</button>}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
