// Encrypted Service Desk sharing tied to a BOARD (team). A record that has a `boardId` is
// encrypted with THAT board's AES key — the same key its members already hold — and published
// to Arweave; any board member folds it into their Service Desk. There are no separate grants:
// board membership (holding the board key) IS the access, and edit rights follow the member's
// board role (enforced in the view). Mirrors calendarSync's publish/fold; reuses the board key
// from boardSync and the shared Turbo uploader.

import { ItsmRecord } from "./itsm";
import { fromBase64, toBase64 } from "./vault";
import { publishRecords, type DataItem } from "./turbo";
import { loadBoardKey } from "./boardSync";

const APP_RECORD = "GTV-Itsm-Record";
const ENDPOINTS = ["https://arweave.net/graphql", "https://turbo-gateway.com/graphql"];
const DATA_GATEWAYS = ["https://turbo-gateway.com", "https://arweave.net"];

// ── AES-GCM payload (iv(12)||ct, base64) — identical to chat/board/calendar sharing ──
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

async function recordItem(me: string, key: Uint8Array, record: ItsmRecord): Promise<DataItem> {
  return {
    data: new TextEncoder().encode(await encryptPayload(key, { ...record, owner: record.owner ?? me })),
    tags: [
      { name: "App-Name", value: APP_RECORD },
      { name: "Board", value: record.boardId as string },
      { name: "Record", value: record.id },
      { name: "Author", value: me },
      { name: "Unix-Time", value: Date.now().toString() },
    ],
  };
}

// Publish a board-tied record (encrypted with the board key). Returns false if the board key
// isn't available locally yet (caller tells the user to open that board once to unlock it).
export async function publishItsmRecord(record: ItsmRecord, me: string): Promise<boolean> {
  if (!record.boardId) return false;
  const key = loadBoardKey(record.boardId);
  if (!key) return false;
  await publishRecords([await recordItem(me, key, record)]);
  return true;
}

// ── discovery + fold (board member) ──
interface RawNode { id: string; owner: { address: string }; tags: { name: string; value: string }[] }
const tag = (n: RawNode, name: string) => n.tags.find((t) => t.name === name)?.value;
async function gqlPage(endpoint: string, query: string, variables: Record<string, unknown>): Promise<RawNode[]> {
  try {
    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: { transactions?: { edges?: { node: RawNode }[] } } };
    return (json?.data?.transactions?.edges ?? []).map((e) => e.node);
  } catch { return []; }
}
async function fetchBody(txId: string): Promise<string | null> {
  for (const base of DATA_GATEWAYS) { try { const res = await fetch(`${base}/${txId}`, { signal: AbortSignal.timeout(10000) }); if (res.ok) return (await res.text()).trim(); } catch {} }
  return null;
}

// Fold all records shared to a board I'm a member of (newest per Record wins). Returns the
// decrypted records (owner + boardId set). Empty if I don't hold the board key.
export async function discoverBoardItsm(boardId: string): Promise<ItsmRecord[]> {
  const key = loadBoardKey(boardId);
  if (!key) return [];
  const query = `query($app:[String!]!,$b:[String!]!){transactions(tags:[{name:"App-Name",values:$app},{name:"Board",values:$b}],first:100,sort:HEIGHT_DESC){edges{node{id owner{address} tags{name value}}}}}`;
  const newest = new Map<string, RawNode>();
  const pages = await Promise.all(ENDPOINTS.map((ep) => gqlPage(ep, query, { app: [APP_RECORD], b: [boardId] })));
  for (const n of pages.flat()) {
    const rid = tag(n, "Record"); if (!rid) continue;
    const prev = newest.get(rid);
    if (!prev || Number(tag(n, "Unix-Time") ?? 0) > Number(tag(prev, "Unix-Time") ?? 0)) newest.set(rid, n);
  }
  const out: ItsmRecord[] = [];
  await Promise.all([...newest.values()].map(async (n) => {
    const body = await fetchBody(n.id); if (!body) return;
    const rec = await decryptPayload<ItsmRecord>(key, body);
    if (rec && rec.id) out.push({ ...rec, boardId, owner: rec.owner ?? n.owner.address });
  }));
  return out;
}
