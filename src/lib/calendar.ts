// Calendar: personal events (meetings / tasks / reminders) plus a read-only view of
// board ticket due dates, so the user has tasks, tickets and meetings in one place.
// Local to this wallet on the device (like documentation).

import { loadBoards, loadBoardState, boardCode } from "./board";

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);

export type CalEventType = "meeting" | "task" | "event" | "reminder";

export type RecurFreq = "daily" | "weekly" | "monthly";
export interface Recurrence {
  freq: RecurFreq;
  interval: number; // every N days / weeks / months (1, 2, 3…)
  weekdays?: number[]; // weekly only: 0(Sun)–6(Sat); empty = the start day
  until?: string | null; // yyyy-mm-dd inclusive end, or null = forever
}

// A board ticket an event (usually a task) is linked to.
export interface TicketRef { boardId: string; ticketId: string; key: string; title: string }

export interface CalEvent {
  id: string;
  title: string;
  date: string; // yyyy-mm-dd (the series start / anchor)
  time?: string; // HH:MM
  endTime?: string; // HH:MM
  type: CalEventType;
  location?: string;
  lat?: number; // resolved coordinates of `location` (for the map preview)
  lon?: number;
  notes?: string;
  link?: string; // optional URL for any event (meeting room, doc, etc.)
  ticketRef?: TicketRef | null; // a linked board ticket (task events)
  boardId?: string | null; // a board this event belongs to (chat naming + who can be invited)
  projectId?: string | null; // optional project within that board (context)
  invitees?: { address: string; label: string }[]; // people invited (shared to their calendars)
  owner?: string; // wallet that owns the event (set on shared events; mine when undefined)
  recurrence?: Recurrence | null; // repeat rule (null = one-off)
  exdates?: string[]; // occurrence dates removed from a recurring series
  links?: string[]; // related reference tokens (tickets, other events, Service Desk records)
  meetingLink?: string; // deprecated — read via eventLink(); kept for old events
  reminders?: number[]; // minutes-before to notify (e.g. [10, 5])
  createdAt: number;
  updatedAt: number;
}

// The event's link (new `link` field, falling back to the old `meetingLink`).
export const eventLink = (e: CalEvent): string => (e.link ?? e.meetingLink ?? "").trim();

// Enhance a Jitsi room link with the participant's name + a smooth join (chat is on by
// default in Jitsi). External links (Zoom/Meet/Teams) are returned untouched.
export function meetingJoinUrl(link: string, displayName?: string): string {
  if (!link || !isJitsiUrl(link)) return link;
  const parts = ["config.prejoinPageEnabled=false", "config.startWithAudioMuted=true"];
  if (displayName) parts.push(`userInfo.displayName=${encodeURIComponent(`"${displayName}"`)}`);
  return `${link}${link.includes("#") ? "&" : "#"}${parts.join("&")}`;
}

// A maps link to view a location's address.
export const mapsUrl = (location: string): string => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;

// An embeddable OpenStreetMap view (no API key) centred on a point with a marker.
export function osmEmbedUrl(lat: number, lon: number): string {
  const d = 0.004;
  const bbox = `${lon - d},${lat - d},${lon + d},${lat + d}`;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${lat},${lon}`;
}

// Address search via Nominatim (OpenStreetMap) — free, no key/sign-up. NOTE: the typed
// text is sent to nominatim.openstreetmap.org to resolve places (no offline geocoding).
export interface PlaceHit { label: string; lat: number; lon: number }
interface NominatimResult { lat: string; lon: string; display_name: string; address?: { house_number?: string } }

// Drop duplicates AND collapse near-identical results — e.g. several segments of the
// same street that differ only by the locality (street + postcode + country signature).
function dedupeHits(hits: PlaceHit[]): PlaceHit[] {
  const seen = new Set<string>();
  const out: PlaceHit[] = [];
  for (const h of hits) {
    const p = h.label.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const sig = p.length >= 2 ? `${p[0]}|${p[p.length - 2]}|${p[p.length - 1]}` : h.label.toLowerCase();
    if (seen.has(sig)) continue;
    seen.add(sig); out.push(h);
  }
  return out;
}

export async function placeSearch(q: string, signal?: AbortSignal): Promise<PlaceHit[]> {
  const term = q.trim();
  if (term.length < 3) return [];
  // If the query names a house number, only keep precise (house-level) results — don't
  // offer the street or area as a near-miss.
  const wantsNumber = /(?:^|[\s,])\d{1,4}(?=[\s,]|$)/.test(term);
  try {
    const lang = typeof navigator !== "undefined" && navigator.language ? navigator.language : "en";
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=8&accept-language=${encodeURIComponent(lang)}&q=${encodeURIComponent(term)}`, { signal });
    if (!res.ok) return [];
    const json = (await res.json()) as NominatimResult[];
    const out: PlaceHit[] = [];
    for (const r of json) {
      const lat = parseFloat(r.lat); const lon = parseFloat(r.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !r.display_name) continue;
      if (wantsNumber && !r.address?.house_number) continue;
      out.push({ label: r.display_name, lat, lon });
    }
    return dedupeHits(out);
  } catch { return []; }
}

