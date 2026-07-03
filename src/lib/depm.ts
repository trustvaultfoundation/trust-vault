// DePM — Decentralized Project Management: the public, read-only showcase of boards a project owner
// chooses to share. The real board is end-to-end encrypted, so "make public" publishes a PLAINTEXT
// snapshot (company info + the projects/columns/ticket titles the owner picks + progress) as an Arweave
// record. Snapshots are signed by a per-wallet app key (lib/depmKey) so re-publishing as the board
// changes never pops a wallet approval. The public /projects page reads these so anyone can study a
// team's real, on-chain progress — transparency beyond marketing.

import { publishRecords } from "./turbo";
import { publishDepmRecords, depmAuthorAddress } from "./depmKey";
import { ADMIN_ADDRESS } from "./forum";
import { boardColumns, boardProjects, isDoneColumn, statusLabel, type BoardState } from "./board";

export { ADMIN_ADDRESS };

const APP_PROJECT = "GTV-DePM-Project";
const APP_MOD = "GTV-DePM-Mod"; // admin hide/unhide (anti-scam), honored only if signed by ADMIN
const APP_REPORT = "GTV-DePM-Report"; // anyone can flag a project as fake/spam → admin reviews
const DEPM_APPS = [APP_PROJECT, APP_MOD, APP_REPORT];
const ENDPOINTS = ["https://arweave.net/graphql", "https://turbo-gateway.com/graphql"];
const DATA_GATEWAYS = ["https://turbo-gateway.com", "https://arweave.net"];
const TICKETS_PER_COLUMN = 40; // cap to keep the snapshot in Turbo's free tier

// ── taxonomy (filterable on the public page) ────────────────────────────────────
export type SocialKind = "x" | "discord" | "telegram" | "github" | "linkedin" | "youtube" | "medium" | "email";
export const SOCIAL_KINDS: { kind: SocialKind; label: string; placeholder: string }[] = [
  { kind: "x", label: "X / Twitter", placeholder: "x.com/yourproject" },
  { kind: "discord", label: "Discord", placeholder: "discord.gg/…" },
  { kind: "telegram", label: "Telegram", placeholder: "t.me/…" },
  { kind: "github", label: "GitHub", placeholder: "github.com/…" },
  { kind: "linkedin", label: "LinkedIn", placeholder: "linkedin.com/company/…" },
  { kind: "youtube", label: "YouTube", placeholder: "youtube.com/@…" },
  { kind: "medium", label: "Medium / Blog", placeholder: "blog url" },
  { kind: "email", label: "Email", placeholder: "hello@project.com" },
];
// Categories cover BOTH decentralized/web3 and traditional sectors, so any company fits.
// `group` powers the grouped option list in the pickers/filter.
export const CATEGORY_GROUPS: { group: string; items: string[] }[] = [
  {
    group: "Decentralized / Web3",
    items: [
      "DePM / Project Management", "DeFi", "Infrastructure / Protocols", "Developer Tooling",
      "DAO / Governance", "NFT / Creators", "Gaming / Metaverse", "Privacy & Security",
      "Data / Storage", "Identity", "Payments / Wallets", "Real-World Assets (RWA)",
      "DeSci (Science)", "DePIN (Physical Infra)", "AI / Agents", "Oracles",
      "Bridges / Interoperability", "Exchanges / Trading", "Social / Community (Web3)",
    ],
  },
  {
    group: "Traditional",
    items: [
      "SaaS / Software", "Fintech", "E-commerce / Retail", "Healthcare", "Education",
      "Marketing / Media", "Productivity", "Hardware / IoT", "Logistics / Supply Chain",
      "Real Estate", "Energy / Climate", "Non-profit", "Consulting / Services", "Other",
    ],
  },
];
export const CATEGORIES = CATEGORY_GROUPS.flatMap((g) => g.items);
export const EMPLOYEE_RANGES = ["Just me", "2–10", "11–50", "51–200", "201–500", "500+"] as const;

