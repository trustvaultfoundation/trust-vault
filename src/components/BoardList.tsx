"use client";

import { useEffect, useRef, useState } from "react";
import { BoardMeta, Project, ROLES } from "@/lib/board";

// Board switcher: a button showing the current board + project, and a dropdown to
// pick / create / rename / delete boards. HOVER a board to open its PROJECTS to the
// LEFT (each project is a column-view inside that board) — pick, create, rename or
// delete them there.
export function BoardList({
  boards,
  currentId,
  myAddress,
  editable,
  currentProjectId,
  getProjects,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onSelectProject,
  onAddProject,
  onRenameProject,
  onDeleteProject,
}: {
  boards: BoardMeta[];
  currentId: string | null;
  myAddress: string;
  editable: boolean;
  currentProjectId: string;
  getProjects: (boardId: string) => Project[];
  onSelect: (id: string) => void;
  onCreate: (title: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onSelectProject: (boardId: string, projectId: string) => void;
  onAddProject: (boardId: string, name: string) => void;
  onRenameProject: (boardId: string, projectId: string, name: string) => void;
  onDeleteProject: (boardId: string, projectId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("Main");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  // project flyout
  const [hovBoard, setHovBoard] = useState<string | null>(null);
  const [hovTop, setHovTop] = useState(0);
  const [flySide, setFlySide] = useState<"right" | "left">("right");
  const [pAdding, setPAdding] = useState(false);
  const [pName, setPName] = useState("");
  const [pRenaming, setPRenaming] = useState<string | null>(null);
  const [pRname, setPRname] = useState("");
  const [pConfirmDel, setPConfirmDel] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const closeAll = () => { setOpen(false); setCreating(false); setRenaming(null); setConfirmDel(null); setHovBoard(null); setPAdding(false); setPRenaming(null); setPConfirmDel(null); };
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) closeAll(); };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const current = boards.find((b) => b.id === currentId) ?? null;
  const roleLabel = (m: BoardMeta) => ROLES.find((r) => r.id === m.role)?.label ?? m.role;
  const badge = (m: BoardMeta) => (m.shared ? `Shared · ${roleLabel(m)}` : "Private");
  const curProjName = current ? (getProjects(current.id).find((p) => p.id === currentProjectId)?.name ?? getProjects(current.id)[0]?.name) : null;

  const cancelNew = () => { setCreating(false); setNewTitle("Main"); };
  const submitNew = () => { const t = newTitle.trim() || "Main"; cancelNew(); onCreate(t); };
  const submitRename = (id: string) => { const t = renameTitle.trim(); const b = boards.find((x) => x.id === id); setRenaming(null); if (b && t && t !== b.title) onRename(id, t); };
  const onRowEnter = (e: React.MouseEvent, id: string) => {
    const panel = panelRef.current; if (!panel) return;
    const pr = panel.getBoundingClientRect();
    // Lift the flyout so its project list lines up with the hovered row (offset for
    // the flyout's own header + padding), instead of sitting below it.
    setHovTop(Math.max(2, (e.currentTarget as HTMLElement).getBoundingClientRect().top - pr.top - 44));
    // Prefer opening to the RIGHT; flip to the LEFT when the right would overflow the
    // viewport, and otherwise fall back to whichever side has more room (responsive).
    const flyW = 224; // w-56
    const rightRoom = window.innerWidth - pr.right;
    const leftRoom = pr.left;
    setFlySide(rightRoom >= flyW + 8 ? "right" : leftRoom >= flyW + 8 ? "left" : rightRoom >= leftRoom ? "right" : "left");
    setHovBoard(id); setPAdding(false); setPRenaming(null); setPConfirmDel(null);
  };

  const flyBoard = hovBoard ? boards.find((b) => b.id === hovBoard) ?? null : null;

  return (
    <div ref={ref} className="relative flex items-center gap-2">
      {/* trigger — same compact dropdown as the Dashboard scope selector */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-medium text-slate-200 hover:border-slate-500 transition-colors"
      >
        <span className="max-w-[10rem] truncate">{current?.title ?? "Select board"}</span>
        <svg className={`h-3.5 w-3.5 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 9l6 6 6-6" /></svg>
      </button>
      {/* project + role tags live OUTSIDE the trigger */}
      {curProjName && <span className="max-w-[110px] truncate rounded bg-slate-700/70 px-1.5 py-0.5 text-[10px] text-slate-300">{curProjName}</span>}
      {current && (
        <span className={`rounded px-1.5 py-0.5 text-[10px] ${current.shared ? "bg-indigo-500/20 text-indigo-300" : "bg-slate-700 text-slate-400"}`}>
          {current.shared ? roleLabel(current) : "Private"}
        </span>
      )}

      {open && (
        <div ref={panelRef} onMouseLeave={() => { setHovBoard(null); setPAdding(false); }} className="absolute left-0 top-full z-50 mt-1.5 w-72 rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-2xl">
          <div className="max-h-72 overflow-y-auto">
            {boards.length === 0 && <p className="px-3 py-2 text-xs text-slate-500">No boards yet.</p>}
            {boards.map((b) => (
              <div key={b.id} onMouseEnter={(e) => onRowEnter(e, b.id)} className={`group flex items-center gap-1.5 px-2 ${b.id === currentId ? "bg-slate-800/60" : hovBoard === b.id ? "bg-slate-800/40" : "hover:bg-slate-800/40"}`}>
                {renaming === b.id ? (
                  <input
                    autoFocus
                    value={renameTitle}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setRenameTitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") submitRename(b.id); if (e.key === "Escape") setRenaming(null); }}
                    onBlur={() => submitRename(b.id)}
                    className="my-1 w-full rounded border border-indigo-500 bg-slate-800 px-1.5 py-1 text-xs text-slate-100 focus:outline-none"
                  />
                ) : (
                  <>
                    <button onClick={() => { onSelect(b.id); closeAll(); }} className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${b.shared ? "bg-indigo-400" : "bg-slate-500"}`} />
                      <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{b.title}</span>
                      <span className="shrink-0 text-[9px] text-slate-500">{badge(b)}</span>
                    </button>
                    <svg className={`h-3.5 w-3.5 shrink-0 ${hovBoard === b.id && flySide === "left" ? "-scale-x-100" : ""} ${hovBoard === b.id ? "text-indigo-300" : "text-slate-600"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M9 6l6 6-6 6" /></svg>
                    {b.owner === myAddress && (
                      <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
                        <button onClick={() => { setRenaming(b.id); setRenameTitle(b.title); }} title="Rename" className="p-1 text-slate-500 hover:text-slate-200">
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 4H4v16h16v-7M18.5 2.5a2.1 2.1 0 013 3L12 15l-4 1 1-4z" /></svg>
                        </button>
                        {boards.length > 1 && (
                          confirmDel === b.id ? (
                            <button onClick={() => { onDelete(b.id); setConfirmDel(null); }} title="Confirm delete" className="p-1 text-red-400 hover:text-red-300">
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M5 13l4 4L19 7" /></svg>
                            </button>
                          ) : (
                            <button onClick={() => setConfirmDel(b.id)} title="Delete" className="p-1 text-slate-500 hover:text-red-400">
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M10 11v6M14 11v6" /></svg>
                            </button>
                          )
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>

          <div onMouseEnter={() => { setHovBoard(null); setPConfirmDel(null); }} className="mt-1 border-t border-slate-800 pt-1">
            {creating ? (
              <div className="space-y-1.5 p-2">
                <input autoFocus value={newTitle} onFocus={(e) => e.target.select()} onChange={(e) => setNewTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submitNew(); if (e.key === "Escape") cancelNew(); }} placeholder="Board name…" className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none" />
                <div className="flex items-center gap-2">
                  <button onClick={submitNew} className="rounded bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-indigo-500">Create board</button>
                  <button onClick={cancelNew} className="text-[11px] text-slate-400 hover:text-slate-200">Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setCreating(true)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-indigo-300 hover:bg-slate-800/60">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
                New board
              </button>
            )}
          </div>

          {/* projects of the hovered board — flyout to the LEFT, aligned with the row */}
          {flyBoard && (
            <div className={`absolute z-50 w-56 rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-2xl ${flySide === "right" ? "left-full" : "right-full"}`} style={{ top: hovTop }}>
              <p className="truncate px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">Projects · {flyBoard.title}</p>
              <div className="max-h-60 overflow-y-auto">
                {getProjects(flyBoard.id).map((p) => {
                  const isCur = flyBoard.id === currentId && p.id === currentProjectId;
                  return (
                    <div key={p.id} className={`group/p flex items-center gap-1 px-2 ${isCur ? "bg-indigo-600/20" : "hover:bg-slate-800/40"}`}>
                      {pRenaming === p.id ? (
                        <input autoFocus value={pRname} onFocus={(e) => e.target.select()} onChange={(e) => setPRname(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { if (pRname.trim()) onRenameProject(flyBoard.id, p.id, pRname.trim()); setPRenaming(null); } if (e.key === "Escape") setPRenaming(null); }} onBlur={() => { if (pRname.trim()) onRenameProject(flyBoard.id, p.id, pRname.trim()); setPRenaming(null); }} className="my-1 w-full rounded border border-indigo-500 bg-slate-800 px-1.5 py-1 text-xs text-slate-100 focus:outline-none" />
                      ) : (
                        <>
                          <button onClick={() => { onSelectProject(flyBoard.id, p.id); closeAll(); }} className={`min-w-0 flex-1 truncate py-1.5 text-left text-xs ${isCur ? "text-indigo-200" : "text-slate-200"}`}>{p.name}</button>
                          {editable && (
                            <div className={`flex shrink-0 items-center transition-opacity ${pConfirmDel === p.id ? "opacity-100" : "opacity-0 group-hover/p:opacity-100"}`}>
                              <button onClick={() => { setPRenaming(p.id); setPRname(p.name); setPConfirmDel(null); }} title="Rename project" className="p-1 text-slate-500 hover:text-slate-200"><svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 4H4v16h16v-7M18.5 2.5a2.1 2.1 0 013 3L12 15l-4 1 1-4z" /></svg></button>
                              {getProjects(flyBoard.id).length > 1 && (pConfirmDel === p.id ? (
                                <button onClick={() => { onDeleteProject(flyBoard.id, p.id); setPConfirmDel(null); }} title="Confirm delete" className="p-1 text-red-400 hover:text-red-300"><svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M5 13l4 4L19 7" /></svg></button>
                              ) : (
                                <button onClick={() => setPConfirmDel(p.id)} title="Delete project" className="p-1 text-slate-500 hover:text-red-400"><svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M10 11v6M14 11v6" /></svg></button>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              {editable && (
                <div className="mt-1 border-t border-slate-800 pt-1">
                  {pAdding ? (
                    <div className="p-1.5">
                      <input autoFocus value={pName} onChange={(e) => setPName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && pName.trim()) { onAddProject(flyBoard.id, pName.trim()); setPAdding(false); setPName(""); closeAll(); } if (e.key === "Escape") { setPAdding(false); setPName(""); } }} placeholder="New project name…" className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none" />
                      <p className="mt-1 px-1 text-[10px] text-slate-600">Then add its columns in Settings → Columns.</p>
                    </div>
                  ) : (
                    <button onClick={() => setPAdding(true)} className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs text-indigo-300 hover:bg-slate-800/60">
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
                      New project
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
