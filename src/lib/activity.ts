// Aggregates one wallet's recent activity across the app, from the data the current
// viewer can actually see (their boards, Service-Desk teams, calendar). It never widens
// access — a subject's activity only shows where the viewer already shares the board/team.
// Documentation and Uploads are personal/local (no author record), so they only appear on
// your own profile. Each item carries a `nav` target so a click opens where it happened.
//
// Author fields are stored as a board-relative LABEL (a member's display name, and "You"
// for the author's own self-entry), not an address. So we resolve each author to an address
// PER BOARD via that board's member registry — where "You" maps to whoever is labelled "You"
// on that board (its owner-self) — and then match the subject by address. This is what makes
// another wallet's activity attribute to them rather than to whoever is viewing.

import { loadBoards, loadBoardState, fmtDuration, shortAddr, type Member } from "./board";
import type { BoardEvent } from "./boardSync";
import { allItsmRecords, itsmNumber } from "./itsm";
import { loadDocs } from "./boardDocs";
import { loadEvents } from "./calendar";
import { loadStoredUploads } from "./vault";

export type ActivitySource = "board" | "timesheet" | "calendar" | "itsm" | "docs" | "uploads";

export interface TimeDetail { title: string; hours: number; date: string; from?: string; to?: string; board: string; context?: string; kind: "worklog" | "entry" | "holiday" }

export type ActivityNav =
  | { kind: "ticket"; boardId: string; ticketId: string }
  | { kind: "timesheet"; boardId: string; who: string; detail: TimeDetail }
  | { kind: "event"; eventId: string }
  | { kind: "itsm"; recordId: string }
  | { kind: "docs"; boardId: string; pageId: string }
  | { kind: "upload"; txId: string };

export interface ActivityItem {
  id: string;
  source: ActivitySource;
  title: string;
  sub?: string;
  at: number;
  nav: ActivityNav;
}

export const ACTIVITY_SOURCES: { key: ActivitySource; label: string }[] = [
  { key: "board", label: "Boards" },
  { key: "timesheet", label: "Timesheet" },
  { key: "calendar", label: "Calendar" },
  { key: "itsm", label: "Service Desk" },
  { key: "docs", label: "Documentation" },
  { key: "uploads", label: "Uploads" },
];

// A board author (address / member label) → the member's wallet address. NOTE: we deliberately
// do NOT collapse "You" to the board owner — a worklog's author is literally "You", but that "You"
// is whoever LOGGED it (often a member, not the owner). Mapping it to the owner mis-credits every
// member's time to the owner. Such labels resolve via the event log's signer address instead.
function makeResolver(members: Member[]): (who: string | undefined | null) => string {
  const known = new Set(members.map((m) => m.address));
  const byLabel = new Map(members.map((m) => [m.label, m.address] as const));
  return (who) => {
    if (!who) return "";
    if (known.has(who)) return who;
    return byLabel.get(who) ?? who;
  };
}

// The RELIABLE source: the board event cache (gtv_boardevents_<id>) keeps the signer's wallet
// address (`by`) per event — written for your own actions immediately, and for everyone else's
// when foldBoard pulls the encrypted log from Arweave. Returned oldest-first.
function loadBoardEvents(boardId: string): { at: number; by: string; event: BoardEvent }[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(`gtv_boardevents_${boardId}`);
    if (!raw) return [];
    const cache = JSON.parse(raw) as Record<string, { at: number; by: string; event: BoardEvent }>;
    return Object.values(cache).filter((r) => r && r.event && r.by).sort((a, b) => (a.at || 0) - (b.at || 0));
  } catch { return []; }
}