// ── per-board owner settings (local) ──────────────────────────────────────────
export interface DepmProjectInfo { id: string; description: string; isPublic: boolean }
export interface DepmSettings {
  company: string;
  logo?: { txId: string }; // public company logo image on Arweave
  tagline: string;        // one-line pitch
  description: string;    // longer "about"
  category: string;       // one of CATEGORIES (filterable)
  employees: string;      // one of EMPLOYEE_RANGES (filterable)
  founded: string;        // year, e.g. "2024"
  location: string;
  website: string;
  whitepaper: string;     // url
  whitepaperFile?: { txId: string; name: string }; // public file on Arweave (alternative to a url)
  socials: Partial<Record<SocialKind, string>>;
  projects: DepmProjectInfo[]; // per-project description + public flag (NOT public by default)
  isPublic: boolean;      // board-level "published" switch
  projectIds?: string[];  // legacy (pre-per-project); reconciled into `projects` by the UI
}
const emptySettings = (): DepmSettings => ({
  company: "", tagline: "", description: "", category: "", employees: "", founded: "", location: "",
  website: "", whitepaper: "", socials: {}, projects: [], isPublic: false,
});
const KEY = (boardId: string) => `gtv_depm_${boardId}`;
export function loadDepmSettings(boardId: string): DepmSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(boardId)) || "{}") as Partial<DepmSettings> & { twitter?: string; discord?: string };
    const s = { ...emptySettings(), ...raw };
    // migrate the old flat twitter/discord fields into the socials map
    if (raw.twitter && !s.socials.x) s.socials = { ...s.socials, x: raw.twitter };
    if (raw.discord && !s.socials.discord) s.socials = { ...s.socials, discord: raw.discord };
    return s;
  } catch { return emptySettings(); }
}
export function saveDepmSettings(boardId: string, s: DepmSettings): void {
  try { localStorage.setItem(KEY(boardId), JSON.stringify(s)); } catch { /* ignore */ }
}

/** Merge stored per-project info with the board's CURRENT projects (new projects default to private). */
export function reconcileProjects(state: BoardState, s: DepmSettings): DepmProjectInfo[] {
  const byId = new Map(s.projects.map((p) => [p.id, p]));
  const legacy = new Set(s.projectIds ?? []);
  return boardProjects(state).map((p) => {
    const existing = byId.get(p.id);
    if (existing) return existing;
    // legacy projectIds (empty meant "all") → keep those public; otherwise NOT public by default
    const legacyPublic = s.projectIds != null && (s.projectIds.length === 0 || legacy.has(p.id));
    return { id: p.id, description: "", isPublic: legacyPublic };
  });
}

// ── snapshot ───────────────────────────────────────────────────────────────────
export interface SnapColumn { label: string; done: boolean; tickets: { title: string; status: string }[]; count: number }
export interface SnapProject { name: string; description?: string; columns: SnapColumn[]; total: number; done: number }
interface ProjectBody {
  boardId: string; company: string; logo?: { txId: string }; tagline?: string; description?: string; category?: string;
  employees?: string; founded?: string; location?: string; website?: string; whitepaper?: string;
  whitepaperFile?: { txId: string; name: string };
  socials?: Partial<Record<SocialKind, string>>;
  isPublic: boolean; projects: SnapProject[]; total: number; done: number; at: number;
}

export function buildSnapshot(boardId: string, state: BoardState, s: DepmSettings): ProjectBody {
  const cols = boardColumns(state).filter((c) => !c.hidden);
  const colById = new Map(cols.map((c) => [c.id, c]));
  const top = state.tickets.filter((t) => !t.parentId);
  const info = reconcileProjects(state, s);
  const infoById = new Map(info.map((p) => [p.id, p]));
  const chosen = boardProjects(state).filter((p) => infoById.get(p.id)?.isPublic);
  const projects: SnapProject[] = chosen.map((p) => {
    const columns = p.columnIds
      .map((cid) => colById.get(cid))
      .filter((c): c is NonNullable<typeof c> => !!c)
      .map((c) => {
        const tickets = top.filter((t) => t.status === c.id);
        return { label: c.label, done: !!c.done, count: tickets.length, tickets: tickets.slice(0, TICKETS_PER_COLUMN).map((t) => ({ title: t.title || "(untitled)", status: statusLabel(t.status) })) };
      });
    const ids = new Set(p.columnIds);
    const inProj = top.filter((t) => ids.has(t.status));
    return {
      name: p.name, description: infoById.get(p.id)?.description || undefined, columns,
      total: inProj.length, done: inProj.filter((t) => isDoneColumn(state, t.status)).length,
    };
  });
  return {
    boardId, company: s.company, logo: s.logo?.txId ? s.logo : undefined,
    tagline: s.tagline || undefined, description: s.description || undefined,
    category: s.category || undefined, employees: s.employees || undefined, founded: s.founded || undefined,
    location: s.location || undefined, website: s.website || undefined, whitepaper: s.whitepaper || undefined,
    whitepaperFile: s.whitepaperFile?.txId ? s.whitepaperFile : undefined,
    socials: Object.keys(s.socials).length ? s.socials : undefined, isPublic: true, projects,
    total: projects.reduce((n, p) => n + p.total, 0), done: projects.reduce((n, p) => n + p.done, 0), at: Date.now(),
  };
}

