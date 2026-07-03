// Encrypted multi-party chat sync — an append-only message log on Arweave, the same
// model as shared boards (boardSync.ts): a per-chat AES key encrypts every message
// and is RSA-wrapped to each member via a signed Turbo "grant"; clients discover
// chats via /api/gql and fold the log (newest-by-time). Read access is cryptographic
// (non-members lack the key). Not realtime — Arweave indexing takes ~minutes.

import { ChatMember, ChatMessage } from "./chat";
import { fromBase64, toBase64 } from "./vault";
import { wrapForRecipient, fetchPublicKey, looksLikePublicKey, addressFromPublicKey } from "./recipients";
import { publishRecords, type DataItem } from "./turbo";

const APP_MSG = "GTV-Chat-Msg";
const APP_MANIFEST = "GTV-Chat";
const APP_GRANT = "GTV-Chat-Grant";
const APP_REACT = "GTV-Chat-React";
const APP_READ = "GTV-Chat-Read";
const ENDPOINTS = ["https://arweave.net/graphql", "https://turbo-gateway.com/graphql"];
const DATA_GATEWAYS = ["https://turbo-gateway.com", "https://arweave.net"];

// ── chat key (raw AES-256, cached like the board key) ──
const keyCacheKey = (chatId: string) => `gtv_chatkey_${chatId}`;
export function loadChatKey(chatId: string): Uint8Array | null {
  if (typeof window === "undefined") return null;
  try { const b64 = localStorage.getItem(keyCacheKey(chatId)); return b64 ? fromBase64(b64) : null; } catch { return null; }
}
export function saveChatKey(chatId: string, key: Uint8Array): void {
  try { localStorage.setItem(keyCacheKey(chatId), toBase64(key)); } catch {}
}
export const generateChatKey = (): Uint8Array => crypto.getRandomValues(new Uint8Array(32));

export async function unwrapChatKey(wrappedB64Url: string): Promise<Uint8Array> {
  const w = window.arweaveWallet as unknown as { decrypt(data: Uint8Array, algo: { name: string }): Promise<ArrayBuffer> };
  const raw = await w.decrypt(base64UrlToBytes(wrappedB64Url), { name: "RSA-OAEP" });
  return new Uint8Array(raw);
}

// ── AES-GCM payload helpers (iv(12) || ct, base64) ──
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
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(0, 12) as Uint8Array<ArrayBuffer> }, k, buf.slice(12) as Uint8Array<ArrayBuffer>);
    return JSON.parse(new TextDecoder().decode(pt)) as T;
  } catch { return null; }
}
function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + (b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4))));
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
const shortAddr = (a: string) => (a && a.length > 10 ? `${a.slice(0, 5)}…${a.slice(-4)}` : a || "?");

// ── publishing ──
function msgItem(chatId: string, me: string, encrypted: string, id: string): DataItem {
  return {
    data: new TextEncoder().encode(encrypted),
    tags: [
      { name: "App-Name", value: APP_MSG },
      { name: "Chat", value: chatId },
      { name: "Author", value: me },
      { name: "Msg-Id", value: id },
      { name: "Unix-Time", value: Date.now().toString() },
    ],
  };
}
function grantItem(chatId: string, recipient: string, wrappedKey: Uint8Array): DataItem {
  return {
    data: new TextEncoder().encode(`chat-grant:${chatId}:${recipient}`),
    tags: [
      { name: "App-Name", value: APP_GRANT },
      { name: "Chat", value: chatId },
      { name: "Recipient", value: recipient },
      { name: `Rcpt-${recipient}`, value: bytesToBase64Url(wrappedKey) },
      { name: "Unix-Time", value: Date.now().toString() },
    ],
  };
}
async function manifestItem(chatId: string, me: string, key: Uint8Array, title: string, roster: ChatMember[]): Promise<DataItem> {
  return {
    data: new TextEncoder().encode("chat"),
    tags: [
      { name: "App-Name", value: APP_MANIFEST },
      { name: "Chat", value: chatId },
      { name: "Owner", value: me },
      { name: "Enc-Title", value: await encryptPayload(key, { title }) },
      { name: "Enc-Roster", value: await encryptPayload(key, { roster }) },
      { name: "Unix-Time", value: Date.now().toString() },
    ],
  };
}

