// Encrypted calendar-event sharing — invite people to an event and it appears on
// their calendar. Mirrors the chat/board model but uses ONE AES key per owner: the
// owner encrypts every shared event with their calendar key and RSA-wraps that key to
// each invitee via a signed Turbo "grant". An invitee unwraps the owner's key once
// (one wallet prompt) and can then read all events that owner shares. Read access is
// cryptographic; not realtime (Arweave indexing). v1 assumes one device per owner.

import { CalEvent } from "./calendar";
import { fromBase64, toBase64 } from "./vault";
import { wrapForRecipient, fetchPublicKey, looksLikePublicKey, addressFromPublicKey } from "./recipients";
import { publishRecords, type DataItem } from "./turbo";

const APP_EVENT = "GTV-Cal-Event";
const APP_GRANT = "GTV-Cal-Grant";
const ENDPOINTS = ["https://arweave.net/graphql", "https://turbo-gateway.com/graphql"];
const DATA_GATEWAYS = ["https://turbo-gateway.com", "https://arweave.net"];

const shortAddr = (a: string) => (a && a.length > 10 ? `${a.slice(0, 5)}…${a.slice(-4)}` : a || "?");

// ── keys ──
const generateKey = (): Uint8Array => crypto.getRandomValues(new Uint8Array(32));
export function ensureMyCalKey(): Uint8Array {
  try { const b64 = localStorage.getItem("gtv_calkey"); if (b64) return fromBase64(b64); } catch {}
  const k = generateKey();
  try { localStorage.setItem("gtv_calkey", toBase64(k)); } catch {}
  return k;
}
const ownerKeyKey = (owner: string) => `gtv_calkey_from_${owner}`;
export function loadOwnerKey(owner: string): Uint8Array | null {
  try { const b64 = localStorage.getItem(ownerKeyKey(owner)); return b64 ? fromBase64(b64) : null; } catch { return null; }
}
function saveOwnerKey(owner: string, key: Uint8Array): void { try { localStorage.setItem(ownerKeyKey(owner), toBase64(key)); } catch {} }
export async function unwrapOwnerKey(owner: string, wrappedB64Url: string): Promise<Uint8Array> {
  const cached = loadOwnerKey(owner); if (cached) return cached;
  // Prefer the encrypted state snapshot (one master-key unlock) over a per-calendar decrypt prompt.
  try { const { whenHydrated } = await import("./stateSync"); await whenHydrated(); const c = loadOwnerKey(owner); if (c) return c; } catch { /* sync off */ }
  const w = window.arweaveWallet as unknown as { decrypt(data: Uint8Array, algo: { name: string }): Promise<ArrayBuffer> };
  const raw = await w.decrypt(base64UrlToBytes(wrappedB64Url), { name: "RSA-OAEP" });
  const key = new Uint8Array(raw); saveOwnerKey(owner, key); return key;
}

// addresses I've already granted my calendar key to (avoid duplicate grants)
function loadGranted(): Set<string> { try { return new Set(JSON.parse(localStorage.getItem("gtv_calgranted") || "[]")); } catch { return new Set(); } }
function saveGranted(s: Set<string>): void { try { localStorage.setItem("gtv_calgranted", JSON.stringify([...s])); } catch {} }

