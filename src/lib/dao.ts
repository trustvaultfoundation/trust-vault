// TrustVault governance — free, one-wallet-one-vote polls. Proposals and votes are public, signed
// Arweave records (same publish/read pattern as the forum). No token: every wallet's vote counts once.
// Proposals are created by the project admin; any connected wallet can vote. The admin can also delete
// or close a proposal. Arweave is immutable, so a changed vote = a republished record (latest per voter
// wins), and "delete/close" are admin-signed moderation records honored at read time.

import { publishRecords } from "./turbo";
import { ADMIN_ADDRESS } from "./forum";

export { ADMIN_ADDRESS };

const APP_PROPOSAL = "GTV-DAO-Proposal";
const APP_VOTE = "GTV-DAO-Vote";
const APP_MOD = "GTV-DAO-Mod"; // admin-only: delete / close a proposal
const DAO_APPS = [APP_PROPOSAL, APP_VOTE, APP_MOD];

const ENDPOINTS = ["https://arweave.net/graphql", "https://turbo-gateway.com/graphql"];
const DATA_GATEWAYS = ["https://turbo-gateway.com", "https://arweave.net"];

interface ProposalBody { id: string; title: string; body: string; options: string[]; endAt: number; at: number; name: string }
interface VoteBody { proposalId: string; option: string; at: number }
interface ModBody { action: "delete" | "close"; proposalId: string; at: number }

interface ProposalRecord { txId: string; author: string; b: ProposalBody }
interface VoteRecord { txId: string; author: string; b: VoteBody }
interface ModRecord { author: string; b: ModBody }
export interface DaoRaw { proposals: ProposalRecord[]; votes: VoteRecord[]; mods: ModRecord[] }

const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

// ── publish ───────────────────────────────────────────────────────────────────
export async function publishProposal(p: { id?: string; title: string; body: string; options: string[]; endAt: number; name: string }): Promise<string> {
  const id = p.id ?? uid();
  const at = Date.now();
  const body: ProposalBody = { id, title: p.title.slice(0, 300), body: p.body, options: p.options, endAt: p.endAt, at, name: p.name };
  await publishRecords([{ data: enc(body), tags: [
    { name: "App-Name", value: APP_PROPOSAL },
    { name: "Proposal-Id", value: id },
    { name: "Unix-Time", value: String(at) },
  ] }]);
  return id;
}

/** One wallet, one vote — the voter is the record's signer; latest vote per wallet wins. */
export async function publishVote(proposalId: string, option: string): Promise<void> {
  const at = Date.now();
  const body: VoteBody = { proposalId, option, at };
  await publishRecords([{ data: enc(body), tags: [
    { name: "App-Name", value: APP_VOTE },
    { name: "Proposal-Id", value: proposalId },
    { name: "Unix-Time", value: String(at) },
  ] }]);
}

/** Admin-only: delete (hide) or close (end now) a proposal. Honored only if signed by ADMIN_ADDRESS. */
export async function publishMod(action: "delete" | "close", proposalId: string): Promise<void> {
  const at = Date.now();
  const body: ModBody = { action, proposalId, at };
  await publishRecords([{ data: enc(body), tags: [
    { name: "App-Name", value: APP_MOD },
    { name: "Proposal-Id", value: proposalId },
    { name: "Unix-Time", value: String(at) },
  ] }]);
}

// ── read (GraphQL by App-Name, bodies cached in-memory) ─────────────────────────
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
    try {
      const res = await fetch(`${base}/${txId}`, { signal: AbortSignal.timeout(10000) });
      if (res.ok) { const text = (await res.text()).trim(); bodyCache.set(txId, text); try { return JSON.parse(text); } catch { return null; } }
    } catch { /* next gateway */ }
  }
  return null;
}

