// Shared-board sync: an encrypted, append-only event log on Arweave.
//
// Mirrors the vault's sharing model (recipients.ts / sharing.ts): a per-board AES
// key encrypts every event; that key is RSA-wrapped to each member via a tiny
// signed Turbo "grant" record; clients discover boards/events via /api/gql and
// FOLD the log with a newest-wins timeline + role validation. Read access is
// cryptographic (non-members lack the key); write-authority and member removal
// are app-enforced (soft) — honest clients ignore unauthorized / post-removal
// events. A removed member who cached the key can still read NEW events (same
// tradeoff as the vault's soft-revoke). No key rotation in v1.

import {
  BoardState,
  Member,
  Role,
  Ticket,
  Comment,
  Column,
  Project,
  Status,
  TimesheetEntry,
  TimesheetStatus,
  roleRank,
  shortAddr,
  normalizeTicket,
  loadBoards,
  loadBoardState,
  saveBoardState,
  saveBoards,
  newId,
} from "./board";
import { fromBase64, toBase64 } from "./vault";
import { wrapForRecipient, fetchPublicKey, looksLikePublicKey, addressFromPublicKey } from "./recipients";
import { type DataItem } from "./turbo";
import { publishDepmRecords } from "./depmKey";

const APP_EVENT = "GTV-Board-Event";
const APP_MANIFEST = "GTV-Board";
const APP_GRANT = "GTV-Board-Grant";
const APP_REVOKE = "GTV-Board-Revoke";
const ENDPOINTS = ["https://arweave.net/graphql", "https://turbo-gateway.com/graphql"];
const DATA_GATEWAYS = ["https://turbo-gateway.com", "https://arweave.net"];

// ── board key (raw AES-256, cached like the vault master key) ──────────────────

const keyCacheKey = (boardId: string) => `gtv_boardkey_${boardId}`;

export function loadBoardKey(boardId: string): Uint8Array | null {
  if (typeof window === "undefined") return null;
  try { const b64 = localStorage.getItem(keyCacheKey(boardId)); return b64 ? fromBase64(b64) : null; } catch { return null; }
}
export function saveBoardKey(boardId: string, key: Uint8Array): void {
  try { localStorage.setItem(keyCacheKey(boardId), toBase64(key)); } catch {}
}

// Append locally-applied events to the board's event-author cache (gtv_boardevents_<id>) with the
// signer's address, so profile activity attributes them by address right away — not only after an
// Arweave fold. foldBoard adds everyone else's events (also keyed by author) on sync.
export function recordBoardEventsLocally(boardId: string, by: string, events: BoardEvent[]): void {
  if (typeof window === "undefined" || !by || events.length === 0) return;
  try {
    const ck = `gtv_boardevents_${boardId}`;
    const cache = JSON.parse(localStorage.getItem(ck) || "{}") as Record<string, { id: string; at: number; by: string; event: BoardEvent }>;
    const now = Date.now();
    for (const event of events) { const eid = `local-${newId()}`; cache[eid] = { id: eid, at: now, by, event }; }
    localStorage.setItem(ck, JSON.stringify(cache));
  } catch { /* non-critical */ }
}
export const generateBoardKey = (): Uint8Array => crypto.getRandomValues(new Uint8Array(32));

// Unwrap a board key that was RSA-wrapped to me (one wallet decrypt prompt).
export async function unwrapBoardKey(wrappedB64Url: string): Promise<Uint8Array> {
  const w = window.arweaveWallet as unknown as { decrypt(data: Uint8Array, algo: { name: string }): Promise<ArrayBuffer> };
  const raw = await w.decrypt(base64UrlToBytes(wrappedB64Url), { name: "RSA-OAEP" });
  return new Uint8Array(raw);
}

