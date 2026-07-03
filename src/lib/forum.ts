// TrustVault Forum — a PUBLIC, on-chain forum (feedback / community). Unlike the rest of the app
// (per-wallet encrypted vault), forum content is public + plaintext: each action is a signed ANS-104
// data item published via Turbo (free tier for small text), read back via GraphQL by App-Name tag
// (see forumSync.ts). The author is the record's on-chain owner.address — used INTERNALLY for vote
// de-dup, blocking and the admin check, but NEVER shown in the UI (only the display name + Admin tag).
//
// Arweave is immutable, so: edits = republish the same id (latest Unix-Time wins); deletes/hides/
// blocks/renames = admin-signed moderation records honored at render time — and ONLY honored when the
// record's owner.address === ADMIN_ADDRESS, so they can't be forged.

import { publishRecords } from "./turbo";

/** The forum administrator. Shown only as an "Admin" tag; their moderation records are the only ones honored. */
export const ADMIN_ADDRESS = "lqlba1NflsOHu4Pfo3-AstuMubygv7cSUxuW6mC_2MU";

export interface Category { id: string; label: string; desc: string }
export const CATEGORIES: Category[] = [
  { id: "feedback", label: "Feedback", desc: "Tell us what to improve." },
  { id: "ideas", label: "Ideas", desc: "Feature requests & suggestions." },
  { id: "bugs", label: "Bugs", desc: "Something broken? Report it." },
  { id: "general", label: "General", desc: "Anything TrustVault." },
  { id: "announcements", label: "Announcements", desc: "News from the team." },
];
export const categoryLabel = (id: string): string => CATEGORIES.find((c) => c.id === id)?.label ?? id;
export const DEFAULT_CATEGORY = CATEGORIES[0].id;

// App-Name tag values (the forum's four record types).
export const APP_POST = "GTV-Forum-Post";
export const APP_COMMENT = "GTV-Forum-Comment";
export const APP_VOTE = "GTV-Forum-Vote";
export const APP_MOD = "GTV-Forum-Mod";
export const FORUM_APPS = [APP_POST, APP_COMMENT, APP_VOTE, APP_MOD];

// ── wire bodies (JSON) ──────────────────────────────────────────────────────────
interface PostBody { id: string; category: string; title: string; body: string; images?: string[]; at: number; name: string }
interface CommentBody { id: string; postId: string; parentId?: string; body: string; images?: string[]; at: number; name: string }
interface VoteBody { targetId: string; value: 1 | -1 | 0; at: number }
export type ModAction = "hide" | "delete" | "pin" | "unpin" | "block" | "unblock" | "rename";
interface ModBody { action: ModAction; targetId?: string; targetAddr?: string; name?: string; at: number }

// ── parsed records (body + on-chain author) — the boundary with forumSync.ts ──────
export interface PostRecord { txId: string; author: string; b: PostBody }
export interface CommentRecord { txId: string; author: string; b: CommentBody }
export interface VoteRecord { txId: string; author: string; b: VoteBody }
export interface ModRecord { txId: string; author: string; b: ModBody }
export interface ForumRaw { posts: PostRecord[]; comments: CommentRecord[]; votes: VoteRecord[]; mods: ModRecord[] }

// ── display name (local; stamped onto each record the user publishes) ─────────────
const NAME_KEY = "gtv_forum_name";
export function loadForumName(): string {
  try { return localStorage.getItem(NAME_KEY) ?? ""; } catch { return ""; }
}
export function saveForumName(name: string): void {
  try { localStorage.setItem(NAME_KEY, name.trim().slice(0, 40)); } catch { /* ignore */ }
}

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