export async function fetchDao(): Promise<DaoRaw> {
  const byId = new Map<string, RawNode>();
  const query = `query($app:[String!]!,$a:String){transactions(tags:[{name:"App-Name",values:$app}],first:100,after:$a,sort:HEIGHT_DESC){pageInfo{hasNextPage}edges{cursor node{id owner{address} tags{name value}}}}}`;
  await Promise.all(ENDPOINTS.map(async (endpoint) => {
    let after: string | null = null;
    for (let page = 0; page < 20; page++) {
      const { nodes, cursor, hasNext } = await gqlPage(endpoint, query, { app: DAO_APPS, a: after });
      for (const n of nodes) if (!byId.has(n.id)) byId.set(n.id, n);
      if (!hasNext || nodes.length === 0 || !cursor) break;
      after = cursor;
    }
  }));
  const proposals: ProposalRecord[] = [];
  const votes: VoteRecord[] = [];
  const mods: ModRecord[] = [];
  const LIMIT = 8;
  const nodes = [...byId.values()];
  for (let i = 0; i < nodes.length; i += LIMIT) {
    await Promise.all(nodes.slice(i, i + LIMIT).map(async (n) => {
      const b = await fetchBody(n.id);
      if (!b || typeof b !== "object") return;
      const app = tagv(n, "App-Name");
      if (app === APP_PROPOSAL) proposals.push({ txId: n.id, author: n.owner.address, b: b as ProposalBody });
      else if (app === APP_VOTE) votes.push({ txId: n.id, author: n.owner.address, b: b as VoteBody });
      else if (app === APP_MOD) mods.push({ author: n.owner.address, b: b as ModBody });
    }));
  }
  return { proposals, votes, mods };
}

// ── aggregate ───────────────────────────────────────────────────────────────────
export interface ProposalResult {
  id: string; title: string; body: string; options: string[]; at: number; endAt: number; name: string; author: string;
  open: boolean; totalVotes: number; tally: { option: string; votes: number; pct: number }[]; myOption: string | null; voterCount: number;
}

function latest<R extends { b: { at: number } }>(records: R[], key: (r: R) => string): Map<string, R> {
  const m = new Map<string, R>();
  for (const r of records) { const k = key(r); const p = m.get(k); if (!p || r.b.at >= p.b.at) m.set(k, r); }
  return m;
}

/** Build governance state: admin-authored proposals, one vote per wallet, with %s + open/closed. */
export function buildDaoState(raw: DaoRaw, me: string | null): ProposalResult[] {
  const now = Date.now();
  // admin moderation: latest action per proposal (delete wins permanently; close sets an end time)
  const deleted = new Set<string>();
  const closedAt = new Map<string, number>();
  for (const m of raw.mods) {
    if (m.author !== ADMIN_ADDRESS) continue;
    if (m.b.action === "delete") deleted.add(m.b.proposalId);
    else if (m.b.action === "close") closedAt.set(m.b.proposalId, Math.min(closedAt.get(m.b.proposalId) ?? Infinity, m.b.at));
  }

  const props = [...latest(raw.proposals, (p) => p.b.id).values()].filter((p) => p.author === ADMIN_ADDRESS && !deleted.has(p.b.id));
  // latest vote per (voter, proposal)
  const latestVote = new Map<string, VoteRecord>();
  for (const v of raw.votes) {
    const k = `${v.author}|${v.b.proposalId}`;
    const prev = latestVote.get(k);
    if (!prev || v.b.at >= prev.b.at) latestVote.set(k, v);
  }
  const votesByProposal = new Map<string, VoteRecord[]>();
  for (const v of latestVote.values()) {
    const arr = votesByProposal.get(v.b.proposalId) ?? [];
    arr.push(v); votesByProposal.set(v.b.proposalId, arr);
  }
  return props
    .map((p): ProposalResult => {
      const endAt = Math.min(p.b.endAt, closedAt.get(p.b.id) ?? Infinity);
      const votes = (votesByProposal.get(p.b.id) ?? []).filter((v) => p.b.options.includes(v.b.option));
      const countByOption = new Map<string, number>();
      let myOption: string | null = null;
      for (const v of votes) {
        countByOption.set(v.b.option, (countByOption.get(v.b.option) ?? 0) + 1);
        if (me && v.author === me) myOption = v.b.option;
      }
      const total = votes.length;
      const tally = p.b.options.map((option) => {
        const n = countByOption.get(option) ?? 0;
        return { option, votes: n, pct: total > 0 ? (n / total) * 100 : 0 };
      });
      return { id: p.b.id, title: p.b.title, body: p.b.body, options: p.b.options, at: p.b.at, endAt, name: p.b.name, author: p.author, open: now < endAt, totalVotes: total, tally, myOption, voterCount: total };
    })
    .sort((a, b) => (Number(a.open) - Number(b.open) === 0 ? b.at - a.at : Number(b.open) - Number(a.open))); // open first, then newest
}