// Resolve a board's AES key: cached → return it (no prompt); else unwrap ONCE and cache it. Concurrent
// callers (the open-board sync + its 30s poll + re-renders) share a single in-flight unwrap, so the
// wallet shows ONE decrypt prompt instead of a pile-up that re-prompts every cycle.
const inflightBoardKey = new Map<string, Promise<Uint8Array | null>>();
export async function resolveBoardKey(boardId: string, wrappedB64Url: string | undefined): Promise<Uint8Array | null> {
  const cached = loadBoardKey(boardId);
  if (cached) return cached;
  if (!wrappedB64Url) return null;
  const existing = inflightBoardKey.get(boardId);
  if (existing) return existing;
  const p = (async () => {
    try {
      // Prefer the encrypted state snapshot (unlocked once by the master key) over a per-board
      // wallet decrypt prompt: wait for the initial restore, then re-check the cache. Only if the
      // snapshot doesn't carry this key do we fall back to the one-time RSA unwrap prompt.
      try {
        const { whenHydrated } = await import("./stateSync");
        await whenHydrated();
        const restored = loadBoardKey(boardId);
        if (restored) return restored;
      } catch { /* sync off / unavailable — fall through */ }
      const key = await unwrapBoardKey(wrappedB64Url);
      saveBoardKey(boardId, key);
      return key;
    } catch {
      return null; // wallet declined / failed
    } finally {
      inflightBoardKey.delete(boardId);
    }
  })();
  inflightBoardKey.set(boardId, p);
  return p;
}

// ── AES-GCM payload helpers (iv(12) || ciphertext, base64) ─────────────────────

async function importAes(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw as Uint8Array<ArrayBuffer>, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function encryptPayload(key: Uint8Array, obj: unknown): Promise<string> {
  const k = await importAes(key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, data as Uint8Array<ArrayBuffer>));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0); out.set(ct, iv.length);
  return toBase64(out);
}
async function decryptPayload<T>(key: Uint8Array, b64: string): Promise<T | null> {
  try {
    const k = await importAes(key);
    const buf = fromBase64(b64);
    const iv = buf.slice(0, 12);
    const ct = buf.slice(12);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as Uint8Array<ArrayBuffer> }, k, ct as Uint8Array<ArrayBuffer>);
    return JSON.parse(new TextDecoder().decode(pt)) as T;
  } catch { return null; }
}

function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// ── event model ───────────────────────────────────────────────────────────────

export type BoardEvent =
  | { t: "ticket.create"; ticket: Ticket }
  | { t: "ticket.update"; ticketId: string; patch: Partial<Ticket> }
  | { t: "ticket.move"; ticketId: string; status: Status; order: number }
  | { t: "ticket.delete"; ticketId: string }
  | { t: "comment.add"; ticketId: string; comment: Comment }
  | { t: "comment.delete"; ticketId: string; commentId: string }
  | { t: "member.add"; member: Member }
  | { t: "member.role"; address: string; role: Role }
  | { t: "member.remove"; address: string }
  | { t: "board.update"; title: string }
  | { t: "board.columns"; columns: Column[] }
  | { t: "board.projects"; projects: Project[] }
  | { t: "timesheet.set"; entry: TimesheetEntry }
  | { t: "timesheet.delete"; id: string; author: string }
  | { t: "timesheet.status"; id: string; status: TimesheetStatus; approvedBy?: string }
  | { t: "board.itsmbudget"; budget: Record<number, number> };

// Persisted pending-event log for a shared board: events applied locally but not yet
// confirmed on-chain. Survives reload (a refresh can't lose changes) and is re-applied on
// top of every fold until the fold confirms each event id. Shared by BoardView + TimesheetView.
export type Pending = { id: string; event: BoardEvent; published: boolean };
const pendingKey = (bid: string) => `gtv_boardpending_${bid}`;
export function loadPending(bid: string): Pending[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(pendingKey(bid)) || "[]") as Pending[]; } catch { return []; }
}
export function savePending(bid: string, list: Pending[]): void {
  try { localStorage.setItem(pendingKey(bid), JSON.stringify(list)); } catch { /* ignore */ }
}
// Coalesce consecutive unpublished edits to the same ticket (e.g. typing) into one.
export function appendPending(list: Pending[], items: Pending[]): Pending[] {
  const out = [...list];
  for (const it of items) {
    const last = out[out.length - 1];
    if (it.event.t === "ticket.update" && last && !last.published && last.event.t === "ticket.update" && last.event.ticketId === it.event.ticketId) {
      out[out.length - 1] = { ...last, event: { t: "ticket.update", ticketId: it.event.ticketId, patch: { ...last.event.patch, ...it.event.patch } } };
    } else {
      out.push(it);
    }
  }
  return out;
}

