// Forum reads — fetch the public GTV-Forum-* records off Arweave via GraphQL (the chatSync pattern),
// resolve their JSON bodies (cached forever per txId — data items are immutable), and hand forum.ts a
// classified ForumRaw to aggregate. No wallet needed to READ (the forum is public).

import {
  FORUM_APPS, APP_POST, APP_COMMENT, APP_VOTE, APP_MOD,
  type ForumRaw, type PostRecord, type CommentRecord, type VoteRecord, type ModRecord,
} from "./forum";

const ENDPOINTS = ["https://arweave.net/graphql", "https://turbo-gateway.com/graphql"];
const DATA_GATEWAYS = ["https://turbo-gateway.com", "https://arweave.net"];
// Bodies are cached IN MEMORY for the session (data items are immutable). Deliberately NOT in
// localStorage: a growing forum-body cache could fill storage and make the critical key caches
// (gtv_boardkey_/gtv_chatkey_/gtv_master_) fail silently → endless wallet decrypt prompts.
const bodyCache = new Map<string, string>();

interface RawNode { id: string; owner: { address: string }; tags: { name: string; value: string }[] }
const tagv = (n: RawNode, name: string) => n.tags.find((t) => t.name === name)?.value;

async function gqlPage(endpoint: string, query: string, variables: Record<string, unknown>): Promise<{ nodes: RawNode[]; cursor: string | null; hasNext: boolean }> {
  try {
    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { nodes: [], cursor: null, hasNext: false };
    const json = (await res.json()) as { data?: { transactions?: { pageInfo?: { hasNextPage?: boolean }; edges?: { cursor: string; node: RawNode }[] } } };
    const edges = json?.data?.transactions?.edges ?? [];
    return { nodes: edges.map((e) => e.node), cursor: edges.length ? edges[edges.length - 1].cursor : null, hasNext: !!json?.data?.transactions?.pageInfo?.hasNextPage };
  } catch { return { nodes: [], cursor: null, hasNext: false }; }
}

// All forum nodes (tags only), newest first, deduped by txId across both gateways.
async function fetchForumNodes(): Promise<RawNode[]> {
  const byId = new Map<string, RawNode>();
  const query = `query($app:[String!]!,$a:String){transactions(tags:[{name:"App-Name",values:$app}],first:100,after:$a,sort:HEIGHT_DESC){pageInfo{hasNextPage}edges{cursor node{id owner{address} tags{name value}}}}}`;
  await Promise.all(ENDPOINTS.map(async (endpoint) => {
    let after: string | null = null;
    for (let page = 0; page < 25; page++) {
      const { nodes, cursor, hasNext } = await gqlPage(endpoint, query, { app: FORUM_APPS, a: after });
      for (const n of nodes) if (!byId.has(n.id)) byId.set(n.id, n);
      if (!hasNext || nodes.length === 0 || !cursor) break;
      after = cursor;
    }
  }));
  return [...byId.values()];
}

async function fetchBody(txId: string): Promise<string | null> {
  const hit = bodyCache.get(txId);
  if (hit !== undefined) return hit;
  for (const base of DATA_GATEWAYS) {
    try {
      const res = await fetch(`${base}/${txId}`, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const text = (await res.text()).trim();
        bodyCache.set(txId, text);
        return text;
      }
    } catch { /* try next gateway */ }
  }
  return null;
}

// Fetch many bodies with a small concurrency cap (avoid hammering a gateway).
async function fetchBodies(txIds: string[]): Promise<Map<string, unknown>> {
  const out = new Map<string, unknown>();
  const LIMIT = 8;
  for (let i = 0; i < txIds.length; i += LIMIT) {
    const slice = txIds.slice(i, i + LIMIT);
    await Promise.all(slice.map(async (txId) => {
      const text = await fetchBody(txId);
      if (text == null) return;
      try { out.set(txId, JSON.parse(text)); } catch { /* malformed — skip */ }
    }));
  }
  return out;
}

/** Read the whole forum: classify nodes by App-Name, resolve bodies, return parsed records. */
export async function fetchForum(): Promise<ForumRaw> {
  const nodes = await fetchForumNodes();
  const bodies = await fetchBodies(nodes.map((n) => n.id));
  const posts: PostRecord[] = [];
  const comments: CommentRecord[] = [];
  const votes: VoteRecord[] = [];
  const mods: ModRecord[] = [];
  for (const n of nodes) {
    const b = bodies.get(n.id);
    if (!b || typeof b !== "object") continue;
    const author = n.owner.address;
    switch (tagv(n, "App-Name")) {
      case APP_POST: posts.push({ txId: n.id, author, b: b as PostRecord["b"] }); break;
      case APP_COMMENT: comments.push({ txId: n.id, author, b: b as CommentRecord["b"] }); break;
      case APP_VOTE: votes.push({ txId: n.id, author, b: b as VoteRecord["b"] }); break;
      case APP_MOD: mods.push({ txId: n.id, author, b: b as ModRecord["b"] }); break;
    }
  }
  return { posts, comments, votes, mods };
}