// ── publish actions (require a connected wallet — publishRecords signs + posts to Turbo) ──
export async function publishPost(p: { id?: string; category: string; title: string; body: string; images?: string[]; name: string }): Promise<string> {
  const id = p.id ?? uid();
  const at = Date.now();
  const body: PostBody = { id, category: p.category, title: p.title.slice(0, 300), body: p.body, images: p.images, at, name: p.name };
  await publishRecords([{ data: enc(body), tags: [
    { name: "App-Name", value: APP_POST },
    { name: "Post-Id", value: id },
    { name: "Category", value: p.category },
    { name: "Unix-Time", value: String(at) },
  ] }]);
  return id;
}
export async function publishComment(c: { id?: string; postId: string; parentId?: string; body: string; images?: string[]; name: string }): Promise<string> {
  const id = c.id ?? uid();
  const at = Date.now();
  const body: CommentBody = { id, postId: c.postId, parentId: c.parentId, body: c.body, images: c.images, at, name: c.name };
  await publishRecords([{ data: enc(body), tags: [
    { name: "App-Name", value: APP_COMMENT },
    { name: "Post-Id", value: c.postId },
    { name: "Comment-Id", value: id },
    { name: "Unix-Time", value: String(at) },
  ] }]);
  return id;
}
export async function publishVote(targetId: string, value: 1 | -1 | 0): Promise<void> {
  const at = Date.now();
  const body: VoteBody = { targetId, value, at };
  await publishRecords([{ data: enc(body), tags: [
    { name: "App-Name", value: APP_VOTE },
    { name: "Target-Id", value: targetId },
    { name: "Unix-Time", value: String(at) },
  ] }]);
}
export async function publishMod(m: Omit<ModBody, "at">): Promise<void> {
  const at = Date.now();
  await publishRecords([{ data: enc({ ...m, at }), tags: [
    { name: "App-Name", value: APP_MOD },
    ...(m.targetId ? [{ name: "Target-Id", value: m.targetId }] : []),
    { name: "Unix-Time", value: String(at) },
  ] }]);
}

// ── aggregation (mod log + votes + threads) ───────────────────────────────────────
export interface ForumComment {
  id: string; postId: string; parentId?: string; body: string; images: string[];
  at: number; name: string; author: string; isAdmin: boolean; score: number; myVote: 0 | 1 | -1; children: ForumComment[];
}
export interface ForumPost {
  id: string; category: string; title: string; body: string; images: string[];
  at: number; name: string; author: string; isAdmin: boolean; score: number; myVote: 0 | 1 | -1; commentCount: number; pinned: boolean;
}
export interface ForumState {
  posts: ForumPost[];
  commentsByPost: Map<string, ForumComment[]>; // top-level comments (with nested children)
  blocked: Set<string>;
  blockedUsers: { address: string; name: string }[]; // for the admin's "Blocked" panel
}

// Latest record per logical id (edits republish the same id).
function latestById<R extends { b: { at: number } }>(records: R[], idOf: (r: R) => string): Map<string, R> {
  const m = new Map<string, R>();
  for (const r of records) {
    const id = idOf(r);
    const prev = m.get(id);
    if (!prev || r.b.at >= prev.b.at) m.set(id, r);
  }
  return m;
}