interface FetchedEvent { id: string; at: number; by: string; event: BoardEvent }

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);

// ── publishing ────────────────────────────────────────────────────────────────

function eventItem(boardId: string, me: string, encrypted: string, id: string): DataItem {
  return {
    data: new TextEncoder().encode(encrypted),
    tags: [
      { name: "App-Name", value: APP_EVENT },
      { name: "Board", value: boardId },
      { name: "Author", value: me },
      { name: "Event-Id", value: id },
      { name: "Unix-Time", value: Date.now().toString() },
    ],
  };
}

// Encrypt + publish a batch of events with caller-supplied ids (so a persisted pending-event log
// can reconcile them against the fold). Published SILENTLY — signed in-browser by this wallet's
// per-wallet app key (publishDepmRecords) and POSTed to Turbo, so there's NO wallet "authorize"
// popup for these free, no-value writes. The event's AUTHOR (used for role/permission gating in
// foldBoard) comes from the plaintext `Author` tag = the wallet address (eventItem sets it), NOT
// the tx signer — so authorship is unchanged and, as before, soft-enforced (honest clients only).
export async function publishEvents(boardId: string, me: string, key: Uint8Array, items: { id: string; event: BoardEvent }[]): Promise<void> {
  if (items.length === 0) return;
  const records: DataItem[] = [];
  for (const it of items) records.push(eventItem(boardId, me, await encryptPayload(key, it.event), it.id));
  await publishDepmRecords(me, records);
}

// Fold a shared board from Arweave and merge it into local state (timesheets, tickets,
// members, budgets…), reconciling the pending log — a standalone version of BoardView's
// sync so OTHER pages (Timesheet) can pull team data without opening each board. Silent:
// uses only the cached key (no wallet prompt); returns null if the board isn't shared or
// the key isn't cached yet (it'll sync once the board is opened).
export async function syncBoardState(boardId: string, me: string): Promise<BoardState | null> {
  const metas = loadBoards(me);
  const m = metas.find((b) => b.id === boardId);
  if (!m?.shared) return null;
  const key = loadBoardKey(boardId);
  if (!key) return null;
  const { title, state: folded0, confirmedIds } = await foldBoard(boardId, m.owner, key);
  const cached = loadBoardState(boardId);
  const folded: BoardState = { ...folded0, columns: folded0.columns ?? cached.columns, projects: folded0.projects ?? cached.projects, timesheets: folded0.timesheets ?? cached.timesheets, itsmBudget: folded0.itsmBudget ?? cached.itsmBudget };
  const pending = loadPending(boardId).filter((p) => !confirmedIds.includes(p.id));
  savePending(boardId, pending);
  const merged = pending.reduce((s, p) => applyEvent(s, p.event), folded);
  saveBoardState(boardId, merged);
  const pt = [...pending].reverse().find((p) => p.event.t === "board.update");
  const newTitle = (pt && pt.event.t === "board.update" ? pt.event.title : undefined) ?? title ?? m.title;
  const myNewRole: Role = merged.members.find((mm) => mm.address === me)?.role ?? (m.owner === me ? "owner" : "viewer");
  if (newTitle !== m.title || myNewRole !== m.role) saveBoards(me, metas.map((b) => (b.id === boardId ? { ...b, title: newTitle, role: myNewRole } : b)));
  // NOTE: fold-only — we deliberately do NOT re-publish unconfirmed pending here. This runs on
  // every Timesheet open/refresh, and re-publishing would re-fire a wallet write each time (the
  // "repeated approval" bug). BoardView re-publishes any lost events when the board is opened.
  return merged;
}

