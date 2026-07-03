"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Node as TiptapNode, mergeAttributes, InputRule } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { ticketKeyIndex, ticketLinkTargets } from "@/lib/board";
import { eventRefIndex, eventLinkTargets } from "@/lib/calendar";
import { itsmKeyIndex, itsmLinkTargets, itsmMeta, type ItsmType } from "@/lib/itsm";

// A live reference chip for the Documentation editor — the same idea as chat's
// ticket/event chips, but as a Tiptap inline atom node so it survives in the saved
// doc HTML and re-resolves on render (a renamed board / event title updates here).
// Only the stable token (CODE-NUM or EVT-<id>) is stored; the label is resolved
// against THIS wallet's own boards/events, so access is never widened.

export type RefKind = "ticket" | "event" | "itsm";
export type InsertRef = { token: string; label: string; kind: RefKind };

export interface RefChipOptions {
  address: string | null;
  onOpenTicket?: (boardId: string, ticketId: string) => void;
  onOpenEvent?: (eventId: string) => void;
  onOpenItsm?: (recordId: string) => void;
}

type ResolvedRef = {
  kind: RefKind;
  token: string;
  label: string;
  title?: string;
  boardCode?: string;
  boardTitle?: string;
  eventId?: string;
  boardId?: string;
  ticketId?: string;
  itsmId?: string;
  itsmType?: ItsmType;
  state?: string;
};

// A Service Desk record number: INC/REQ/CHG/PRB followed by digits.
const ITSM_RE = /^(?:INC|REQ|CHG|PRB)\d+$/;

// token → display/target info (or null if it doesn't resolve for this wallet).
export function resolveToken(token: string, address: string | null): ResolvedRef | null {
  if (!token || !address) return null;
  if (token.startsWith("EVT-")) {
    const ev = eventRefIndex(address)[token];
    return ev ? { kind: "event", token, label: (ev.boardCode ? ev.boardCode + " · " : "") + ev.title, title: ev.title, boardCode: ev.boardCode, boardTitle: ev.boardTitle, eventId: ev.eventId } : null;
  }
  const up = token.toUpperCase();
  if (ITSM_RE.test(up)) {
    const rec = itsmKeyIndex(address)[up];
    return rec ? { kind: "itsm", token: up, label: up, title: rec.short, itsmId: rec.id, itsmType: rec.type, state: rec.state } : null;
  }
  const hit = ticketKeyIndex(address)[up];
  return hit ? { kind: "ticket", token: up, label: up, boardId: hit.boardId, ticketId: hit.ticketId, boardTitle: hit.boardTitle } : null;
}

const CHIP = "inline-flex max-w-[15rem] items-center gap-1 rounded px-1.5 align-baseline text-[0.92em] font-medium ring-1 select-none";

function EvtIcon() {
  return <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="4.5" width="18" height="16" rx="2" /><path strokeLinecap="round" d="M3 9h18M8 2.5v4M16 2.5v4" /></svg>;
}
function TagIcon() {
  // Board-ticket card — the same mark used on the Timesheet "Board ticket" tile.
  return <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="4" y="5" width="16" height="14" rx="2" /><path strokeLinecap="round" d="M8 10h8M8 14h5" /></svg>;
}
function ItsmIcon() {
  return <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M5.5 13V11.5A6.5 6.5 0 0 1 18.5 11.5V13" /><rect x="3.7" y="12" width="3.5" height="5.5" rx="1.7" /><rect x="16.8" y="12" width="3.5" height="5.5" rx="1.7" /><path strokeLinecap="round" strokeLinejoin="round" d="M5.45 17.5V19A2.3 2.3 0 0 0 7.75 21.3H8.2" /><rect x="8" y="19.8" width="3.2" height="3" rx="1.5" /></svg>;
}