async function resolveModulus(token: string): Promise<{ address: string; modulus: string } | null> {
  const t = token.trim();
  if (!t) return null;
  if (looksLikePublicKey(t)) return { address: await addressFromPublicKey(t), modulus: t };
  const modulus = await fetchPublicKey(t);
  return modulus ? { address: t, modulus } : null;
}

// Create a chat: manifest (title + roster) + a key-grant for each member.
export async function createChat(
  chatId: string, me: string, meLabel: string, title: string, memberTokens: { token: string; label: string }[],
): Promise<{ key: Uint8Array; roster: ChatMember[]; added: string[]; missing: string[] }> {
  const key = generateChatKey();
  const roster: ChatMember[] = [{ address: me, label: meLabel || "You" }];
  const grants: DataItem[] = [];
  const added: string[] = []; const missing: string[] = [];
  for (const m of memberTokens) {
    const r = await resolveModulus(m.token);
    if (!r) { missing.push(m.token.trim()); continue; }
    if (r.address === me || roster.some((x) => x.address === r.address)) continue;
    grants.push(grantItem(chatId, r.address, await wrapForRecipient(r.modulus, key)));
    roster.push({ address: r.address, label: m.label || shortAddr(r.address) });
    added.push(r.address);
  }
  // Self-grant: wrap the chat key to my own wallet too, so the key lives on-chain (recoverable
  // on any device / after a cache wipe — like a vault doc's wrapped key), not only in this
  // browser. discoverChats(me) then finds and unlocks the chat.
  try {
    const myPub = await window.arweaveWallet.getActivePublicKey();
    grants.push(grantItem(chatId, me, await wrapForRecipient(myPub, key)));
  } catch { /* non-fatal */ }
  await publishRecords([await manifestItem(chatId, me, key, title, roster), ...grants]);
  saveChatKey(chatId, key);
  return { key, roster, added, missing };
}

const selfGrantMarker = (chatId: string) => `gtv_chatselfgrant_${chatId}`;

// Heal a chat created BEFORE owner self-grants existed: publish a self-grant once so the owner's
// key becomes chain-recoverable. Idempotent via a local marker, silent, owner-only.
export async function ensureChatSelfGrant(chatId: string, me: string, key: Uint8Array): Promise<void> {
  try { if (localStorage.getItem(selfGrantMarker(chatId))) return; } catch {}
  try {
    const myPub = await window.arweaveWallet.getActivePublicKey();
    await publishRecords([grantItem(chatId, me, await wrapForRecipient(myPub, key))]);
    try { localStorage.setItem(selfGrantMarker(chatId), "1"); } catch {}
  } catch { /* best-effort */ }
}

// Add a member to an existing chat: grant the key + republish the manifest roster.
// Owner renames a chat → republish the manifest with the new title so members see it.
export async function renameChat(chatId: string, me: string, key: Uint8Array, title: string, roster: ChatMember[]): Promise<void> {
  await publishRecords([await manifestItem(chatId, me, key, title, roster)]);
}

export async function addChatMember(
  chatId: string, me: string, key: Uint8Array, title: string, roster: ChatMember[], token: string, label: string,
): Promise<{ member: ChatMember; roster: ChatMember[] } | { error: string }> {
  const r = await resolveModulus(token);
  if (!r) return { error: "No public key found. Ask them to paste their public key from “View a Document.”" };
  if (roster.some((x) => x.address === r.address)) return { error: "They're already in this chat." };
  const member: ChatMember = { address: r.address, label: label || shortAddr(r.address) };
  const next = [...roster, member];
  await publishRecords([grantItem(chatId, r.address, await wrapForRecipient(r.modulus, key)), await manifestItem(chatId, me, key, title, next)]);
  return { member, roster: next };
}