// Apply board events to their boards (local-first) and, for shared boards, log them as
// pending + publish (best-effort; BoardView's flush retries anything left unpublished).
// Lets views OTHER than BoardView (Timesheet, Service Desk) write to any board the same
// way BoardView.applyProjects does, without owning the pending/flush machinery.
export async function commitBoardEvents(me: string, items: { boardId: string; event: BoardEvent }[]): Promise<void> {
  const byBoard = new Map<string, BoardEvent[]>();
  for (const it of items) {
    const list = byBoard.get(it.boardId) ?? [];
    list.push(it.event);
    byBoard.set(it.boardId, list);
  }
  const boards = loadBoards(me);
  for (const [boardId, events] of byBoard) {
    let st = loadBoardState(boardId);
    for (const e of events) st = applyEvent(st, e);
    saveBoardState(boardId, st);

    recordBoardEventsLocally(boardId, me, events); // attribute by address immediately (profile activity)

    const meta = boards.find((b) => b.id === boardId);
    if (!meta?.shared) continue;
    const pendItems: Pending[] = events.map((event) => ({ id: newId(), event, published: false }));
    savePending(boardId, appendPending(loadPending(boardId), pendItems));
    const key = loadBoardKey(boardId);
    if (!key) continue; // no cached key → stays pending, flushes when the board is opened
    try {
      await publishEvents(boardId, me, key, pendItems.map((p) => ({ id: p.id, event: p.event })));
      savePending(boardId, loadPending(boardId).map((p) => (pendItems.some((q) => q.id === p.id) ? { ...p, published: true } : p)));
    } catch { /* stays pending; retried on next board flush */ }
  }
}

// Resolve a recipient token (address or pasted public key) to {address, modulus}.
async function resolveModulus(token: string): Promise<{ address: string; modulus: string } | null> {
  const t = token.trim();
  if (!t) return null;
  if (looksLikePublicKey(t)) return { address: await addressFromPublicKey(t), modulus: t };
  const modulus = await fetchPublicKey(t);
  return modulus ? { address: t, modulus } : null;
}

// Owner shares a board: publish the manifest (anchors ownership + encrypted title)
// plus a grant for each member, and seed the log with the current tickets/members.
export async function shareBoard(
  boardId: string,
  me: string,
  title: string,
  state: BoardState,
  memberTokens: { token: string; label: string; role: Role }[],
): Promise<{ key: Uint8Array; added: string[]; missing: string[]; seed: { id: string; event: BoardEvent }[] }> {
  const key = generateBoardKey();
  const items: DataItem[] = [];

  // manifest
  items.push({
    data: new TextEncoder().encode("board"),
    tags: [
      { name: "App-Name", value: APP_MANIFEST },
      { name: "Board", value: boardId },
      { name: "Owner", value: me },
      { name: "Enc-Title", value: await encryptPayload(key, { title }) },
      { name: "Unix-Time", value: Date.now().toString() },
    ],
  });

  // Self-grant: also wrap the board key to the OWNER's own wallet, so the key lives on-chain
  // (recoverable on any device / after a cache wipe — exactly like a vault doc's wrapped key),
  // not only in this browser. discoverSharedBoards(me) then finds and unlocks the board.
  await pushSelfGrant(items, boardId, me, key);

  // grants
  const added: string[] = [];
  const missing: string[] = [];
  const members: Member[] = [{ address: me, label: "You", role: "owner", addedAt: Date.now() }];
  for (const m of memberTokens) {
    const r = await resolveModulus(m.token);
    if (!r) { missing.push(m.token.trim()); continue; }
    items.push(grantItem(boardId, r.address, await wrapForRecipient(r.modulus, key), m.role));
    members.push({ address: r.address, label: m.label || shortAddr(r.address), role: m.role, addedAt: Date.now() });
    added.push(r.address);
  }

  // seed events: members + existing tickets (returned so the owner can track them
  // in the pending log until they index, otherwise the first sync would empty the board).
  const seed: { id: string; event: BoardEvent }[] = [];
  for (const m of members.filter((x) => x.role !== "owner")) {
    const event: BoardEvent = { t: "member.add", member: m };
    const id = uid(); seed.push({ id, event });
    items.push(eventItem(boardId, me, await encryptPayload(key, event), id));
  }
  for (const tk of state.tickets) {
    const event: BoardEvent = { t: "ticket.create", ticket: tk };
    const id = uid(); seed.push({ id, event });
    items.push(eventItem(boardId, me, await encryptPayload(key, event), id));
  }

  await publishDepmRecords(me, items);
  saveBoardKey(boardId, key);
  return { key, added, missing, seed };
}

