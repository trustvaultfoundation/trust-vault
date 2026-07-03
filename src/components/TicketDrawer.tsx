"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Ticket,
  Member,
  Priority,
  Attachment,
  WorkLog,
  DEFAULT_COLUMNS,
  PRIORITIES,
  priorityMeta,
  labelColor,
  normalizeTicket,
  loggedHours,
  fmtDuration,
  parseDuration,
  descendantIds,
  newId,
} from "@/lib/board";
import { RichTextEditor } from "./RichTextEditor";
import { RelatedLinks } from "./RelatedLinks";
import { RichTextView, isEmptyHtml } from "./RichTextView";
import { ThemedSelect, ThemedAutocomplete, ThemedCombo } from "./BoardDropdowns";
import { DateInput } from "./DateInput";
import { MentionInput } from "./MentionInput";
import { MentionText } from "./MentionText";
import { TimeField } from "./TimeField";
import { mentionPeople } from "@/lib/mentions";
import { showUserCard } from "@/lib/profileNav";
import { loadIdentities } from "@/lib/accessKeys";
import { AttachPicker } from "./AttachPicker";
import { StoredUpload } from "@/lib/vault";
import { fetchAndDecryptByTxId } from "@/lib/viewer";

type Toast = (m: string, t?: "error" | "info" | "warning") => void;

const fmtWhen = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

const field = "w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none disabled:opacity-60";
const lbl = "mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500";