function RefChipView({ node, editor, extension }: NodeViewProps) {
  const token = (node.attrs.token as string) || "";
  const storedLabel = (node.attrs.label as string) || token;
  const opts = extension.options as RefChipOptions;

  // The node view doesn't re-render on setEditable, so track it ourselves (the chip
  // is a plain pill while editing, a clickable link in read mode — like chat).
  const [editable, setEditable] = useState(editor.isEditable);
  useEffect(() => {
    const sync = () => setEditable(editor.isEditable);
    editor.on("transaction", sync);
    editor.on("update", sync);
    return () => { editor.off("transaction", sync); editor.off("update", sync); };
  }, [editor]);

  const ref = useMemo(() => resolveToken(token, opts.address ?? null), [token, opts.address]);
  const kind: RefKind = ref?.kind ?? (
    ((node.attrs.kind as string) === "event" || token.startsWith("EVT-")) ? "event"
      : ((node.attrs.kind as string) === "itsm" || ITSM_RE.test(token.toUpperCase())) ? "itsm"
        : "ticket"
  );

  // Unresolved (rare — docs are personal to their author): show a muted, inert pill
  // rather than a raw token.
  if (!ref) {
    return (
      <NodeViewWrapper as="span" className="inline align-baseline" contentEditable={false}>
        <span className={`${CHIP} bg-slate-700/40 text-slate-400 ring-slate-600/40`}>{kind === "event" ? <EvtIcon /> : kind === "itsm" ? <ItsmIcon /> : <TagIcon />}<span className="truncate">{storedLabel || (kind === "event" ? "event" : kind === "itsm" ? "record" : "ticket")}</span></span>
      </NodeViewWrapper>
    );
  }

  const cls = kind === "event" ? "bg-emerald-500/15 text-emerald-200 ring-emerald-500/30"
    : kind === "itsm" ? (ref.itsmType ? itsmMeta(ref.itsmType).chip : "bg-rose-500/15 text-rose-200 ring-rose-500/30")
      : "bg-indigo-500/15 text-indigo-200 ring-indigo-500/30";
  const inner = kind === "event"
    ? <><EvtIcon />{ref.boardCode && <span className="font-semibold opacity-80">{ref.boardCode}</span>}<span className="truncate">{ref.title}</span></>
    : kind === "itsm"
      ? <><ItsmIcon /><span className="font-mono">{ref.token}</span></>
      : <><TagIcon /><span className="font-mono">{ref.token}</span></>;
  const open = () => { if (kind === "event") opts.onOpenEvent?.(ref.eventId!); else if (kind === "itsm") opts.onOpenItsm?.(ref.itsmId!); else opts.onOpenTicket?.(ref.boardId!, ref.ticketId!); };
  const clickable = !editable && ((kind === "event" && !!opts.onOpenEvent) || (kind === "itsm" && !!opts.onOpenItsm) || (kind === "ticket" && !!opts.onOpenTicket));

  return (
    <NodeViewWrapper as="span" className="inline align-baseline" contentEditable={false}>
      {clickable ? (
        <button type="button" onClick={open} title={kind === "event" ? `Open event · ${ref.boardTitle ? ref.boardTitle + " · " : ""}${ref.title}` : kind === "itsm" ? `Open ${ref.token}${ref.title ? " · " + ref.title : ""}` : `Open ${ref.token} · ${ref.boardTitle}`} className={`${CHIP} ${cls} hover:opacity-90`}>{inner}</button>
      ) : (
        <span className={`${CHIP} ${cls}`}>{inner}</span>
      )}
    </NodeViewWrapper>
  );
}

export const RefChip = TiptapNode.create<RefChipOptions>({
  name: "refChip",
  inline: true,
  group: "inline",
  atom: true,
  selectable: true,
  addOptions() {
    return { address: null, onOpenTicket: undefined, onOpenEvent: undefined, onOpenItsm: undefined };
  },
  addAttributes() {
    return {
      token: { default: "", parseHTML: (el) => (el as HTMLElement).getAttribute("data-ref") || "", renderHTML: (a) => (a.token ? { "data-ref": a.token as string } : {}) },
      kind: { default: "ticket", parseHTML: (el) => (el as HTMLElement).getAttribute("data-kind") || "ticket", renderHTML: (a) => ({ "data-kind": (a.kind as string) || "ticket" }) },
      label: { default: "", parseHTML: (el) => (el as HTMLElement).getAttribute("data-label") || (el as HTMLElement).textContent || "", renderHTML: (a) => (a.label ? { "data-label": a.label as string } : {}) },
    };
  },
  parseHTML() { return [{ tag: "span[data-ref]" }]; },
  renderHTML({ HTMLAttributes, node }) {
    // The text child keeps the doc readable even if rendered without the node view.
    return ["span", mergeAttributes(HTMLAttributes), (node.attrs.label as string) || (node.attrs.token as string) || ""];
  },
  addNodeView() { return ReactNodeViewRenderer(RefChipView); },
  addInputRules() {
    const type = this.type;
    const getAddr = () => this.options.address ?? null;
    return [
      // Typing a ticket key / EVT token followed by a space auto-formats it to a chip
      // (mirrors chat's space-triggered auto-chip). The event alt is first so a token
      // isn't mis-split. Same tr math as Tiptap's nodeInputRule, but it bails (leaves
      // plain text) when the token doesn't resolve for this wallet.
      new InputRule({
        find: /(?:^|\s)((?:EVT-[A-Za-z0-9_-]{4,}|(?:INC|REQ|CHG|PRB|inc|req|chg|prb)\d{1,9}|[A-Za-z][A-Za-z0-9]{1,15}-\d{1,6}))(\s)$/,
        handler: ({ state, range, match }) => {
          const ref = resolveToken(match[1], getAddr());
          if (!ref) return null;
          const { tr } = state;
          const start = range.from;
          let end = range.to;
          const newNode = type.create({ token: ref.token, kind: ref.kind, label: ref.label });
          const offset = match[0].lastIndexOf(match[1]);
          let matchStart = start + offset;
          if (matchStart > end) matchStart = end;
          else end = matchStart + match[1].length;
          const lastChar = match[0][match[0].length - 1];
          tr.insertText(lastChar, start + match[0].length - 1);
          tr.replaceWith(matchStart, end, newNode);
        },
      }),
    ];
  },
});