// Publish a batch of messages (one wallet approval). Strips local-only flags.
export async function sendMessages(chatId: string, me: string, key: Uint8Array, msgs: ChatMessage[]): Promise<void> {
  if (msgs.length === 0) return;
  const records: DataItem[] = [];
  for (const m of msgs) {
    const wire = { id: m.id, author: m.author, authorLabel: m.authorLabel, text: m.text, at: m.at };
    records.push(msgItem(chatId, me, await encryptPayload(key, wire), m.id));
  }
  await publishRecords(records);
}

// Edit a message: republish a GTV-Chat-Msg with the SAME Msg-Id (and original `at`,
// to keep its place) but new text + editedAt. The fold takes the newest version per
// Msg-Id, so this supersedes the original everywhere.
export async function editMessage(chatId: string, me: string, key: Uint8Array, msg: ChatMessage): Promise<void> {
  const wire = { id: msg.id, author: msg.author, authorLabel: msg.authorLabel, text: msg.text, at: msg.at, editedAt: msg.editedAt ?? Date.now() };
  await publishRecords([msgItem(chatId, me, await encryptPayload(key, wire), msg.id)]);
}

// Toggle a reaction on a message: an encrypted {msgId, emoji, removed} record. The
// newest record per (author,msgId,emoji) wins, so re-publishing with removed=true
// un-reacts. The emoji stays in the encrypted body (only Author is in the clear).
export async function toggleReaction(chatId: string, me: string, key: Uint8Array, msgId: string, emoji: string, active: boolean): Promise<void> {
  const body = await encryptPayload(key, { msgId, emoji, removed: !active });
  await publishRecords([{
    data: new TextEncoder().encode(body),
    tags: [
      { name: "App-Name", value: APP_REACT },
      { name: "Chat", value: chatId },
      { name: "Author", value: me },
      { name: "Unix-Time", value: Date.now().toString() },
    ],
  }]);
}

// Publish a read marker (I've read everything up to now). Newest per reader wins.
export async function publishRead(chatId: string, me: string): Promise<void> {
  await publishRecords([{
    data: new TextEncoder().encode("read"),
    tags: [
      { name: "App-Name", value: APP_READ },
      { name: "Chat", value: chatId },
      { name: "Reader", value: me },
      { name: "Unix-Time", value: Date.now().toString() },
    ],
  }]);
}

// ── fetching ──
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

async function fetchChatNodes(chatId: string): Promise<RawNode[]> {
  const byId = new Map<string, RawNode>();
  const query = `query($app:[String!]!,$c:[String!]!,$a:String){transactions(tags:[{name:"App-Name",values:$app},{name:"Chat",values:$c}],first:100,after:$a,sort:HEIGHT_ASC){pageInfo{hasNextPage}edges{cursor node{id owner{address} tags{name value}}}}}`;
  const apps = [APP_MANIFEST, APP_GRANT, APP_MSG, APP_REACT, APP_READ];
  await Promise.all(ENDPOINTS.map(async (endpoint) => {
    let after: string | null = null;
    for (let page = 0; page < 40; page++) {
      const { nodes, cursor, hasNext } = await gqlPage(endpoint, query, { app: apps, c: [chatId], a: after });
      for (const n of nodes) if (!byId.has(n.id)) byId.set(n.id, n);
      if (!hasNext || nodes.length === 0 || !cursor) break;
      after = cursor;
    }
  }));
  return [...byId.values()];
}

async function fetchBody(txId: string): Promise<string | null> {
  for (const base of DATA_GATEWAYS) {
    try { const res = await fetch(`${base}/${txId}`, { signal: AbortSignal.timeout(10000) }); if (res.ok) return (await res.text()).trim(); } catch {}
  }
  return null;
}