export const REMINDER_OPTIONS: { minutes: number; label: string }[] = [
  { minutes: 0, label: "At start" },
  { minutes: 5, label: "5 min" },
  { minutes: 10, label: "10 min" },
  { minutes: 15, label: "15 min" },
  { minutes: 30, label: "30 min" },
  { minutes: 60, label: "1 hr" },
  { minutes: 1440, label: "1 day" },
];

// Generated meetings use a no-sign-in community Jitsi room: whoever opens the link
// joins and hosts with full moderator controls — no login or wallet needed, and the
// first person in is the admin.
const MEETING_HOST = "meet.ffmuc.net";
export function generateMeetingLink(): string {
  const r = (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).replace(/-/g, "").slice(0, 12);
  return `https://${MEETING_HOST}/GTV-${r}`;
}
// Recognise Jitsi-family links (incl. legacy meet.jit.si) so join URLs get enhanced.
export const isJitsiUrl = (url: string): boolean => /(jit\.si|jitsi|ffmuc|8x8\.vc)/i.test(url);

export const EVENT_TYPES: { id: CalEventType; label: string; dot: string; chip: string }[] = [
  { id: "meeting", label: "Meeting", dot: "bg-indigo-400", chip: "bg-indigo-500/15 text-indigo-200 border-indigo-500/30" },
  { id: "task", label: "Task", dot: "bg-amber-400", chip: "bg-amber-500/15 text-amber-200 border-amber-500/30" },
  { id: "event", label: "Event", dot: "bg-emerald-400", chip: "bg-emerald-500/15 text-emerald-200 border-emerald-500/30" },
  { id: "reminder", label: "Reminder", dot: "bg-sky-400", chip: "bg-sky-500/15 text-sky-200 border-sky-500/30" },
];
export const eventTypeMeta = (t: CalEventType) => EVENT_TYPES.find((x) => x.id === t) ?? EVENT_TYPES[0];

const key = (addr: string) => `gtv_calendar_${addr}`;

export function loadEvents(addr: string | null): CalEvent[] {
  if (!addr || typeof window === "undefined") return [];
  try { const raw = localStorage.getItem(key(addr)); return raw ? (JSON.parse(raw) as CalEvent[]) : []; } catch { return []; }
}
export function saveEvents(addr: string | null, events: CalEvent[]): void {
  if (!addr || typeof window === "undefined") return;
  try { localStorage.setItem(key(addr), JSON.stringify(events)); } catch {}
}

// ── personal pinned notes (private to this wallet, on a day) ────────────────────
export interface CalPin { id: string; date: string; text: string; createdAt: number }
const pinKey = (addr: string) => `gtv_calpins_${addr}`;
export function loadPins(addr: string | null): CalPin[] {
  if (!addr || typeof window === "undefined") return [];
  try { const raw = localStorage.getItem(pinKey(addr)); return raw ? (JSON.parse(raw) as CalPin[]) : []; } catch { return []; }
}
export function savePins(addr: string | null, pins: CalPin[]): void {
  if (!addr || typeof window === "undefined") return;
  try { localStorage.setItem(pinKey(addr), JSON.stringify(pins)); } catch {}
}
export const pinsByDay = (pins: CalPin[], date: string): CalPin[] => pins.filter((p) => p.date === date);

// Events shared TO me by others (folded from Arweave, cached so reminders work offline).
const sharedKey = (addr: string) => `gtv_calshared_${addr}`;
export function loadSharedEvents(addr: string | null): CalEvent[] {
  if (!addr || typeof window === "undefined") return [];
  try { const raw = localStorage.getItem(sharedKey(addr)); return raw ? (JSON.parse(raw) as CalEvent[]) : []; } catch { return []; }
}
export function saveSharedEvents(addr: string | null, events: CalEvent[]): void {
  if (!addr || typeof window === "undefined") return;
  try { localStorage.setItem(sharedKey(addr), JSON.stringify(events)); } catch {}
}