// ── AES-GCM payload (iv(12)||ct, base64) ──
async function importAes(raw: Uint8Array): Promise<CryptoKey> { return crypto.subtle.importKey("raw", raw as Uint8Array<ArrayBuffer>, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]); }
async function encryptPayload(key: Uint8Array, obj: unknown): Promise<string> {
  const k = await importAes(key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(JSON.stringify(obj)) as Uint8Array<ArrayBuffer>));
  const out = new Uint8Array(iv.length + ct.length); out.set(iv, 0); out.set(ct, iv.length);
  return toBase64(out);
}
async function decryptPayload<T>(key: Uint8Array, b64: string): Promise<T | null> {
  try {
    const k = await importAes(key); const buf = fromBase64(b64);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(0, 12) as Uint8Array<ArrayBuffer> }, k, buf.slice(12) as Uint8Array<ArrayBuffer>);
    return JSON.parse(new TextDecoder().decode(pt)) as T;
  } catch { return null; }
}
function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/"); const bin = atob(b64 + (b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4))));
  const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); return arr;
}
function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function resolveModulus(token: string): Promise<{ address: string; modulus: string } | null> {
  const t = token.trim(); if (!t) return null;
  if (looksLikePublicKey(t)) return { address: await addressFromPublicKey(t), modulus: t };
  const modulus = await fetchPublicKey(t); return modulus ? { address: t, modulus } : null;
}

// ── publishing (owner) ──
function grantItem(me: string, recipient: string, wrappedKey: Uint8Array): DataItem {
  return { data: new TextEncoder().encode(`cal-grant:${recipient}`), tags: [
    { name: "App-Name", value: APP_GRANT }, { name: "Owner", value: me }, { name: "Recipient", value: recipient },
    { name: `Rcpt-${recipient}`, value: bytesToBase64Url(wrappedKey) }, { name: "Unix-Time", value: Date.now().toString() },
  ] };
}
async function eventItem(me: string, key: Uint8Array, payload: unknown, eventId: string): Promise<DataItem> {
  return { data: new TextEncoder().encode(await encryptPayload(key, payload)), tags: [
    { name: "App-Name", value: APP_EVENT }, { name: "Owner", value: me }, { name: "Event", value: eventId }, { name: "Unix-Time", value: Date.now().toString() },
  ] };
}

// Share/update an event: grant my key to any new invitees + (re)publish the encrypted
// event. Returns the resolved invitee roster to store on the event.
export async function shareEvent(me: string, event: CalEvent, inviteeTokens: { token: string; label: string }[]): Promise<{ invitees: { address: string; label: string }[] }> {
  const key = ensureMyCalKey();
  const granted = loadGranted();
  const grants: DataItem[] = [];
  const invitees: { address: string; label: string }[] = [];
  for (const m of inviteeTokens) {
    const r = await resolveModulus(m.token);
    if (!r || r.address === me || invitees.some((x) => x.address === r.address)) continue;
    invitees.push({ address: r.address, label: m.label || shortAddr(r.address) });
    if (!granted.has(r.address)) { grants.push(grantItem(me, r.address, await wrapForRecipient(r.modulus, key))); granted.add(r.address); }
  }
  const payload: CalEvent = { ...event, owner: me, invitees };
  await publishRecords([...grants, await eventItem(me, key, payload, event.id)]);
  saveGranted(granted);
  return { invitees };
}

// Owner removes a shared event → publish a tombstone (newest wins on fold).
export async function deleteSharedEvent(me: string, eventId: string): Promise<void> {
  const key = ensureMyCalKey();
  await publishRecords([await eventItem(me, key, { id: eventId, deleted: true }, eventId)]);
}

// ── discovery + fold (invitee) ──
interface RawNode { id: string; owner: { address: string }; tags: { name: string; value: string }[] }
const tag = (n: RawNode, name: string) => n.tags.find((t) => t.name === name)?.value;
async function gqlPage(endpoint: string, query: string, variables: Record<string, unknown>): Promise<{ nodes: RawNode[]; cursor: string | null; hasNext: boolean }> {
  try {
    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { nodes: [], cursor: null, hasNext: false };
    const json = (await res.json()) as { data?: { transactions?: { pageInfo?: { hasNextPage?: boolean }; edges?: { cursor: string; node: RawNode }[] } } };
    const edges = json?.data?.transactions?.edges ?? [];
    return { nodes: edges.map((e) => e.node), cursor: edges.length ? edges[edges.length - 1].cursor : null, hasNext: !!json?.data?.transactions?.pageInfo?.hasNextPage };
  } catch { return { nodes: [], cursor: null, hasNext: false }; }
}
async function fetchBody(txId: string): Promise<string | null> {
  for (const base of DATA_GATEWAYS) { try { const res = await fetch(`${base}/${txId}`, { signal: AbortSignal.timeout(10000) }); if (res.ok) return (await res.text()).trim(); } catch {} }
  return null;
}