function grantItem(boardId: string, recipient: string, wrappedKey: Uint8Array, role: Role): DataItem {
  return {
    data: new TextEncoder().encode(`board-grant:${boardId}:${recipient}`),
    tags: [
      { name: "App-Name", value: APP_GRANT },
      { name: "Board", value: boardId },
      { name: "Recipient", value: recipient },
      { name: `Rcpt-${recipient}`, value: bytesToBase64Url(wrappedKey) },
      { name: "Role", value: role },
      { name: "Unix-Time", value: Date.now().toString() },
    ],
  };
}

// Append an owner self-grant (key wrapped to my own wallet, Recipient = me) to a batch.
// Best-effort: if the wallet can't expose the public key we just skip it (the local key cache
// + the encrypted state snapshot are the other recovery paths).
async function pushSelfGrant(items: DataItem[], boardId: string, me: string, key: Uint8Array): Promise<void> {
  try {
    const myPub = await window.arweaveWallet.getActivePublicKey();
    items.push(grantItem(boardId, me, await wrapForRecipient(myPub, key), "owner"));
  } catch { /* non-fatal */ }
}

const selfGrantMarker = (boardId: string) => `gtv_boardselfgrant_${boardId}`;

// Heal a board that was shared/published BEFORE owner self-grants existed: publish a self-grant
// once so the owner's key becomes chain-recoverable. Idempotent via a local marker, silent
// (signDataItem doesn't prompt), and only meaningful when the key is still available locally.
export async function ensureBoardSelfGrant(boardId: string, me: string, key: Uint8Array): Promise<void> {
  try { if (localStorage.getItem(selfGrantMarker(boardId))) return; } catch {}
  const items: DataItem[] = [];
  await pushSelfGrant(items, boardId, me, key);
  if (items.length === 0) return;
  try {
    await publishDepmRecords(me, items);
    try { localStorage.setItem(selfGrantMarker(boardId), "1"); } catch {}
  } catch { /* best-effort */ }
}

// Add a member to an already-shared board (owner/admin): grant + member.add event.
// Returns the member + the event id so the caller can track it in the pending log.
export async function addMember(
  boardId: string, me: string, key: Uint8Array, token: string, label: string, role: Role,
): Promise<{ address: string; member: Member; eventId: string } | { error: string }> {
  const r = await resolveModulus(token);
  if (!r) return { error: "No public key found. Ask them to paste their public key from “View a Document.”" };
  const member: Member = { address: r.address, label: label || shortAddr(r.address), role, addedAt: Date.now() };
  const eventId = uid();
  await publishDepmRecords(me, [
    grantItem(boardId, r.address, await wrapForRecipient(r.modulus, key), role),
    eventItem(boardId, me, await encryptPayload(key, { t: "member.add", member }), eventId),
  ]);
  return { address: r.address, member, eventId };
}

export async function setMemberRole(boardId: string, me: string, key: Uint8Array, address: string, role: Role): Promise<string> {
  const eventId = uid();
  await publishEvents(boardId, me, key, [{ id: eventId, event: { t: "member.role", address, role } }]);
  return eventId;
}

// Soft-remove a member: a member.remove event + a public revoke tombstone.
export async function removeMember(boardId: string, me: string, key: Uint8Array, address: string): Promise<string> {
  const eventId = uid();
  await publishDepmRecords(me, [
    eventItem(boardId, me, await encryptPayload(key, { t: "member.remove", address }), eventId),
    {
      data: new TextEncoder().encode(`board-revoke:${boardId}:${address}`),
      tags: [
        { name: "App-Name", value: APP_REVOKE },
        { name: "Board", value: boardId },
        { name: "Recipient", value: address },
        { name: "Unix-Time", value: Date.now().toString() },
      ],
    },
  ]);
  return eventId;
}

// ── fetching ──────────────────────────────────────────────────────────────────

interface RawNode { id: string; owner: { address: string }; tags: { name: string; value: string }[] }
const tag = (n: RawNode, name: string) => n.tags.find((t) => t.name === name)?.value;