export function collectActivity(viewer: string, subject: string): ActivityItem[] {
  if (!viewer || !subject) return [];
  const self = viewer === subject;
  const out: ActivityItem[] = [];

  for (const b of loadBoards(viewer)) {
    const st = loadBoardState(b.id);
    const ticketTitle = new Map(st.tickets.map((t) => [t.id, t.title] as const));
    const events = loadBoardEvents(b.id);

    if (events.length > 0) {
      // SHARED / synced board: derive activity straight from the event log. Each event keeps its
      // real signer address (`by`), so attribution is exact and survives any folded-state gating
      // or display-label quirks — and it's the same on-chain data every member sees.
      const seenWl = new Set<string>();
      const seenTs = new Set<string>();
      const updated = new Map<string, number>(); // ticketId → latest "edited/moved" time (deduped, subject only)
      for (const { at, by, event: e } of events) {
        const mine = by === subject;
        const tname = (id: string) => ticketTitle.get(id) ?? "a ticket";
        if (e.t === "ticket.create") {
          if (mine) out.push({ id: `tk-${e.ticket.id}`, source: "board", title: `Created “${e.ticket.title}”`, sub: b.title, at: e.ticket.createdAt || at, nav: { kind: "ticket", boardId: b.id, ticketId: e.ticket.id } });
        } else if (e.t === "comment.add") {
          if (mine) out.push({ id: `cm-${e.comment.id}`, source: "board", title: `Commented on “${tname(e.ticketId)}”`, sub: b.title, at: e.comment.createdAt || at, nav: { kind: "ticket", boardId: b.id, ticketId: e.ticketId } });
        } else if (e.t === "timesheet.set") {
          if (seenTs.has(e.entry.id)) continue;
          seenTs.add(e.entry.id);
          if (mine) { const ts = e.entry; out.push({ id: `ts-${ts.id}`, source: "timesheet", title: ts.title || (ts.kind === "holiday" ? "Time off" : ts.hours ? `Logged ${fmtDuration(ts.hours)}` : "Time entry"), sub: `${b.title} · ${ts.date}`, at: ts.updatedAt || at, nav: { kind: "timesheet", boardId: b.id, who: subject, detail: { title: ts.title || (ts.kind === "holiday" ? "Time off" : "Time entry"), hours: ts.hours, date: ts.date, from: ts.from, to: ts.to, board: b.title, kind: ts.kind === "holiday" ? "holiday" : "entry" } } }); }
        } else if (e.t === "ticket.update" && e.patch.worklog) {
          for (const w of e.patch.worklog) {
            if (seenWl.has(w.id)) continue;
            seenWl.add(w.id);
            if (mine && w.hours > 0) out.push({ id: `wl-${w.id}`, source: "timesheet", title: `Logged ${fmtDuration(w.hours)}${w.title ? ` · ${w.title}` : ""}`, sub: `${b.title} · ${tname(e.ticketId)}`, at: w.createdAt || at, nav: { kind: "timesheet", boardId: b.id, who: subject, detail: { title: w.title || "Time logged", hours: w.hours, date: w.date, from: w.from ?? undefined, to: w.to ?? undefined, board: b.title, context: ticketTitle.get(e.ticketId), kind: "worklog" } } });
          }
        } else if (e.t === "ticket.update") {
          if (mine) updated.set(e.ticketId, Math.max(updated.get(e.ticketId) ?? 0, at));
        } else if (e.t === "ticket.move") {
          if (mine) updated.set(e.ticketId, Math.max(updated.get(e.ticketId) ?? 0, at));
        }
      }
      // One "Updated" row per ticket the subject touched (moves / field edits) — keeps it un-noisy.
      for (const [ticketId, at] of updated) out.push({ id: `up-${ticketId}`, source: "board", title: `Updated “${ticketTitle.get(ticketId) ?? "a ticket"}”`, sub: b.title, at, nav: { kind: "ticket", boardId: b.id, ticketId } });
    } else if (self && !b.shared) {
      // PERSONAL (unshared) board with no event log: everything on it is yours.
      for (const t of st.tickets) {
        out.push({ id: `tk-${t.id}`, source: "board", title: `Created “${t.title}”`, sub: b.title, at: t.createdAt, nav: { kind: "ticket", boardId: b.id, ticketId: t.id } });
        for (const w of t.worklog) if (w.hours > 0) out.push({ id: `wl-${w.id}`, source: "timesheet", title: `Logged ${fmtDuration(w.hours)}${w.title ? ` · ${w.title}` : ""}`, sub: `${b.title} · ${t.title}`, at: w.createdAt, nav: { kind: "timesheet", boardId: b.id, who: subject, detail: { title: w.title || "Time logged", hours: w.hours, date: w.date, from: w.from ?? undefined, to: w.to ?? undefined, board: b.title, context: t.title, kind: "worklog" } } });
        for (const c of t.comments) out.push({ id: `cm-${c.id}`, source: "board", title: `Commented on “${t.title}”`, sub: b.title, at: c.createdAt, nav: { kind: "ticket", boardId: b.id, ticketId: t.id } });
      }
      for (const ts of st.timesheets ?? []) out.push({ id: `ts-${ts.id}`, source: "timesheet", title: ts.title || (ts.kind === "holiday" ? "Time off" : ts.hours ? `Logged ${fmtDuration(ts.hours)}` : "Time entry"), sub: `${b.title} · ${ts.date}`, at: ts.updatedAt, nav: { kind: "timesheet", boardId: b.id, who: subject, detail: { title: ts.title || (ts.kind === "holiday" ? "Time off" : "Time entry"), hours: ts.hours, date: ts.date, from: ts.from, to: ts.to, board: b.title, kind: ts.kind === "holiday" ? "holiday" : "entry" } } });
    }
  }

  // Service Desk activity — resolve the actor against the record's board members.
  const boardMembers = new Map<string, Member[]>();
  for (const b of loadBoards(viewer)) boardMembers.set(b.id, loadBoardState(b.id).members);
  const subjShort = shortAddr(subject);
  for (const r of allItsmRecords(viewer)) {
    const resolve = makeResolver(boardMembers.get(r.boardId ?? "") ?? []);
    // ITSM stores the actor as a shortened address (shortAddr) — match that too. A private
    // record (no shared board) is the viewer's own.
    const personal = !r.boardId;
    const isSubj = (who: string | undefined | null) => !!who && (who === subject || who === subjShort || resolve(who) === subject || (self && personal));
    for (const a of r.activity) if (isSubj(a.by)) out.push({ id: `it-${r.id}-${a.id}`, source: "itsm", title: `${itsmNumber(r)} — ${a.text || a.kind}`, sub: r.shortDescription || undefined, at: a.at, nav: { kind: "itsm", recordId: r.id } });
  }

  for (const ev of loadEvents(viewer)) {
    const owned = ev.owner === subject || (self && !ev.owner);
    const invited = ev.invitees?.some((i) => i.address === subject);
    if (owned || invited) out.push({ id: `ev-${ev.id}`, source: "calendar", title: ev.title || "(event)", sub: owned ? "Organiser" : "Invited", at: ev.createdAt, nav: { kind: "event", eventId: ev.id } });
  }

  // Documentation + Uploads are local to this browser/wallet, so only on your own profile.
  if (self) {
    for (const b of loadBoards(viewer)) {
      for (const d of loadDocs(b.id)) {
        if (d.kind === "whiteboard") continue;
        const edited = d.updatedAt > d.createdAt + 1000;
        out.push({ id: `dc-${d.id}-${edited ? "e" : "c"}`, source: "docs", title: `${edited ? "Edited" : "Created"} “${d.title || "Untitled"}”`, sub: b.title, at: d.updatedAt, nav: { kind: "docs", boardId: b.id, pageId: d.id } });
      }
    }
    for (const u of loadStoredUploads(viewer)) out.push({ id: `up-${u.txId}`, source: "uploads", title: `Uploaded ${u.originalName}`, sub: u.documentType || undefined, at: u.uploadedAt, nav: { kind: "upload", txId: u.txId } });
  }

  return out.sort((a, b) => b.at - a.at);
}