// ── chat link references (kept SEPARATE from board ticket keys) ──────────────
// Events are referenced in chat by a stable token EVT-<id> (distinct from a board
// ticket's CODE-NUM key); the rendered chip shows the event's title.
export const eventRefKey = (id: string) => `EVT-${id}`;
export interface EventRef { eventId: string; title: string; boardCode?: string; boardTitle?: string }
export function eventRefIndex(addr: string | null): Record<string, EventRef> {
  const out: Record<string, EventRef> = {};
  if (!addr) return out;
  const boards = loadBoards(addr);
  for (const e of [...loadEvents(addr), ...loadSharedEvents(addr)]) {
    const b = e.boardId ? boards.find((x) => x.id === e.boardId) : null;
    out[eventRefKey(e.id)] = { eventId: e.id, title: e.title || "Untitled event", boardCode: b ? boardCode(b.title) : undefined, boardTitle: b?.title };
  }
  return out;
}
export interface EventLinkTarget { token: string; eventId: string; title: string; date: string; type: CalEventType; boardId?: string; boardCode?: string; boardTitle?: string }
// Events (mine + shared with me) as search targets for the chat "+" link picker.
// `boardId` is carried so callers (e.g. Documentation) can scope to one board.
export function eventLinkTargets(addr: string | null): EventLinkTarget[] {
  if (!addr) return [];
  const boards = loadBoards(addr);
  return [...loadEvents(addr), ...loadSharedEvents(addr)].map((e) => {
    const b = e.boardId ? boards.find((x) => x.id === e.boardId) : null;
    return { token: eventRefKey(e.id), eventId: e.id, title: e.title || "Untitled event", date: e.date, type: e.type, boardId: e.boardId ?? undefined, boardCode: b ? boardCode(b.title) : undefined, boardTitle: b?.title };
  });
}

// Event ids whose reminders I've muted locally (e.g. an invite I don't want pinged for).
const mutedKey = (addr: string) => `gtv_calmuted_${addr}`;
export function loadMuted(addr: string | null): string[] {
  if (!addr || typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(mutedKey(addr)) || "[]"); } catch { return []; }
}
export function isMuted(addr: string | null, id: string): boolean { return loadMuted(addr).includes(id); }
export function setMuted(addr: string | null, id: string, muted: boolean): void {
  if (!addr || typeof window === "undefined") return;
  const cur = new Set(loadMuted(addr));
  if (muted) cur.add(id); else cur.delete(id);
  try { localStorage.setItem(mutedKey(addr), JSON.stringify([...cur])); } catch {}
}
export function newEvent(date: string, type: CalEventType = "meeting"): CalEvent {
  const now = Date.now();
  return { id: uid(), title: "", date, time: "", endTime: "", type, location: "", notes: "", link: "", ticketRef: null, invitees: [], recurrence: null, exdates: [], links: [], reminders: [15], createdAt: now, updatedAt: now };
}

// Board ticket due dates, surfaced read-only on the calendar.
export interface CalTicketDue { id: string; date: string; key: string; title: string; boardTitle: string }
export function boardTicketDues(addr: string | null): CalTicketDue[] {
  if (!addr) return [];
  const out: CalTicketDue[] = [];
  for (const b of loadBoards(addr)) {
    const st = loadBoardState(b.id);
    const code = boardCode(b.title);
    for (const t of st.tickets) if (t.dueDate) out.push({ id: `due_${t.id}`, date: t.dueDate, key: `${code}-${t.num}`, title: t.title || "Untitled", boardTitle: b.title });
  }
  return out;
}

// yyyy-mm-dd helpers (local time).
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function parseISO(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

// ── recurrence expansion ──
const addDaysD = (d: Date, n: number) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
const daysBetween = (a: Date, b: Date) => Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime() - new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()) / 86400000);
const weekStartD = (d: Date) => addDaysD(d, -d.getDay()); // Sunday
const weeksBetween = (a: Date, b: Date) => Math.round(daysBetween(weekStartD(a), weekStartD(b)) / 7);
const monthsBetween = (a: Date, b: Date) => (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());

export interface Occurrence extends CalEvent { seriesId: string; occDate: string }