interface GqlPage { nodes: RawNode[]; cursor: string | null; hasNext: boolean }
async function gqlPage(endpoint: string, query: string, variables: Record<string, unknown>): Promise<GqlPage> {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { nodes: [], cursor: null, hasNext: false };
    const json = (await res.json()) as { data?: { transactions?: { pageInfo?: { hasNextPage?: boolean }; edges?: { cursor: string; node: RawNode }[] } } };
    const edges = json?.data?.transactions?.edges ?? [];
    return { nodes: edges.map((e) => e.node), cursor: edges.length ? edges[edges.length - 1].cursor : null, hasNext: !!json?.data?.transactions?.pageInfo?.hasNextPage };
  } catch {
    return { nodes: [], cursor: null, hasNext: false };
  }
}

// Paginated GraphQL for every record of a board (manifest+grants+revokes+events).
async function fetchBoardNodes(boardId: string): Promise<RawNode[]> {
  const byId = new Map<string, RawNode>();
  const query = `query($app:[String!]!,$b:[String!]!,$a:String){transactions(tags:[{name:"App-Name",values:$app},{name:"Board",values:$b}],first:100,after:$a,sort:HEIGHT_ASC){pageInfo{hasNextPage}edges{cursor node{id owner{address} tags{name value}}}}}`;
  const apps = [APP_MANIFEST, APP_GRANT, APP_REVOKE, APP_EVENT];
  await Promise.all(
    ENDPOINTS.map(async (endpoint) => {
      let after: string | null = null;
      for (let page = 0; page < 40; page++) {
        const { nodes, cursor, hasNext } = await gqlPage(endpoint, query, { app: apps, b: [boardId], a: after });
        for (const n of nodes) if (!byId.has(n.id)) byId.set(n.id, n);
        if (!hasNext || nodes.length === 0 || !cursor) break;
        after = cursor;
      }
    }),
  );
  return [...byId.values()];
}

// Fetch an event's encrypted body (base64 text) from a data gateway.
async function fetchBody(txId: string): Promise<string | null> {
  for (const base of DATA_GATEWAYS) {
    try {
      const res = await fetch(`${base}/${txId}`, { signal: AbortSignal.timeout(10000) });
      if (res.ok) return (await res.text()).trim();
    } catch {}
  }
  return null;
}

// Boards shared WITH me: query grants by Recipient, newest grant per board wins.
export interface SharedBoardRef { boardId: string; owner: string; wrappedKey: string; role: Role; at: number }
export async function discoverSharedBoards(me: string): Promise<SharedBoardRef[]> {
  const query = `query($app:[String!]!,$r:[String!]!){transactions(tags:[{name:"App-Name",values:$app},{name:"Recipient",values:$r}],first:100,sort:HEIGHT_DESC){edges{cursor node{id owner{address} tags{name value}}}}}`;
  const seen = new Map<string, SharedBoardRef>();
  const pages = await Promise.all(ENDPOINTS.map((endpoint) => gqlPage(endpoint, query, { app: [APP_GRANT], r: [me] })));
  const nodes = pages.flatMap((p) => p.nodes);
  for (const n of nodes) {
    const boardId = tag(n, "Board");
    const wrappedKey = tag(n, `Rcpt-${me}`);
    if (!boardId || !wrappedKey) continue;
    const at = Number(tag(n, "Unix-Time") ?? 0);
    const prev = seen.get(boardId);
    if (!prev || at >= prev.at) seen.set(boardId, { boardId, owner: n.owner.address, wrappedKey, role: (tag(n, "Role") as Role) ?? "viewer", at });
  }
  return [...seen.values()];
}

// ── fold ──────────────────────────────────────────────────────────────────────