// The "+" popover for the editor toolbar — searches this wallet's board tickets and
// calendar events (same targets as chat's link picker), anchored under the button.
export function RefPicker({ address, boardId, onInsert, onClose }: { address: string; boardId?: string; onInsert: (ref: InsertRef) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  // In Documentation the picker is scoped to the page's board, so it only offers
  // that board's tickets (all its projects) and its calendar events.
  const tickets = useMemo(() => { const all = ticketLinkTargets(address); return boardId ? all.filter((t) => t.boardId === boardId) : all; }, [address, boardId]);
  const events = useMemo(() => { const all = eventLinkTargets(address); return boardId ? all.filter((e) => e.boardId === boardId) : all; }, [address, boardId]);
  // Service Desk records aren't board-scoped — always offered (referencing an incident from a
  // board-scoped doc is valid).
  const records = useMemo(() => itsmLinkTargets(address), [address]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);
  const term = q.trim().toLowerCase();
  const tHits = (term ? tickets.filter((t) => t.key.toLowerCase().includes(term) || t.title.toLowerCase().includes(term)) : tickets).slice(0, 8);
  const eHits = (term ? events.filter((e) => e.title.toLowerCase().includes(term)) : events).slice(0, 8);
  const rHits = (term ? records.filter((r) => r.token.toLowerCase().includes(term) || r.label.toLowerCase().includes(term)) : records).slice(0, 8);
  return (
    <div ref={boxRef} className="absolute left-0 top-full z-30 mt-1 w-80 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }} placeholder="Search tickets, events & records…" className="w-full border-b border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none" />
      <div className="max-h-64 overflow-y-auto p-1">
        {tHits.length === 0 && eHits.length === 0 && rHits.length === 0 && <p className="px-2 py-5 text-center text-[11px] text-slate-600">Nothing to link yet — create a ticket, event or Service Desk record first.</p>}
        {tHits.length > 0 && <p className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Board tickets</p>}
        {tHits.map((t) => (
          <button key={`${t.boardId}:${t.ticketId}`} type="button" onClick={() => onInsert({ token: t.key, label: t.key, kind: "ticket" })} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-800">
            <span className="flex shrink-0 items-center gap-1 rounded bg-indigo-500/20 px-1.5 py-0.5 font-mono text-[10px] text-indigo-200"><TagIcon />{t.key}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{t.title}</span>
            <span className="shrink-0 truncate text-[10px] text-slate-500">{t.boardTitle}</span>
          </button>
        ))}
        {eHits.length > 0 && <p className="px-2 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Calendar events</p>}
        {eHits.map((ev) => (
          <button key={ev.eventId} type="button" onClick={() => onInsert({ token: ev.token, label: (ev.boardCode ? ev.boardCode + " · " : "") + ev.title, kind: "event" })} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-800">
            <span className="flex shrink-0 items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-200"><EvtIcon />{ev.boardCode || "Event"}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{ev.title}</span>
            <span className="shrink-0 text-[10px] text-slate-500">{ev.date}</span>
          </button>
        ))}
        {rHits.length > 0 && <p className="px-2 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Service Desk</p>}
        {rHits.map((r) => (
          <button key={r.token} type="button" onClick={() => onInsert({ token: r.token, label: r.token, kind: "itsm" })} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-800">
            <span className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] ring-1 ring-inset ${itsmMeta(r.type).chip}`}><ItsmIcon />{r.token}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{r.label}</span>
            <span className="shrink-0 text-[10px] text-slate-500">{r.state}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