// Chats shared WITH me: query grants by Recipient, newest grant per chat wins.
export interface SharedChatRef { chatId: string; owner: string; wrappedKey: string; at: number }
export async function discoverChats(me: string): Promise<SharedChatRef[]> {
  const query = `query($app:[String!]!,$r:[String!]!){transactions(tags:[{name:"App-Name",values:$app},{name:"Recipient",values:$r}],first:100,sort:HEIGHT_DESC){edges{cursor node{id owner{address} tags{name value}}}}}`;
  const seen = new Map<string, SharedChatRef>();
  const pages = await Promise.all(ENDPOINTS.map((e) => gqlPage(e, query, { app: [APP_GRANT], r: [me] })));
  for (const n of pages.flatMap((p) => p.nodes)) {
    const chatId = tag(n, "Chat"); const wrappedKey = tag(n, `Rcpt-${me}`);
    if (!chatId || !wrappedKey) continue;
    const at = Number(tag(n, "Unix-Time") ?? 0);
    const prev = seen.get(chatId);
    if (!prev || at >= prev.at) seen.set(chatId, { chatId, owner: n.owner.address, wrappedKey, at });
  }
  return [...seen.values()];
}

// Newest non-mine message time per chat, in ONE query (tags only, no bodies) — cheap
// enough to poll in the background for unread badges across all chats.
export async function latestMessageAts(chatIds: string[], me: string): Promise<Record<string, number>> {
  if (chatIds.length === 0) return {};
  const query = `query($app:[String!]!,$c:[String!]!){transactions(tags:[{name:"App-Name",values:$app},{name:"Chat",values:$c}],first:100,sort:HEIGHT_DESC){edges{node{id owner{address} tags{name value}}}}}`;
  const out: Record<string, number> = {};
  const pages = await Promise.all(ENDPOINTS.map((e) => gqlPage(e, query, { app: [APP_MSG], c: chatIds })));
  for (const n of pages.flatMap((p) => p.nodes)) {
    const c = tag(n, "Chat"); const author = tag(n, "Author");
    if (!c || author === me) continue;
    const at = Number(tag(n, "Unix-Time") ?? 0);
    if (at > (out[c] ?? 0)) out[c] = at;
  }
  return out;
}

// Fold a chat: latest manifest (title + roster) + every decrypted message (sorted),
// caching decrypted bodies by Msg-Id so re-sync only fetches new ones. Also reduces
// reaction records onto messages and read markers into `reads` (reader -> time).
interface CachedMsg { id: string; author: string; authorLabel: string; text: string; at: number; editedAt?: number; ut: number }
const cacheKey = (chatId: string) => `gtv_chatmsgcache2_${chatId}`; // v2: keyed by tx id (edits = new tx, same Msg-Id)
function loadCache(chatId: string): Record<string, CachedMsg> { try { return JSON.parse(localStorage.getItem(cacheKey(chatId)) || "{}"); } catch { return {}; } }
function saveCache(chatId: string, c: Record<string, CachedMsg>): void { try { localStorage.setItem(cacheKey(chatId), JSON.stringify(c)); } catch {} }

interface RawReact { author: string; msgId: string; emoji: string; removed: boolean; at: number }
const reactCacheKey = (chatId: string) => `gtv_chatreactcache_${chatId}`;
function loadReactCache(chatId: string): Record<string, RawReact> { try { return JSON.parse(localStorage.getItem(reactCacheKey(chatId)) || "{}"); } catch { return {}; } }
function saveReactCache(chatId: string, c: Record<string, RawReact>): void { try { localStorage.setItem(reactCacheKey(chatId), JSON.stringify(c)); } catch {} }