export function applyEvent(state: BoardState, e: BoardEvent): BoardState {
  switch (e.t) {
    case "ticket.create": {
      if (state.tickets.some((t) => t.id === e.ticket.id)) return state;
      const ticket = normalizeTicket(e.ticket, state.tickets.length);
      return { ...state, tickets: [...state.tickets, ticket], seq: Math.max(state.seq, ticket.num) };
    }
    case "ticket.update":
      return { ...state, tickets: state.tickets.map((t) => (t.id === e.ticketId ? { ...t, ...e.patch } : t)) };
    case "ticket.move":
      return { ...state, tickets: state.tickets.map((t) => (t.id === e.ticketId ? { ...t, status: e.status, order: e.order } : t)) };
    case "ticket.delete":
      return { ...state, tickets: state.tickets.filter((t) => t.id !== e.ticketId) };
    case "comment.add":
      return { ...state, tickets: state.tickets.map((t) => (t.id === e.ticketId && !t.comments.some((c) => c.id === e.comment.id) ? { ...t, comments: [...t.comments, e.comment] } : t)) };
    case "comment.delete":
      return { ...state, tickets: state.tickets.map((t) => (t.id === e.ticketId ? { ...t, comments: t.comments.filter((c) => c.id !== e.commentId) } : t)) };
    case "member.add":
      return { ...state, members: upsertMember(state.members, e.member) };
    case "member.role":
      return { ...state, members: state.members.map((m) => (m.address === e.address ? { ...m, role: e.role } : m)) };
    case "member.remove":
      return { ...state, members: state.members.filter((m) => m.address !== e.address) };
    case "board.columns":
      return { ...state, columns: e.columns };
    case "board.projects":
      return { ...state, projects: e.projects };
    case "board.itsmbudget":
      return { ...state, itsmBudget: e.budget };
    case "timesheet.set": {
      const list = state.timesheets ?? [];
      const ix = list.findIndex((x) => x.id === e.entry.id);
      if (ix < 0) return { ...state, timesheets: [...list, e.entry] };
      // newest-wins by updatedAt
      if (list[ix].updatedAt > e.entry.updatedAt) return state;
      const next = list.slice(); next[ix] = e.entry;
      return { ...state, timesheets: next };
    }
    case "timesheet.delete":
      return { ...state, timesheets: (state.timesheets ?? []).filter((x) => x.id !== e.id) };
    case "timesheet.status":
      return { ...state, timesheets: (state.timesheets ?? []).map((x) => (x.id === e.id ? { ...x, status: e.status, approvedBy: e.approvedBy ?? x.approvedBy, updatedAt: Math.max(x.updatedAt, Date.now()) } : x)) };
    default:
      return state;
  }
}

function upsertMember(members: Member[], m: Member): Member[] {
  return members.some((x) => x.address === m.address)
    ? members.map((x) => (x.address === m.address ? { ...x, ...m } : x))
    : [...members, m];
}