export function TicketDrawer({
  ticket,
  mode = "edit",
  code,
  members,
  columns,
  allLabels,
  tickets = [],
  address,
  readOnly = false,
  onClose,
  onOpenTicket,
  onOpenTicketCross,
  onOpenEvent,
  onOpenItsm,
  onPatch,
  onCreate,
  onLinkChild,
  onCreateChild,
  onDelete,
  onAddComment,
  onDeleteComment,
  onToast,
  onAttachShare,
}: {
  ticket: Ticket;
  mode?: "edit" | "create";
  code: string;
  members: Member[];
  columns?: { id: string; label: string; hidden?: boolean }[];
  allLabels?: string[];
  tickets?: Ticket[];
  address: string;
  readOnly?: boolean;
  onClose: () => void;
  onOpenTicket?: (id: string) => void;
  onOpenTicketCross?: (boardId: string, ticketId: string) => void;
  onOpenEvent?: (eventId: string) => void;
  onOpenItsm?: (recordId: string) => void;
  onPatch: (patch: Partial<Ticket>) => void;
  onCreate?: (ticket: Ticket) => void;
  onLinkChild?: (childId: string, parentId: string | null) => void;
  onCreateChild?: (parentId: string, title: string) => void;
  onDelete: () => void;
  onAddComment: (text: string) => void;
  onDeleteComment: (id: string) => void;
  onToast: Toast;
  onAttachShare?: (docs: StoredUpload[]) => void;
}) {
  const create = mode === "create";
  const cols = columns && columns.length ? columns : DEFAULT_COLUMNS;
  const [shown, setShown] = useState(false);
  const [draft, setDraft] = useState<Ticket>(ticket);
  const [labelInput, setLabelInput] = useState("");
  const [comment, setComment] = useState("");
  const [commentKey, setCommentKey] = useState(0);
  const [confirmDel, setConfirmDel] = useState(false);
  const [confirmCmt, setConfirmCmt] = useState<string | null>(null);
  const [commentSort, setCommentSort] = useState<"newest" | "oldest">("newest");
  const [attachOpen, setAttachOpen] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [logForm, setLogForm] = useState<WorkLog | null>(null);
  const [childTitle, setChildTitle] = useState("");

  // In edit mode the live prop ticket is the source of truth; in create mode we
  // hold a local draft until the user hits Create. Normalize the edit ticket so a
  // stale/partial ticket (older shape) still renders every field safely.
  const t = create ? draft : normalizeTicket(ticket, 0);
  const set = (patch: Partial<Ticket>) => { if (create) setDraft((d) => ({ ...d, ...patch })); else onPatch(patch); };
  const pm = priorityMeta(t.priority);
  const logged = loggedHours(t);
  const remaining = (t.estimate ?? 0) - logged;
  const me = members.find((m) => m.address === address)?.label || "You";
  const people = useMemo(() => mentionPeople(address, members.map((m) => ({ id: m.address, label: m.label }))), [address, members]);
  // A comment author (stored as a member label) → wallet + display name (address-book name first).
  const authorOf = (label: string): { address: string; name: string } | null => {
    const m = members.find((x) => x.label === label || x.address === label);
    if (!m) return null;
    const idn = loadIdentities(address).find((i) => i.address === m.address);
    return { address: m.address, name: idn?.label?.trim() || (m.label !== "Owner" ? m.label : "") || label };
  };
  const saveLog = (entry: WorkLog) => {
    set({ worklog: t.worklog.some((w) => w.id === entry.id) ? t.worklog.map((w) => (w.id === entry.id ? entry : w)) : [...t.worklog, entry] });
    setLogForm(null);
  };

  // ── sub-tickets (parent/child) ──
  // `parentId` is a plain field on THIS ticket, so the Parent picker just patches
  // it via `set`. Children live on OTHER tickets, so adding/removing them goes
  // through onLinkChild / onCreateChild (which dispatch events on those tickets).
  const children = tickets.filter((x) => x.parentId === t.id).sort((a, b) => a.order - b.order);
  const parent = t.parentId ? tickets.find((x) => x.id === t.parentId) ?? null : null;
  const descend = descendantIds(tickets, t.id); // can't parent under our own descendant (cycle)
  const parentOpts = tickets.filter((x) => x.id !== t.id && !descend.has(x.id));
  const linkable = tickets.filter((x) => x.id !== t.id && x.parentId !== t.id && !descend.has(x.id));
  const tkLabel = (x: Ticket) => `${code}-${x.num} · ${x.title?.trim() || "Untitled"}`;
  const addChild = () => { const v = childTitle.trim(); if (v && onCreateChild) { onCreateChild(t.id, v); setChildTitle(""); } };

  useEffect(() => {
    setShown(true);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submitComment = () => { if (isEmptyHtml(comment)) return; onAddComment(comment); setComment(""); setCommentKey((k) => k + 1); };

  const handleAttach = (docs: StoredUpload[]) => {
    const add = docs.filter((d) => !t.attachments.some((a) => a.txId === d.txId)).map((d) => ({ txId: d.txId, name: d.originalName, type: d.originalType, size: d.originalSize }));
    if (add.length) set({ attachments: [...t.attachments, ...add] });
    onAttachShare?.(docs);
  };
  const removeAttachment = (txId: string) => set({ attachments: t.attachments.filter((a) => a.txId !== txId) });
  const openAttachment = async (a: Attachment) => {
    setOpening(a.txId);
    try {
      const raw = (typeof window !== "undefined" && localStorage.getItem(`gtv_aes_${a.txId}`)) || undefined;
      const doc = await fetchAndDecryptByTxId(a.txId, raw ? { rawKeyB64: raw } : undefined);
      const url = URL.createObjectURL(doc.blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Couldn't open the attachment.", "error");
    } finally {
      setOpening(null);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100]">
      <div className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ${shown ? "opacity-100" : "opacity-0"}`} onClick={onClose} />
      <div className={`absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-slate-800 bg-slate-900 shadow-2xl transition-transform duration-200 ${shown ? "translate-x-0" : "translate-x-full"}`}>
        {/* header */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-3 shrink-0">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${pm.dot}`} />
            <span className="text-sm font-medium text-slate-300">{create ? "New ticket" : `${code}-${t.num}`}</span>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-200 transition-colors">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        {/* body */}
        <div className="flex-1 min-h-0 space-y-4 overflow-y-auto px-4 py-4">
          <MentionInput
            multiline
            value={t.title}
            onChange={(v) => set({ title: v })}
            people={people}
            disabled={readOnly}
            rows={2}
            autoFocus={create}
            className="w-full resize-none rounded-lg border border-transparent bg-transparent px-1 py-1 text-base font-semibold text-white hover:border-slate-700 focus:border-indigo-500 focus:outline-none disabled:hover:border-transparent"
            placeholder="Ticket title"
          />

          {/* parent (this ticket is a sub-ticket of…) — a plain field, set via patch */}
          {(parent || (!readOnly && parentOpts.length > 0)) && (
            <div className="flex items-center gap-2">
              <label className={`${lbl} mb-0 shrink-0`}>Parent</label>
              {readOnly ? (
                parent ? (
                  <button onClick={() => onOpenTicket?.(parent.id)} className="min-w-0 truncate rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-left text-xs text-slate-200 hover:border-indigo-500/50 hover:text-indigo-200">{tkLabel(parent)}</button>
                ) : <span className="text-xs text-slate-600">—</span>
              ) : (
                <div className="min-w-0 flex-1">
                  <ThemedCombo value={t.parentId ?? ""} options={parentOpts.map((x) => ({ value: x.id, label: tkLabel(x) }))} onChange={(id) => set({ parentId: id || null })} placeholder="Select parent ticket…" allowClear />
                </div>
              )}
              {parent && !readOnly && onOpenTicket && (
                <button onClick={() => onOpenTicket(parent.id)} title="Open parent ticket" aria-label="Open parent ticket" className="shrink-0 rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-slate-400 hover:text-indigo-300">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M14 5h5v5M19 5l-8 8M19 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h6" /></svg>
                </button>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Status</label>
              <ThemedSelect value={t.status} options={cols.map((c) => ({ value: c.id, label: `${c.label}${c.hidden ? " · hidden" : ""}` }))} onChange={(v) => set({ status: v })} disabled={readOnly} />
            </div>
            <div>
              <label className={lbl}>Priority</label>
              <ThemedSelect value={t.priority} options={PRIORITIES.map((p) => ({ value: p.id, label: p.label, dot: p.dot }))} onChange={(v) => set({ priority: v as Priority })} disabled={readOnly} />
            </div>
            <div>
              <label className={lbl}>Assignee</label>
              <ThemedAutocomplete value={t.assignee} onChange={(v) => set({ assignee: v })} onPick={(v) => set({ assignee: v })} suggestions={members.filter((m) => !m.inactive).map((m) => m.label)} placeholder="Member or name" disabled={readOnly} className={field} />
            </div>
            <div>
              <label className={lbl}>Reporter</label>
              <input value={t.createdBy || "—"} readOnly title="Who created the ticket (set automatically)" className={`${field} cursor-default text-slate-400`} />
            </div>
            <div>
              <label className={lbl}>Due date</label>
              <DateInput value={t.dueDate ?? ""} onChange={(v) => set({ dueDate: v || null })} disabled={readOnly} clearable className={field} />
            </div>
            <div>
              <label className={lbl}>Start date</label>
              <DateInput value={t.startDate ?? ""} onChange={(v) => set({ startDate: v || null })} disabled={readOnly} clearable className={field} />
            </div>
            <div>
              <label className={lbl}>Estimate</label>
              <DurationInput value={t.estimate} onChange={(h) => set({ estimate: h })} disabled={readOnly} placeholder="2h 30m" className={field} />
            </div>
            <div>
              <label className={lbl}>Logged</label>
              <div className={`${field} cursor-default ${remaining < 0 ? "text-red-300" : "text-slate-300"}`} title="Total time logged (see Work log)">{fmtDuration(logged)}{t.estimate != null ? ` / ${fmtDuration(t.estimate)}` : ""}</div>
            </div>
          </div>

          {/* work log (time tracking) */}
          {!create && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className={lbl}>Work log</label>
                {!readOnly && !logForm && (
                  <button onClick={() => setLogForm(newLog(me))} className="flex items-center gap-1 text-[10px] text-indigo-300 hover:text-indigo-200">
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
                    Log time
                  </button>
                )}
              </div>
              {t.estimate != null && (
                <div className="mb-2">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                    <div className={`h-full rounded-full ${remaining < 0 ? "bg-red-500" : "bg-indigo-500"}`} style={{ width: `${t.estimate > 0 ? Math.min(100, (logged / t.estimate) * 100) : 0}%` }} />
                  </div>
                  <p className="mt-1 text-[10px] text-slate-500">{fmtDuration(logged)} logged · {remaining >= 0 ? `${fmtDuration(remaining)} remaining` : `${fmtDuration(-remaining)} over`} of {fmtDuration(t.estimate)}</p>
                </div>
              )}
              <div className="space-y-1.5">
                {t.worklog.length === 0 && !logForm && <p className="text-[11px] text-slate-600">No time logged{readOnly ? "" : " yet"}.</p>}
                {[...t.worklog].sort((a, b) => b.createdAt - a.createdAt).map((w) => (
                  <div key={w.id} className="group rounded-lg border border-slate-800 bg-slate-800/40 px-2.5 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 text-[11px] font-medium text-indigo-300">{fmtDuration(w.hours)}</span>
                      <MentionText text={w.title || w.description || "Time logged"} viewer={address} className="min-w-0 flex-1 truncate text-xs text-slate-200" />
                      {!readOnly && (
                        <span className="flex shrink-0 items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                          <button onClick={() => setLogForm(w)} title="Edit entry" aria-label="Edit entry" className="text-slate-500 hover:text-slate-300">
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>
                          </button>
                          <button onClick={() => set({ worklog: t.worklog.filter((x) => x.id !== w.id) })} title="Delete entry" aria-label="Delete entry" className="text-slate-500 hover:text-red-400">
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M10 11v6M14 11v6" /></svg>
                          </button>
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[10px] text-slate-500">{w.date}{w.from && w.to ? ` · ${w.from}–${w.to}` : ""}{w.author ? ` · ${w.author}` : ""}</div>
                    {w.title && w.description && <p className="mt-0.5 whitespace-pre-wrap text-xs text-slate-400"><MentionText text={w.description} viewer={address} /></p>}
                  </div>
                ))}
              </div>
              {logForm && !readOnly && (
                <WorkLogForm entry={logForm} people={people} onCancel={() => setLogForm(null)} onSave={saveLog} />
              )}
            </div>
          )}

          <div>
            <label className={lbl}>Labels</label>
            <div className="flex flex-wrap items-center gap-1.5">
              {t.labels.map((l) => (
                <span key={l} className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${labelColor(l)}`}>
                  {l}
                  {!readOnly && <button onClick={() => set({ labels: t.labels.filter((x) => x !== l) })} className="opacity-60 hover:opacity-100" aria-label={`Remove ${l}`}>×</button>}
                </span>
              ))}
              {t.labels.length === 0 && readOnly && <span className="text-[10px] text-slate-600">No labels</span>}
              {!readOnly && (
                <div className="w-28">
                  <ThemedAutocomplete
                    value={labelInput}
                    onChange={setLabelInput}
                    onPick={(v) => { const x = v.trim(); if (x && !t.labels.includes(x)) set({ labels: [...t.labels, x] }); setLabelInput(""); }}
                    suggestions={(allLabels ?? []).filter((l) => !t.labels.includes(l))}
                    placeholder="+ tag"
                    className="w-28 rounded border border-dashed border-slate-700 bg-transparent px-1.5 py-0.5 text-[10px] text-slate-200 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              )}
            </div>
          </div>

          <div>
            <label className={lbl}>Description</label>
            {readOnly ? (
              isEmptyHtml(t.description) ? <p className="text-xs text-slate-600">No description</p> : <RichTextView html={t.description} className="text-xs text-slate-300" />
            ) : (
              <RichTextEditor key={t.id} value={t.description} onChange={(html) => set({ description: html })} placeholder="Add more detail — reference a record/event with “+”…" allowRefs address={address} onOpenTicket={onOpenTicketCross} onOpenEvent={onOpenEvent} onOpenItsm={onOpenItsm} />
            )}
          </div>

          <div>
            <label className={lbl}>Related records</label>
            <div className="mt-1"><RelatedLinks address={address} links={t.links ?? []} onChange={(links) => set({ links })} onOpenTicket={onOpenTicketCross} onOpenEvent={onOpenEvent} onOpenItsm={onOpenItsm} editable={!readOnly} /></div>
          </div>

          <div>
            <label className={lbl}>Attachments ({t.attachments.length})</label>
            <div className="space-y-1.5">
              {t.attachments.map((a) => (
                <div key={a.txId} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-800/40 px-2.5 py-1.5">
                  <AttIcon type={a.type} />
                  <button onClick={() => openAttachment(a)} disabled={opening === a.txId} title={`Open ${a.name}`} className="min-w-0 flex-1 truncate text-left text-xs text-slate-200 hover:text-indigo-300 hover:underline disabled:opacity-60">{opening === a.txId ? "opening…" : a.name}</button>
                  {!readOnly && (
                    <button onClick={() => removeAttachment(a.txId)} title="Remove" aria-label="Remove attachment" className="shrink-0 text-slate-600 hover:text-red-400">
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                  )}
                </div>
              ))}
              {t.attachments.length === 0 && readOnly && <p className="text-[11px] text-slate-600">No attachments</p>}
              {!readOnly && (
                <button onClick={() => setAttachOpen(true)} className="flex items-center gap-1.5 rounded-lg border border-dashed border-slate-700 px-2.5 py-1.5 text-[11px] text-slate-400 hover:border-indigo-500 hover:text-indigo-300">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21.44 11.05l-9.19 9.19a5 5 0 01-7.07-7.07l9.19-9.19a3 3 0 014.24 4.24l-9.2 9.19a1 1 0 01-1.41-1.41l8.49-8.49" /></svg>
                  Attach files
                </button>
              )}
            </div>
          </div>

          {/* sub-tickets (parent/child) — manage children when editing a ticket */}
          {!create && (
            <div>
              <label className={lbl}>Sub-tickets ({children.length})</label>
              <div className="space-y-1.5">
                {children.map((c) => (
                  <div key={c.id} className="group flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-800/40 px-2.5 py-1.5">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${priorityMeta(c.priority).dot}`} />
                    <span className="shrink-0 text-[10px] font-medium text-slate-500">{code}-{c.num}</span>
                    <button onClick={() => onOpenTicket?.(c.id)} className="min-w-0 flex-1 truncate text-left text-xs text-slate-200 hover:text-indigo-300 hover:underline">{c.title?.trim() || "Untitled"}</button>
                    {!readOnly && (
                      <button onClick={() => onLinkChild?.(c.id, null)} title="Remove sub-ticket" aria-label="Remove sub-ticket" className="shrink-0 text-slate-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100">
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
                      </button>
                    )}
                  </div>
                ))}
                {children.length === 0 && readOnly && <p className="text-[11px] text-slate-600">No sub-tickets</p>}
                {!readOnly && (
                  <>
                    <div className="flex items-center gap-1.5">
                      <input value={childTitle} onChange={(e) => setChildTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addChild(); } }} placeholder="Create a sub-ticket…" className={field} />
                      <button onClick={addChild} disabled={!childTitle.trim()} title="Create sub-ticket" aria-label="Create sub-ticket" className="shrink-0 rounded-lg bg-indigo-600 p-1.5 text-white hover:bg-indigo-500 disabled:opacity-50">
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
                      </button>
                    </div>
                    {linkable.length > 0 && (
                      <ThemedCombo value="" options={linkable.map((x) => ({ value: x.id, label: tkLabel(x) }))} onChange={(id) => { if (id) onLinkChild?.(id, t.id); }} placeholder="Link an existing ticket…" />
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* comments only when editing an existing ticket */}
          {!create && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Comments ({t.comments.length})</span>
                {t.comments.length > 1 && (
                  <button
                    onClick={() => setCommentSort((s) => (s === "newest" ? "oldest" : "newest"))}
                    title={commentSort === "newest" ? "Newest first (click for oldest first)" : "Oldest first (click for newest first)"}
                    className="flex h-6 w-6 items-center justify-center rounded-md border border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200 transition-colors"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      {commentSort === "oldest"
                        ? <path strokeLinecap="round" strokeLinejoin="round" d="M5 11l7-7 7 7M12 4v16" />
                        : <path strokeLinecap="round" strokeLinejoin="round" d="M19 13l-7 7-7-7M12 20V4" />}
                    </svg>
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {[...t.comments].sort((a, b) => (commentSort === "newest" ? b.createdAt - a.createdAt : a.createdAt - b.createdAt)).map((c) => (
                  <div key={c.id} className="group rounded-lg border border-slate-800 bg-slate-800/40 px-2.5 py-1.5">
                    <div className="mb-0.5 flex items-center gap-2">
                      {(() => { const au = authorOf(c.author); return au ? <button onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); showUserCard({ address: au.address, label: au.name, rect: { top: r.top, left: r.left, bottom: r.bottom } }); }} className="text-[11px] font-medium text-indigo-300 hover:text-indigo-200 hover:underline">{au.name}</button> : <span className="text-[11px] font-medium text-slate-300">{c.author}</span>; })()}
                      <span className="text-[10px] text-slate-500">{fmtWhen(c.createdAt)}</span>
                      {!readOnly && (confirmCmt === c.id ? (
                        <span className="ml-auto flex items-center gap-1.5">
                          <span className="text-[10px] text-slate-400">Delete?</span>
                          <button onClick={() => { onDeleteComment(c.id); setConfirmCmt(null); }} title="Confirm" className="text-red-400 hover:text-red-300">
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                          </button>
                          <button onClick={() => setConfirmCmt(null)} title="Cancel" className="text-slate-500 hover:text-slate-300">
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
                          </button>
                        </span>
                      ) : (
                        <button onClick={() => setConfirmCmt(c.id)} title="Delete comment" aria-label="Delete comment" className="ml-auto text-slate-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100">
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M10 11v6M14 11v6" /></svg>
                        </button>
                      ))}
                    </div>
                    <RichTextView html={c.text} className="text-xs text-slate-300" />
                  </div>
                ))}
                {t.comments.length === 0 && readOnly && <p className="text-[11px] text-slate-600">No comments</p>}
                {!readOnly && (
                  <div>
                    <RichTextEditor key={`c-${commentKey}`} value="" onChange={setComment} placeholder="Write a comment…" compact address={address} />
                    <div className="mt-1 flex items-center gap-2">
                      <button onClick={submitComment} disabled={isEmptyHtml(comment)} className="rounded bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-indigo-500 disabled:opacity-50">Comment</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* footer */}
        <div className="flex items-center justify-between gap-2 border-t border-slate-800 px-4 py-2.5 shrink-0">
          {create ? (
            <>
              <span className="text-[10px] text-slate-600">Will be {code}-{t.num}</span>
              <div className="flex items-center gap-2">
                <button onClick={onClose} className="text-[11px] text-slate-400 hover:text-slate-200">Cancel</button>
                <button onClick={() => t.title.trim() && onCreate?.({ ...t, title: t.title.trim() })} disabled={!t.title.trim()} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-indigo-500 disabled:opacity-50">Create ticket</button>
              </div>
            </>
          ) : (
            <>
              <span className="text-[10px] text-slate-600">{t.createdBy ? `By ${t.createdBy} · ` : ""}Updated {fmtWhen(t.updatedAt)}</span>
              {readOnly ? (
                <span className="text-[10px] text-slate-600">View only</span>
              ) : confirmDel ? (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-400">Delete?</span>
                  <button onClick={onDelete} className="rounded bg-red-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-red-500">Yes, delete</button>
                  <button onClick={() => setConfirmDel(false)} className="text-[11px] text-slate-400 hover:text-slate-200">Cancel</button>
                </div>
              ) : (
                <button onClick={() => setConfirmDel(true)} className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-slate-400 hover:border-red-500/50 hover:text-red-400 transition-colors">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M10 11v6M14 11v6" /></svg>
                  Delete
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {attachOpen && (
        <AttachPicker
          address={address}
          existing={t.attachments.map((a) => a.txId)}
          onClose={() => setAttachOpen(false)}
          onAttach={handleAttach}
          onToast={onToast}
        />
      )}
    </div>,
    document.body,
  );
}

const today = () => new Date().toISOString().slice(0, 10);
function newLog(author: string): WorkLog {
  return { id: newId(), title: "", date: today(), from: null, to: null, hours: 0, description: "", author, createdAt: Date.now() };
}
// Decimal hours between two HH:MM times (handles an overnight wrap).
function computeHours(from: string, to: string): number {
  if (!from || !to) return 0;
  const [fh, fm] = from.split(":").map(Number);
  const [th, tm] = to.split(":").map(Number);
  if ([fh, fm, th, tm].some((n) => !Number.isFinite(n))) return 0;
  let mins = th * 60 + tm - (fh * 60 + fm);
  if (mins < 0) mins += 24 * 60;
  return Math.round((mins / 60) * 100) / 100;
}

// Normalize a typed time to "HH:MM": fills in missing minutes with :00 (so "11" or
// "11:" → "11:00"), accepts "1130" → "11:30", and clamps to a valid 24h time. Used so
// entering just the hour still produces worked hours. Returns "" for blank.
function normalizeTime(s: string): string {
  const t = (s || "").trim();
  if (!t) return "";
  let h: number, m: number;
  if (t.includes(":")) {
    const [hp, mp] = t.split(":");
    h = parseInt(hp, 10);
    m = mp ? parseInt(mp, 10) : 0;
  } else if (/^\d+$/.test(t)) {
    if (t.length <= 2) { h = parseInt(t, 10); m = 0; }
    else { h = parseInt(t.slice(0, t.length - 2), 10); m = parseInt(t.slice(-2), 10); }
  } else {
    return t; // leave anything unparseable as-is
  }
  if (!Number.isFinite(h)) return "";
  if (!Number.isFinite(m)) m = 0;
  h = Math.min(23, Math.max(0, h));
  m = Math.min(59, Math.max(0, m));
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Text input that accepts/echoes durations ("2h 30m") but stores
// decimal hours; reformats to the canonical form on blur.
function DurationInput({ value, onChange, disabled, placeholder, className }: { value: number | null; onChange: (h: number | null) => void; disabled?: boolean; placeholder?: string; className?: string }) {
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(value != null ? fmtDuration(value) : "");
  useEffect(() => { if (!focused) setText(value != null ? fmtDuration(value) : ""); }, [value, focused]);
  return (
    <input
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); onChange(parseDuration(text)); }}
      className={className}
    />
  );
}

function WorkLogForm({ entry, people, onCancel, onSave }: { entry: WorkLog; people: import("@/lib/mentions").MentionPerson[]; onCancel: () => void; onSave: (w: WorkLog) => void }) {
  const [title, setTitle] = useState(entry.title ?? "");
  const [date, setDate] = useState(entry.date);
  const [from, setFrom] = useState(entry.from ?? "");
  const [to, setTo] = useState(entry.to ?? "");
  const [desc, setDesc] = useState(entry.description);
  // Worked hours are ALWAYS derived from the From→To range — no manual entry. "11"/"11:"
  // normalizes to "11:00", and BOTH From and To are required to log time.
  const nf = normalizeTime(from);
  const nt = normalizeTime(to);
  const computed = computeHours(nf, nt); // decimal hours from the time range
  const valid = !!date && !!nf && !!nt && computed > 0;
  const save = () => { if (valid) onSave({ ...entry, title: title.trim(), date, from: nf, to: nt, hours: Math.round(computed * 100) / 100, description: desc.trim() }); };
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-slate-700 bg-slate-800 p-2.5">
      <MentionInput value={title} onChange={setTitle} people={people} placeholder="What did you work on? — @ to mention" className={field} />
      <div className="grid grid-cols-3 gap-2">
        <div><label className={lbl}>Date</label><DateInput value={date} onChange={setDate} className={field} /></div>
        <div><label className={lbl}>From</label><TimeField value={from} onChange={setFrom} className={field} /></div>
        <div><label className={lbl}>To</label><TimeField value={to} onChange={setTo} className={field} /></div>
      </div>
      <div className="flex items-center gap-2 px-0.5 text-xs">
        <span className="text-slate-500">Worked</span>
        <span className="font-semibold text-slate-100 tabular-nums">{computed > 0 ? fmtDuration(computed) : "—"}</span>
        {!valid && <span className="ml-auto text-[10px] text-slate-500">{!date ? "Pick a date" : "Enter both From and To"}</span>}
      </div>
      <MentionInput multiline value={desc} onChange={setDesc} people={people} rows={2} placeholder="Notes — @ to mention" className={`${field} resize-none`} />
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={!valid} className="rounded bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-indigo-500 disabled:opacity-50">Save</button>
        <button onClick={onCancel} className="text-[11px] text-slate-400 hover:text-slate-200">Cancel</button>
      </div>
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
