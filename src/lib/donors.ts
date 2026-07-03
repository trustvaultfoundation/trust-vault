// Top supporters — a public leaderboard of donors, curated by the admin. The admin records each
// supporter (a wallet/name + a contribution value) as a signed Arweave record; only records signed by
// ADMIN_ADDRESS are honored. Anyone reads the aggregated, sorted list. Same publish/read pattern as the
// forum/DAO. No token — values are a contribution amount the admin enters (USD-equivalent).

import { publishRecords } from "./turbo";
import { ADMIN_ADDRESS } from "./forum";

export { ADMIN_ADDRESS };

const APP_DONOR = "GTV-Donor";
const APP_DONOR_MOD = "GTV-Donor-Mod"; // admin delete
const DONOR_APPS = [APP_DONOR, APP_DONOR_MOD];
const ENDPOINTS = ["https://arweave.net/graphql", "https://turbo-gateway.com/graphql"];
const DATA_GATEWAYS = ["https://turbo-gateway.com", "https://arweave.net"];

interface DonorBody { id: string; donor: string; amount: number; note?: string; at: number }
interface ModBody { id: string; at: number }
export interface Donor { id: string; donor: string; amount: number; note?: string; at: number }

const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

// ── publish (admin) ─────────────────────────────────────────────────────────────
export async function publishDonor(d: { id?: string; donor: string; amount: number; note?: string }): Promise<string> {
  const id = d.id ?? uid();
  const at = Date.now();
  const body: DonorBody = { id, donor: d.donor.slice(0, 120), amount: Math.max(0, d.amount), note: d.note?.slice(0, 200), at };
  await publishRecords([{ data: enc(body), tags: [
    { name: "App-Name", value: APP_DONOR },
    { name: "Donor-Id", value: id },
    { name: "Unix-Time", value: String(at) },
  ] }]);
  return id;
}

export async function removeDonor(id: string): Promise<void> {
  const body: ModBody = { id, at: Date.now() };
  await publishRecords([{ data: enc(body), tags: [
    { name: "App-Name", value: APP_DONOR_MOD },
    { name: "Donor-Id", value: id },
    { name: "Unix-Time", value: String(Date.now()) },
  ] }]);
}

// ── read ─────────────────────────────────────────────────────────────────────
interface RawNode { id: string; owner: { address: string }; tags: { name: string; value: string }[] }
const tagv = (n: RawNode, name: string) => n.tags.find((t) => t.name === name)?.value;
const bodyCache = new Map<string, string>();

async function gqlPage(endpoint: string, query: string, variables: Record<string, unknown>): Promise<{ nodes: RawNode[]; cursor: string | null; hasNext: boolean }> {
  try {
    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { nodes: [], cursor: null, hasNext: false };
    const json = (await res.json()) as { data?: { transactions?: { pageInfo?: { hasNextPage?: boolean }; edges?: { cursor: string; node: RawNode }[] } } };
    const edges = json?.data?.transactions?.edges ?? [];
    return { nodes: edges.map((e) => e.node), cursor: edges.length ? edges[edges.length - 1].cursor : null, hasNext: !!json?.data?.transactions?.pageInfo?.hasNextPage };
  } catch { return { nodes: [], cursor: null, hasNext: false }; }
}
async function fetchBody(txId: string): Promise<unknown | null> {
  const hit = bodyCache.get(txId);
  if (hit !== undefined) { try { return JSON.parse(hit); } catch { return null; } }
  for (const base of DATA_GATEWAYS) {
    try { const res = await fetch(`${base}/${txId}`, { signal: AbortSignal.timeout(10000) }); if (res.ok) { const text = (await res.text()).trim(); bodyCache.set(txId, text); try { return JSON.parse(text); } catch { return null; } } } catch { /* next */ }
  }
  return null;
}

/** Fetch the admin-curated supporters, latest per id, minus removed, sorted by amount (desc). */
export async function fetchDonors(): Promise<Donor[]> {
  const byId = new Map<string, RawNode>();
  const query = `query($app:[String!]!,$a:String){transactions(tags:[{name:"App-Name",values:$app}],first:100,after:$a,sort:HEIGHT_DESC){pageInfo{hasNextPage}edges{cursor node{id owner{address} tags{name value}}}}}`;
  await Promise.all(ENDPOINTS.map(async (endpoint) => {
    let after: string | null = null;
    for (let page = 0; page < 10; page++) {
      const { nodes, cursor, hasNext } = await gqlPage(endpoint, query, { app: DONOR_APPS, a: after });
      for (const n of nodes) if (!byId.has(n.id)) byId.set(n.id, n);
      if (!hasNext || nodes.length === 0 || !cursor) break;
      after = cursor;
    }
  }));
  const nodes = [...byId.values()].filter((n) => n.owner.address === ADMIN_ADDRESS); // only admin records count
  // removals
  const removed = new Set<string>();
  for (const n of nodes.filter((n) => tagv(n, "App-Name") === APP_DONOR_MOD)) {
    const b = (await fetchBody(n.id)) as ModBody | null;
    if (b?.id) removed.add(b.id);
  }
  // latest donor record per id
  const latest = new Map<string, DonorBody>();
  for (const n of nodes.filter((n) => tagv(n, "App-Name") === APP_DONOR)) {
    const b = (await fetchBody(n.id)) as DonorBody | null;
    if (!b?.id || removed.has(b.id)) continue;
    const prev = latest.get(b.id);
    if (!prev || (b.at || 0) >= (prev.at || 0)) latest.set(b.id, b);
  }
  return [...latest.values()]
    .filter((d) => !removed.has(d.id))
    .map((d) => ({ id: d.id, donor: d.donor, amount: Number(d.amount) || 0, note: d.note, at: d.at }))
    .sort((a, b) => b.amount - a.amount || b.at - a.at);
}