// A stable signature of the snapshot's CONTENT (everything except the timestamp) — so the live
// auto-publisher only re-publishes when something actually changed, never on a no-op poll tick.
export function snapshotSignature(boardId: string, state: BoardState, s: DepmSettings): string {
  const { at: _at, ...rest } = buildSnapshot(boardId, state, s);
  void _at;
  return JSON.stringify(rest);
}

const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

/** Publish (or refresh) a board's public snapshot — signed by the wallet's DePM key (no popup). */
export async function publishProject(wallet: string, boardId: string, state: BoardState, s: DepmSettings): Promise<void> {
  await publishDepmRecords(wallet, [{ data: enc(buildSnapshot(boardId, state, s)), tags: [
    { name: "App-Name", value: APP_PROJECT },
    { name: "Board-Id", value: boardId },
    { name: "Unix-Time", value: String(Date.now()) },
  ] }]);
}

/** Take a board off the public page (publishes a tombstone the renderer honors). Silent. */
export async function unpublishProject(wallet: string, boardId: string, company: string): Promise<void> {
  const body: ProjectBody = { boardId, company, isPublic: false, projects: [], total: 0, done: 0, at: Date.now() };
  await publishDepmRecords(wallet, [{ data: enc(body), tags: [
    { name: "App-Name", value: APP_PROJECT },
    { name: "Board-Id", value: boardId },
    { name: "Unix-Time", value: String(Date.now()) },
  ] }]);
}

/** Admin-only: hide/unhide a project from the public page (anti-scam). target = `${author}:${boardId}`.
 *  Signed by the admin's real wallet (rare, deliberate) so it can't be forged. */
export async function publishMod(action: "hide" | "unhide", target: string): Promise<void> {
  await publishRecords([{ data: enc({ action, target, at: Date.now() }), tags: [
    { name: "App-Name", value: APP_MOD },
    { name: "Unix-Time", value: String(Date.now()) },
  ] }]);
}

/** Anyone (connected) can report a project as fake/spam — admin sees the reports and acts.
 *  target = `${author}:${boardId}`. Signed by the reporter's wallet (deduped per reporter). */