// Owners who shared events with me → newest grant's wrapped key per owner.
export interface SharedOwnerRef { owner: string; wrappedKey: string }
export async function discoverSharedOwners(me: string): Promise<SharedOwnerRef[]> {
  const query = `query($app:[String!]!,$r:[String!]!){transactions(tags:[{name:"App-Name",values:$app},{name:"Recipient",values:$r}],first:100,sort:HEIGHT_DESC){edges{node{id owner{address} tags{name value}}}}}`;
  const seen = new Map<string, SharedOwnerRef>();
  const pages = await Promise.all(ENDPOINTS.map((e) => gqlPage(e, query, { app: [APP_GRANT], r: [me] })));
  for (const n of pages.flatMap((p) => p.nodes)) {
    const owner = tag(n, "Owner"); const wrappedKey = tag(n, `Rcpt-${me}`);
    if (owner && wrappedKey && owner !== me && !seen.has(owner)) seen.set(owner, { owner, wrappedKey });
  }
  return [...seen.values()];
}

const evCacheKey = (owner: string) => `gtv_caleventcache_${owner}`;
function loadEvCache(owner: string): Record<string, { at: number; payload: { id?: string; deleted?: boolean } & Partial<CalEvent> }> { try { return JSON.parse(localStorage.getItem(evCacheKey(owner)) || "{}"); } catch { return {}; } }
function saveEvCache(owner: string, c: Record<string, unknown>): void { try { localStorage.setItem(evCacheKey(owner), JSON.stringify(c)); } catch {} }

// Decrypt all of an owner's shared events (newest per Event-Id wins; tombstones drop).
export async function foldOwnerEvents(owner: string, key: Uint8Array): Promise<CalEvent[]> {
  const query = `query($app:[String!]!,$o:[String!]!,$a:String){transactions(tags:[{name:"App-Name",values:$app},{name:"Owner",values:$o}],first:100,after:$a,sort:HEIGHT_ASC){pageInfo{hasNextPage}edges{cursor node{id owner{address} tags{name value}}}}}`;
  const byTx = new Map<string, RawNode>();
  await Promise.all(ENDPOINTS.map(async (endpoint) => {
    let after: string | null = null;
    for (let page = 0; page < 40; page++) {
      const { nodes, cursor, hasNext } = await gqlPage(endpoint, query, { app: [APP_EVENT], o: [owner], a: after });
      for (const n of nodes) if (!byTx.has(n.id)) byTx.set(n.id, n);
      if (!hasNext || nodes.length === 0 || !cursor) break;
      after = cursor;
    }
  }));
  const cache = loadEvCache(owner);
  for (const n of byTx.values()) {
    if (cache[n.id]) continue;
    const body = await fetchBody(n.id); if (!body) continue;
    const payload = await decryptPayload<{ id?: string; deleted?: boolean } & Partial<CalEvent>>(key, body);
    if (payload) cache[n.id] = { at: Number(tag(n, "Unix-Time") ?? 0), payload };
  }
  saveEvCache(owner, cache);
  // newest record per Event id
  const best = new Map<string, { at: number; payload: { id?: string; deleted?: boolean } & Partial<CalEvent> }>();
  for (const rec of Object.values(cache)) { const id = rec.payload.id; if (!id) continue; const p = best.get(id); if (!p || rec.at >= p.at) best.set(id, rec); }
  const out: CalEvent[] = [];
  for (const rec of best.values()) { const p = rec.payload; if (p.deleted || !p.id || !p.date) continue; out.push({ ...(p as CalEvent), owner }); }
  return out;
}
