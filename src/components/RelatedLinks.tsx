"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { resolveToken } from "./RefChipNode";
import { ticketLinkTargets } from "@/lib/board";
import { eventLinkTargets } from "@/lib/calendar";
import { itsmLinkTargets, itsmMeta, type ItsmType } from "@/lib/itsm";

type Target = { token: string; label: string; sub: string; kind: "ticket" | "event" | "itsm"; itsmType?: ItsmType; boardCode?: string };

// Small inline icons (same marks used in chat's "+" and the rich-text picker) so records,
// tickets and events read consistently wherever they appear.
const TagSvg = () => <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="4" y="5" width="16" height="14" rx="2" /><path strokeLinecap="round" d="M8 10h8M8 14h5" /></svg>;
const EvtSvg = () => <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="4.5" width="18" height="16" rx="2" /><path strokeLinecap="round" d="M3 9h18M8 2.5v4M16 2.5v4" /></svg>;
const ItsmSvg = () => <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M5.5 13V11.5A6.5 6.5 0 0 1 18.5 11.5V13" /><rect x="3.7" y="12" width="3.5" height="5.5" rx="1.7" /><rect x="16.8" y="12" width="3.5" height="5.5" rx="1.7" /><path strokeLinecap="round" strokeLinejoin="round" d="M5.45 17.5V19A2.3 2.3 0 0 0 7.75 21.3H8.2" /><rect x="8" y="19.8" width="3.2" height="3" rx="1.5" /></svg>;
const iconFor = (kind: string) => (kind === "event" ? <EvtSvg /> : kind === "itsm" ? <ItsmSvg /> : <TagSvg />);

// "Related records" — a dropdown + search MULTI-select (same logic/design as the calendar's
// Linked-ticket picker) over this wallet's board tickets/sub-tickets, calendar events and
// Service Desk records, with removable chips for what's linked. Only stable tokens are stored;
// labels resolve against this wallet's own data. Used on tickets, events AND records so the
// whole app cross-links the same way.
export function RelatedLinks({ address, links, onChange, onOpenTicket, onOpenEvent, onOpenItsm, editable = true }: {
  address: string;
  links: string[];
  onChange: (links: string[]) => void;
  onOpenTicket?: (boardId: string, ticketId: string) => void;
  onOpenEvent?: (eventId: string) => void;
  onOpenItsm?: (recordId: string) => void;
  editable?: boolean;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const targets = useMemo<Target[]>(() => {
    const recs: Target[] = itsmLinkTargets(address).map((r) => ({ token: r.token, label: r.label, sub: r.state, kind: "itsm", itsmType: r.type }));
    const tks: Target[] = ticketLinkTargets(address).map((t) => ({ token: t.key, label: t.title, sub: t.boardTitle, kind: "ticket" }));
    const evs: Target[] = eventLinkTargets(address).map((e) => ({ token: e.token, label: e.title, sub: e.date, kind: "event", boardCode: e.boardCode }));
    return [...recs, ...tks, ...evs];
  }, [address]);

  const term = q.trim().toLowerCase();
  const matches = targets.filter((t) => !links.includes(t.token) && (!term || `${t.token} ${t.label} ${t.sub}`.toLowerCase().includes(term))).slice(0, 40);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h, true); // capture — editor modals stop bubbling
    return () => document.removeEventListener("mousedown", h, true);
  }, [open]);

  const add = (token: string) => { if (!links.includes(token)) onChange([...links, token]); setQ(""); };
  const remove = (token: string) => onChange(links.filter((t) => t !== token));
  const itsmChip = (type?: ItsmType) => (type ? itsmMeta(type).chip : "bg-rose-500/15 text-rose-200 ring-rose-500/30");
  const color = (kind: string, itsmType?: ItsmType) =>
    kind === "event" ? "bg-emerald-500/15 text-emerald-200 ring-emerald-500/30"
      : kind === "itsm" ? itsmChip(itsmType)
        : "bg-indigo-500/15 text-indigo-200 ring-indigo-500/30";

  return (
    <div className="space-y-1.5">
      {links.length === 0 && !editable && <span className="text-[11px] text-slate-600">No linked records.</span>}
      {links.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {links.map((token) => {
            const r = resolveToken(token, address);
            const kind = r?.kind ?? (token.startsWith("EVT-") ? "event" : /^(INC|REQ|CHG|PRB)\d+$/i.test(token) ? "itsm" : "ticket");
            const label = r ? (r.kind === "event" ? `${r.boardCode ? r.boardCode + " · " : ""}${r.title ?? r.token}` : r.token) : token;
            const openIt = () => { if (!r) return; if (r.kind === "event") onOpenEvent?.(r.eventId!); else if (r.kind === "itsm") onOpenItsm?.(r.itsmId!); else onOpenTicket?.(r.boardId!, r.ticketId!); };
            const clickable = !!r && ((r.kind === "event" && !!onOpenEvent) || (r.kind === "itsm" && !!onOpenItsm) || (r.kind === "ticket" && !!onOpenTicket));
            return (
              <span key={token} title={r ? undefined : "This reference isn't on your data."} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${color(kind, r?.itsmType)} ${r ? "" : "opacity-60"}`}>
                {iconFor(kind)}
                {clickable ? <button type="button" onClick={openIt} className="max-w-[12rem] truncate font-mono hover:underline">{label}</button> : <span className="max-w-[12rem] truncate font-mono">{label}</span>}
                {editable && <button type="button" onClick={() => remove(token)} title="Remove link" className="opacity-60 hover:opacity-100"><svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg></button>}
              </span>
            );
          })}
        </div>
      )}
      {editable && (
        <div ref={boxRef} className="relative">
          <input value={q} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} placeholder="Search tickets, events & records to link…" className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none" />
          {open && (
            <div className="absolute left-0 right-0 z-30 mt-1 max-h-56 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
              {matches.length === 0 ? (
                <p className="px-2.5 py-2 text-[11px] text-slate-600">{targets.length === 0 ? "Nothing to link yet — create a ticket, event or record first." : "No matches."}</p>
              ) : matches.map((t) => (
                <button key={t.token} type="button" onClick={() => add(t.token)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-slate-800">
                  <span className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] ring-1 ring-inset ${color(t.kind, t.itsmType)}`}>{iconFor(t.kind)}{t.kind === "event" ? (t.boardCode || "Event") : t.token}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-200">{t.label}</span>
                  <span className="shrink-0 text-[10px] text-slate-500">{t.sub}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