export async function publishReport(target: string, reason: string): Promise<void> {
  await publishRecords([{ data: enc({ target, reason: reason.slice(0, 500), at: Date.now() }), tags: [
    { name: "App-Name", value: APP_REPORT },
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
async function fetchBody(txId: string): Promise<Record<string, unknown> | null> {
  const hit = bodyCache.get(txId);
  if (hit !== undefined) { try { return JSON.parse(hit); } catch { return null; } }
  for (const base of DATA_GATEWAYS) {
    try { const res = await fetch(`${base}/${txId}`, { signal: AbortSignal.timeout(10000) }); if (res.ok) { const text = (await res.text()).trim(); bodyCache.set(txId, text); try { return JSON.parse(text); } catch { return null; } } } catch { /* next */ }
  }
  return null;
}

export interface PublicProject {
  key: string; boardId: string; author: string; company: string; logo?: { txId: string }; tagline?: string;
  category?: string; employees?: string; founded?: string; location?: string;
  website?: string; whitepaper?: string; whitepaperFile?: { txId: string; name: string };
  socials?: Partial<Record<SocialKind, string>>;
  description?: string; projects: SnapProject[]; total: number; done: number; updatedAt: number;
  hidden?: boolean;           // admin-hidden (shown only in the admin moderation view)
  reports?: { by: string; reason: string; at: number }[]; // user reports, deduped per reporter
}

/** Fetch every public project (latest snapshot per owner+board, public, not admin-hidden).
 *  Pass `{ includeHidden: true }` (admin moderation) to also return admin-hidden boards, each
 *  flagged with `hidden`, and to attach any user `reports`. */
export async function fetchPublicProjects(opts?: { includeHidden?: boolean }): Promise<PublicProject[]> {
  const byId = new Map<string, RawNode>();
  const query = `query($app:[String!]!,$a:String){transactions(tags:[{name:"App-Name",values:$app}],first:100,after:$a,sort:HEIGHT_DESC){pageInfo{hasNextPage}edges{cursor node{id owner{address} tags{name value}}}}}`;
  await Promise.all(ENDPOINTS.map(async (endpoint) => {
    let after: string | null = null;
    for (let page = 0; page < 20; page++) {
      const { nodes, cursor, hasNext } = await gqlPage(endpoint, query, { app: DEPM_APPS, a: after });
      for (const n of nodes) if (!byId.has(n.id)) byId.set(n.id, n);
      if (!hasNext || nodes.length === 0 || !cursor) break;
      after = cursor;
    }
  }));
  const nodes = [...byId.values()];
  // admin hide log (latest action per target wins)
  const modNodes = nodes.filter((n) => tagv(n, "App-Name") === APP_MOD && n.owner.address === ADMIN_ADDRESS);
  const hidden = new Set<string>();
  const mods: { target: string; action: string; at: number }[] = [];
  for (const n of modNodes) { const b = await fetchBody(n.id); if (b && typeof b.target === "string") mods.push({ target: b.target, action: String(b.action), at: Number(b.at) || 0 }); }
  mods.sort((a, b) => a.at - b.at);
  for (const m of mods) { if (m.action === "hide") hidden.add(m.target); else if (m.action === "unhide") hidden.delete(m.target); }

  // user reports, grouped by target, deduped per reporter (latest reason per reporter wins)
  const reportsByTarget = new Map<string, Map<string, { reason: string; at: number }>>();
  const repNodes = nodes.filter((n) => tagv(n, "App-Name") === APP_REPORT);
  for (let i = 0; i < repNodes.length; i += 8) {
    await Promise.all(repNodes.slice(i, i + 8).map(async (n) => {
      const b = await fetchBody(n.id);
      if (!b || typeof b.target !== "string") return;
      const byReporter = reportsByTarget.get(b.target) ?? new Map();
      const prev = byReporter.get(n.owner.address);
      const at = Number(b.at) || 0;
      if (!prev || at >= prev.at) byReporter.set(n.owner.address, { reason: String(b.reason ?? ""), at });
      reportsByTarget.set(b.target, byReporter);
    }));
  }

  // latest project snapshot per (author|boardId)
  const latest = new Map<string, { node: RawNode; body: ProjectBody }>();
  const projNodes = nodes.filter((n) => tagv(n, "App-Name") === APP_PROJECT);
  const LIMIT = 8;
  for (let i = 0; i < projNodes.length; i += LIMIT) {
    await Promise.all(projNodes.slice(i, i + LIMIT).map(async (n) => {
      const b = (await fetchBody(n.id)) as ProjectBody | null;
      if (!b || !b.boardId) return;
      const k = `${n.owner.address}|${b.boardId}`;
      const prev = latest.get(k);
      if (!prev || (b.at || 0) >= (prev.body.at || 0)) latest.set(k, { node: n, body: b });
    }));
  }

  // Collapse to ONE entry per board, newest snapshot wins. A board's DePM author key can change
  // (e.g. a cache wipe mints a fresh key, or an early snapshot was wallet-signed), which would
  // otherwise show the same board twice — we always keep its latest published state.
  const byBoard = new Map<string, { node: RawNode; body: ProjectBody }>();
  for (const entry of latest.values()) {
    const prev = byBoard.get(entry.body.boardId);
    if (!prev || (entry.body.at || 0) >= (prev.body.at || 0)) byBoard.set(entry.body.boardId, entry);
  }

  const out: PublicProject[] = [];
  for (const { node, body } of byBoard.values()) {
    if (!body.isPublic) continue;
    const key = `${node.owner.address}:${body.boardId}`;
    const isHidden = hidden.has(key);
    if (isHidden && !opts?.includeHidden) continue;
    const reps = reportsByTarget.get(key);
    out.push({
      key, boardId: body.boardId, author: node.owner.address, company: body.company || "Untitled project",
      logo: body.logo?.txId ? body.logo : undefined,
      tagline: body.tagline, category: body.category, employees: body.employees, founded: body.founded,
      location: body.location, website: body.website, whitepaper: body.whitepaper, whitepaperFile: body.whitepaperFile,
      socials: body.socials, description: body.description, projects: body.projects ?? [],
      total: body.total ?? 0, done: body.done ?? 0, updatedAt: body.at ?? 0,
      hidden: isHidden,
      reports: reps ? [...reps.entries()].map(([by, v]) => ({ by, reason: v.reason, at: v.at })).sort((a, b) => b.at - a.at) : undefined,
    });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export { depmAuthorAddress };