export function buildForumState(raw: ForumRaw, me: string | null): ForumState {
  // 1) Apply the admin-signed moderation log in chronological order.
  const mods = raw.mods.filter((m) => m.author === ADMIN_ADDRESS).sort((a, b) => a.b.at - b.b.at);
  const hidden = new Set<string>();
  const pinned = new Set<string>();
  const blocked = new Set<string>();
  const renames = new Map<string, string>();
  for (const m of mods) {
    const t = m.b;
    if ((t.action === "hide" || t.action === "delete") && t.targetId) hidden.add(t.targetId);
    else if (t.action === "pin" && t.targetId) pinned.add(t.targetId);
    else if (t.action === "unpin" && t.targetId) pinned.delete(t.targetId);
    else if (t.action === "block" && t.targetAddr) blocked.add(t.targetAddr);
    else if (t.action === "unblock" && t.targetAddr) blocked.delete(t.targetAddr);
    else if (t.action === "rename" && t.targetAddr && t.name) renames.set(t.targetAddr, t.name);
  }
  const nameOf = (author: string, stamped: string) => renames.get(author) ?? stamped;
  const visible = (id: string, author: string) => !hidden.has(id) && !blocked.has(author);

  // Latest display name seen per author (so the admin's blocked list shows names, not addresses).
  const nameByAuthor = new Map<string, { name: string; at: number }>();
  const noteName = (author: string, name: string, at: number) => { const c = nameByAuthor.get(author); if (!c || at >= c.at) nameByAuthor.set(author, { name, at }); };
  for (const r of raw.posts) noteName(r.author, r.b.name, r.b.at);
  for (const r of raw.comments) noteName(r.author, r.b.name, r.b.at);

  // 2) Tally votes — latest per (author, target), blocked authors excluded.
  const latestVote = new Map<string, VoteRecord>(); // key: author|target
  for (const v of raw.votes) {
    if (blocked.has(v.author)) continue;
    const key = `${v.author}|${v.b.targetId}`;
    const prev = latestVote.get(key);
    if (!prev || v.b.at >= prev.b.at) latestVote.set(key, v);
  }
  const score = new Map<string, number>();
  const myVote = new Map<string, 0 | 1 | -1>();
  for (const v of latestVote.values()) {
    score.set(v.b.targetId, (score.get(v.b.targetId) ?? 0) + v.b.value);
    if (me && v.author === me) myVote.set(v.b.targetId, v.b.value);
  }

  // 3) Posts (latest per id, visible).
  const posts: ForumPost[] = [];
  for (const r of latestById(raw.posts, (p) => p.b.id).values()) {
    if (!visible(r.b.id, r.author)) continue;
    posts.push({
      id: r.b.id, category: r.b.category, title: r.b.title, body: r.b.body, images: r.b.images ?? [],
      at: r.b.at, name: nameOf(r.author, r.b.name), author: r.author, isAdmin: r.author === ADMIN_ADDRESS,
      score: score.get(r.b.id) ?? 0, myVote: myVote.get(r.b.id) ?? 0, commentCount: 0, pinned: pinned.has(r.b.id),
    });
  }

  // 4) Comments (latest per id, visible) → trees per post.
  const flat: ForumComment[] = [];
  for (const r of latestById(raw.comments, (c) => c.b.id).values()) {
    if (!visible(r.b.id, r.author)) continue;
    flat.push({
      id: r.b.id, postId: r.b.postId, parentId: r.b.parentId, body: r.b.body, images: r.b.images ?? [],
      at: r.b.at, name: nameOf(r.author, r.b.name), author: r.author, isAdmin: r.author === ADMIN_ADDRESS,
      score: score.get(r.b.id) ?? 0, myVote: myVote.get(r.b.id) ?? 0, children: [],
    });
  }
  const byId = new Map(flat.map((c) => [c.id, c]));
  const commentsByPost = new Map<string, ForumComment[]>();
  const countByPost = new Map<string, number>();
  for (const c of flat) {
    countByPost.set(c.postId, (countByPost.get(c.postId) ?? 0) + 1);
    const parent = c.parentId ? byId.get(c.parentId) : undefined;
    if (parent && parent.postId === c.postId) parent.children.push(c);
    else {
      const arr = commentsByPost.get(c.postId) ?? [];
      arr.push(c);
      commentsByPost.set(c.postId, arr);
    }
  }
  const byNew = (a: ForumComment, b: ForumComment) => a.at - b.at;
  const sortTree = (list: ForumComment[]) => { list.sort(byNew); for (const c of list) sortTree(c.children); };
  for (const list of commentsByPost.values()) sortTree(list);
  for (const p of posts) p.commentCount = countByPost.get(p.id) ?? 0;

  const shortId = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  const blockedUsers = [...blocked].map((address) => ({ address, name: renames.get(address) ?? nameByAuthor.get(address)?.name ?? shortId(address) }));

  return { posts, commentsByPost, blocked, blockedUsers };
}

// ── sort + search ─────────────────────────────────────────────────────────────────
export type ForumSort = "hot" | "new" | "top";
const pinnedFirst = (a: ForumPost, b: ForumPost) => Number(b.pinned) - Number(a.pinned);
export function sortPosts(posts: ForumPost[], sort: ForumSort): ForumPost[] {
  const arr = [...posts];
  if (sort === "new") arr.sort((a, b) => pinnedFirst(a, b) || b.at - a.at);
  else if (sort === "top") arr.sort((a, b) => pinnedFirst(a, b) || b.score - a.score || b.at - a.at);
  else {
    const hot = (p: ForumPost) => (p.score + 1) / Math.pow((Date.now() - p.at) / 3_600_000 + 2, 1.5);
    arr.sort((a, b) => pinnedFirst(a, b) || hot(b) - hot(a));
  }
  return arr;
}
export function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
export function searchPosts(posts: ForumPost[], q: string): ForumPost[] {
  const t = q.trim().toLowerCase();
  if (!t) return posts;
  return posts.filter((p) => p.title.toLowerCase().includes(t) || stripHtml(p.body).toLowerCase().includes(t) || p.name.toLowerCase().includes(t));
}