// Concrete occurrence dates of one event within [startISO, endISO] (inclusive),
// honouring its recurrence rule, end date, and removed dates (exdates).
export function occurrencesInRange(event: CalEvent, startISO: string, endISO: string): string[] {
  const ex = new Set(event.exdates ?? []);
  const rec = event.recurrence;
  if (!rec) return (event.date >= startISO && event.date <= endISO && !ex.has(event.date)) ? [event.date] : [];
  const out: string[] = [];
  const start = parseISO(event.date);
  const interval = Math.max(1, rec.interval || 1);
  const weekdays = rec.freq === "weekly" ? (rec.weekdays?.length ? rec.weekdays : [start.getDay()]) : [];
  const dom = start.getDate();
  let d = parseISO(startISO > event.date ? startISO : event.date);
  const end = parseISO(endISO);
  for (let guard = 0; d <= end && guard < 800; guard++, d = addDaysD(d, 1)) {
    const iso = isoDate(d);
    if (iso < event.date || ex.has(iso)) continue;
    if (rec.until && iso > rec.until) break;
    let hit = false;
    if (rec.freq === "daily") hit = daysBetween(start, d) % interval === 0;
    else if (rec.freq === "weekly") hit = weekdays.includes(d.getDay()) && weeksBetween(start, d) % interval === 0;
    else if (rec.freq === "monthly") hit = d.getDate() === dom && monthsBetween(start, d) % interval === 0;
    if (hit) out.push(iso);
  }
  return out;
}

// Expand every event into its occurrences within a date range.
export function expandRange(events: CalEvent[], startISO: string, endISO: string): Occurrence[] {
  const out: Occurrence[] = [];
  for (const e of events) for (const date of occurrencesInRange(e, startISO, endISO)) out.push({ ...e, id: `${e.id}@${date}`, date, seriesId: e.id, occDate: date });
  return out;
}

// ── editing one occurrence vs the whole series ──

// Split ONE occurrence out of a recurring series into an INDEPENDENT one-off event, carrying
// `edits` (a new time, edited title/notes, a moved day…). It stops repeating and is saved and
// edited on its own from then on. The caller must add `occDate` to the series' `exdates` so the
// original occurrence is hidden (use `withExdate` below).
export function detachOccurrence(series: CalEvent, occDate: string, edits: Partial<CalEvent>): CalEvent {
  const now = Date.now();
  // Honour an explicit date change in the edits; otherwise the detached event stays on its day.
  const date = edits.date && edits.date !== series.date ? edits.date : occDate;
  return { ...series, ...edits, id: uid(), date, recurrence: null, exdates: [], createdAt: now, updatedAt: now };
}

// Add an occurrence date to a series' removed-dates list (hides that one occurrence).
export function withExdate(series: CalEvent, occDate: string): CalEvent {
  if ((series.exdates ?? []).includes(occDate)) return series;
  return { ...series, exdates: [...(series.exdates ?? []), occDate], updatedAt: Date.now() };
}

// Move/retime the WHOLE series by the delta implied by dragging one occurrence from `occDate`
// to `targetDate` (and to `newTime`/`newEndTime`). Shifts the anchor, the weekly weekdays and
// the `until` date by the same day-delta, so the entire repeating pattern moves intact. Works
// for one-off events too (delta just relocates the single date).
export function shiftSeriesTo(series: CalEvent, occDate: string, targetDate: string, newTime: string, newEndTime: string): CalEvent {
  const dayDelta = daysBetween(parseISO(occDate), parseISO(targetDate));
  const shifted = (iso: string) => isoDate(addDaysD(parseISO(iso), dayDelta));
  const rec = series.recurrence;
  const recurrence: Recurrence | null = rec
    ? { ...rec,
        weekdays: rec.freq === "weekly" && rec.weekdays?.length ? rec.weekdays.map((w) => (((w + dayDelta) % 7) + 7) % 7) : rec.weekdays,
        until: rec.until ? shifted(rec.until) : rec.until }
    : null;
  return { ...series, date: shifted(series.date), time: newTime, endTime: newEndTime, recurrence, exdates: series.exdates?.map(shifted), updatedAt: Date.now() };
}

// A short human summary of a recurrence (for chips / the editor).
export function recurrenceLabel(rec: Recurrence | null | undefined): string {
  if (!rec) return "Does not repeat";
  const n = Math.max(1, rec.interval || 1);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  if (rec.freq === "daily") return n === 1 ? "Every day" : `Every ${n} days`;
  if (rec.freq === "weekly") {
    const wd = (rec.weekdays?.length ? [...rec.weekdays].sort((a, b) => a - b) : []).map((w) => days[w]).join(", ");
    return `${n === 1 ? "Every week" : `Every ${n} weeks`}${wd ? ` on ${wd}` : ""}`;
  }
  return n === 1 ? "Every month" : `Every ${n} months`;
}