// Fold every record into board state with role validation + newest-wins.
export async function foldBoard(boardId: string, ownerHint: string, key: Uint8Array): Promise<{ title: string | null; state: BoardState; confirmedIds: string[] }> {
  const nodes = await fetchBoardNodes(boardId);

  const manifest = nodes.find((n) => tag(n, "App-Name") === APP_MANIFEST);
  // Ownership is anchored by the manifest's explicit `Owner` TAG (the wallet address), not the tx
  // signer — the manifest is signed silently by the wallet's app key, so the signer isn't the owner.
  const owner = (manifest ? tag(manifest, "Owner") : null) ?? manifest?.owner.address ?? ownerHint;
  // null = no real title found yet (e.g. manifest not indexed) — callers keep the
  // local title instead of clobbering it with a placeholder.
  let title: string | null = null;
  if (manifest) {
    const t = await decryptPayload<{ title: string }>(key, tag(manifest, "Enc-Title") ?? "");
    if (t?.title) title = t.title;
  }

  // Decrypt event bodies (cache decrypted events so re-syncs only fetch new ones).
  const cacheKey = `gtv_boardevents_${boardId}`;
  let cache: Record<string, FetchedEvent> = {};
  try { cache = JSON.parse(localStorage.getItem(cacheKey) || "{}"); } catch {}
  const eventNodes = nodes.filter((n) => tag(n, "App-Name") === APP_EVENT);
  await Promise.all(eventNodes.map(async (n) => {
    const eid = tag(n, "Event-Id") || n.id;
    if (cache[eid]) return;
    const body = await fetchBody(n.id);
    if (!body) return;
    const event = await decryptPayload<BoardEvent>(key, body);
    if (event) cache[eid] = { id: eid, at: Number(tag(n, "Unix-Time") ?? 0), by: tag(n, "Author") ?? n.owner.address, event };
  }));
  try { localStorage.setItem(cacheKey, JSON.stringify(cache)); } catch {}

  // Timeline: events + grants + revokes, oldest first.
  type Rec = { at: number; by: string; kind: "event" | "grant" | "revoke"; event?: BoardEvent; recipient?: string; role?: Role };
  const recs: Rec[] = [];
  for (const fe of Object.values(cache)) recs.push({ at: fe.at, by: fe.by, kind: "event", event: fe.event });
  for (const n of nodes) {
    const app = tag(n, "App-Name");
    const at = Number(tag(n, "Unix-Time") ?? 0);
    if (app === APP_GRANT) recs.push({ at, by: n.owner.address, kind: "grant", recipient: tag(n, "Recipient"), role: (tag(n, "Role") as Role) ?? "viewer" });
    else if (app === APP_REVOKE) recs.push({ at, by: n.owner.address, kind: "revoke", recipient: tag(n, "Recipient") });
  }
  recs.sort((a, b) => a.at - b.at);

  // Member registry (owner always present); membership changes need owner/admin author.
  const reg = new Map<string, Member>();
  reg.set(owner, { address: owner, label: "Owner", role: "owner", addedAt: 0 });
  // Inactive (removed) members stay in the registry for name display but lose all
  // authority — a manager/editor must be present AND active.
  const isManager = (addr: string) => { const m = reg.get(addr); return !!m && !m.inactive && roleRank(m.role) >= 2; };
  const deactivate = (addr: string) => { const ex = reg.get(addr); if (ex) reg.set(addr, { ...ex, inactive: true }); };

  let state: BoardState = { tickets: [], members: [], seq: 0 };
  for (const r of recs) {
    if (r.kind === "grant") {
      if (r.recipient && isManager(r.by) && r.recipient !== owner) {
        const ex = reg.get(r.recipient);
        reg.set(r.recipient, { address: r.recipient, label: ex?.label ?? shortAddr(r.recipient), role: r.role ?? "viewer", addedAt: r.at, inactive: false });
      }
    } else if (r.kind === "revoke") {
      if (r.recipient && isManager(r.by) && r.recipient !== owner) deactivate(r.recipient);
    } else if (r.event) {
      const e = r.event;
      if (e.t === "member.add" || e.t === "member.role" || e.t === "member.remove") {
        if (!isManager(r.by)) continue;
        if (e.t === "member.add" && e.member.address === owner) continue;
        if (e.t === "member.add") reg.set(e.member.address, { ...e.member, addedAt: r.at, inactive: false });
        else if (e.t === "member.role" && reg.has(e.address) && e.address !== owner) reg.set(e.address, { ...reg.get(e.address)!, role: e.role });
        else if (e.t === "member.remove" && e.address !== owner) deactivate(e.address);
      } else if (e.t === "board.update") {
        if (isManager(r.by)) title = e.title;
      } else if (e.t === "board.columns" || e.t === "board.projects" || e.t === "board.itsmbudget") {
        if (isManager(r.by)) state = applyEvent(state, e);
      } else if (e.t === "timesheet.set") {
        // you log your OWN time — author is forced to the event signer (editor+ only).
        const m = reg.get(r.by);
        if (m && !m.inactive && roleRank(m.role) >= 1) state = applyEvent(state, { t: "timesheet.set", entry: { ...e.entry, author: r.by, boardId } });
      } else if (e.t === "timesheet.delete") {
        // own entry (editor+) or any entry if you're a manager.
        const m = reg.get(r.by);
        const owns = (state.timesheets ?? []).some((x) => x.id === e.id && x.author === r.by);
        if (m && !m.inactive && (isManager(r.by) || (roleRank(m.role) >= 1 && owns))) state = applyEvent(state, e);
      } else if (e.t === "timesheet.status") {
        // submit = the entry's author; approve/reject = a manager.
        const ent = (state.timesheets ?? []).find((x) => x.id === e.id);
        if (ent && (e.status === "submitted" ? ent.author === r.by : isManager(r.by))) state = applyEvent(state, e);
      } else {
        // ticket.* / comment.* — author must be an ACTIVE member with editor+.
        const m = reg.get(r.by);
        if (m && !m.inactive && roleRank(m.role) >= 1) state = applyEvent(state, e);
      }
    }
  }
  state = { ...state, members: [...reg.values()] };
  return { title, state, confirmedIds: Object.keys(cache) };
}