export async function foldChat(chatId: string, ownerHint: string, key: Uint8Array): Promise<{ title: string | null; owner: string; members: ChatMember[]; messages: ChatMessage[]; reads: Record<string, number> }> {
  const nodes = await fetchChatNodes(chatId);
  const manifests = nodes.filter((n) => tag(n, "App-Name") === APP_MANIFEST);
  manifests.sort((a, b) => Number(tag(a, "Unix-Time") ?? 0) - Number(tag(b, "Unix-Time") ?? 0));
  const owner = manifests[0]?.owner.address ?? ownerHint;
  // newest manifest authored by the owner wins for title + roster
  const latest = [...manifests].reverse().find((n) => n.owner.address === owner) ?? manifests[manifests.length - 1];
  let title: string | null = null;
  let members: ChatMember[] = [];
  if (latest) {
    const t = await decryptPayload<{ title: string }>(key, tag(latest, "Enc-Title") ?? "");
    if (t?.title) title = t.title;
    const r = await decryptPayload<{ roster: ChatMember[] }>(key, tag(latest, "Enc-Roster") ?? "");
    if (r?.roster) members = r.roster;
  }
  if (members.length === 0) {
    // fallback: grant recipients + owner
    const addrs = new Set<string>([owner]);
    for (const n of nodes) if (tag(n, "App-Name") === APP_GRANT) { const rcpt = tag(n, "Recipient"); if (rcpt) addrs.add(rcpt); }
    members = [...addrs].map((a) => ({ address: a, label: shortAddr(a) }));
  }

  const cache = loadCache(chatId);
  const msgNodes = nodes.filter((n) => tag(n, "App-Name") === APP_MSG);
  for (const n of msgNodes) {
    if (cache[n.id]) continue;
    const body = await fetchBody(n.id);
    if (!body) continue;
    const m = await decryptPayload<{ id?: string; author: string; authorLabel?: string; text: string; at?: number; editedAt?: number }>(key, body);
    const ut = Number(tag(n, "Unix-Time") ?? 0);
    if (m && m.text != null) cache[n.id] = { id: m.id || tag(n, "Msg-Id") || n.id, author: m.author, authorLabel: m.authorLabel || shortAddr(m.author), text: m.text, at: m.at || ut, editedAt: m.editedAt, ut };
  }
  saveCache(chatId, cache);
  // newest version per Msg-Id wins (edits supersede the original): version = editedAt ?? Unix-Time
  const best = new Map<string, CachedMsg>();
  for (const r of Object.values(cache)) { const p = best.get(r.id); if (!p || (r.editedAt ?? r.ut) >= (p.editedAt ?? p.ut)) best.set(r.id, r); }
  const out: ChatMessage[] = [...best.values()].map((r) => ({ id: r.id, author: r.author, authorLabel: r.authorLabel, text: r.text, at: r.at, editedAt: r.editedAt }));

  // reactions: decrypt (cached by tx) → newest per (author,msgId,emoji) → msgId→emoji→reactors
  const rcache = loadReactCache(chatId);
  for (const n of nodes) {
    if (tag(n, "App-Name") !== APP_REACT || rcache[n.id]) continue;
    const body = await fetchBody(n.id);
    if (!body) continue;
    const d = await decryptPayload<{ msgId: string; emoji: string; removed?: boolean }>(key, body);
    if (d?.msgId && d.emoji) rcache[n.id] = { author: tag(n, "Author") ?? n.owner.address, msgId: d.msgId, emoji: d.emoji, removed: !!d.removed, at: Number(tag(n, "Unix-Time") ?? 0) };
  }
  saveReactCache(chatId, rcache);
  const latestReact = new Map<string, RawReact>();
  for (const r of Object.values(rcache)) { const k = `${r.author}|${r.msgId}|${r.emoji}`; const p = latestReact.get(k); if (!p || r.at >= p.at) latestReact.set(k, r); }
  const reactions: Record<string, Record<string, string[]>> = {};
  for (const r of latestReact.values()) { if (r.removed) continue; ((reactions[r.msgId] ??= {})[r.emoji] ??= []).push(r.author); }

  // read markers: newest Unix-Time per reader
  const reads: Record<string, number> = {};
  for (const n of nodes) if (tag(n, "App-Name") === APP_READ) { const reader = tag(n, "Reader"); const at = Number(tag(n, "Unix-Time") ?? 0); if (reader && at > (reads[reader] ?? 0)) reads[reader] = at; }

  out.sort((a, b) => a.at - b.at);
  const byId = new Map(out.map((m) => [m.id, { ...m, reactions: reactions[m.id] }] as const));
  return { title, owner, members, messages: [...byId.values()].sort((a, b) => a.at - b.at), reads };
}
