// Encrypted multi-party chat — a message log that mirrors the shared-board model
// (chatSync.ts): a per-chat AES key encrypts every message and is RSA-wrapped to
// each member via a signed Turbo "grant"; members are picked from Access Keys.
// Read access is cryptographic; like shared boards, sync isn't realtime (Arweave
// indexing takes ~seconds-to-minutes, so the UI polls).

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);

export interface ChatMember {
  address: string;
  label: string;
}

export interface ChatMessage {
  id: string;
  author: string; // wallet address
  authorLabel: string; // display name the sender used
  text: string;
  at: number; // unix ms — creation time (stays fixed across edits, drives ordering)
  editedAt?: number; // unix ms of the latest edit, if edited
  reactions?: Record<string, string[]>; // emoji -> reactor addresses (derived in fold)
  pending?: boolean; // local-only: not yet confirmed on Arweave
  failed?: boolean; // local-only: publish failed
}

// One entry in a wallet's chat list (gtv_chats_<addr>).
export interface ChatMeta {
  id: string;
  title: string;
  owner: string; // creator's wallet address
  updatedAt: number;
}

// The folded contents of one chat (cached at gtv_chatstate_<chatId>).
export interface ChatState {
  members: ChatMember[];
  messages: ChatMessage[];
}

export const newChatId = uid;
export const newMsgId = uid;

const chatsKey = (addr: string) => `gtv_chats_${addr}`;
const stateKey = (id: string) => `gtv_chatstate_${id}`;

export function loadChats(addr: string | null): ChatMeta[] {
  if (!addr || typeof window === "undefined") return [];
  try { const raw = localStorage.getItem(chatsKey(addr)); return raw ? (JSON.parse(raw) as ChatMeta[]) : []; } catch { return []; }
}
export function saveChats(addr: string | null, metas: ChatMeta[]): void {
  if (!addr || typeof window === "undefined") return;
  try { localStorage.setItem(chatsKey(addr), JSON.stringify(metas)); } catch {}
}
export function loadChatState(id: string): ChatState {
  if (typeof window === "undefined") return { members: [], messages: [] };
  try { const raw = localStorage.getItem(stateKey(id)); if (raw) { const s = JSON.parse(raw) as ChatState; return { members: s.members ?? [], messages: s.messages ?? [] }; } } catch {}
  return { members: [], messages: [] };
}
export function saveChatState(id: string, st: ChatState): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(stateKey(id), JSON.stringify(st)); } catch {}
}

// Merge messages by id (incoming/confirmed wins over a local pending copy), sorted.
// Incoming (folded) reactions are authoritative. Edit-aware: a locally newer edit
// (optimistic, not yet indexed) is kept so the text doesn't flash back to the old one.
export function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const map = new Map(existing.map((m) => [m.id, m] as const));
  for (const m of incoming) {
    const ex = map.get(m.id);
    if (ex && (ex.editedAt ?? 0) > (m.editedAt ?? 0)) map.set(m.id, { ...m, text: ex.text, editedAt: ex.editedAt, pending: false, failed: false });
    else map.set(m.id, { ...ex, ...m, pending: false, failed: false });
  }
  return [...map.values()].sort((a, b) => a.at - b.at);
}

// Quick reactions shown on the message hover bar.
export const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🎉"];

// The newest activity time in a chat (creation or edit), 0 if empty — for list
// ordering / unread / read thresholds.
export function latestMessageAt(state: ChatState): number {
  let mx = 0;
  for (const m of state.messages) { const t = m.editedAt ?? m.at; if (t > mx) mx = t; }
  return mx;
}

// ── local per-wallet member name overrides (aliases) ──
// Rename any address locally so it's easy to recognise; overrides the roster label
// in the UI only (not published).
const aliasKey = (addr: string) => `gtv_chataliases_${addr}`;
export function loadAliases(addr: string | null): Record<string, string> {
  if (!addr || typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(aliasKey(addr)) || "{}"); } catch { return {}; }
}
export function saveAliases(addr: string | null, map: Record<string, string>): void {
  if (!addr || typeof window === "undefined") return;
  try { localStorage.setItem(aliasKey(addr), JSON.stringify(map)); } catch {}
}
export const nameOf = (address: string, fallback: string | undefined, aliases: Record<string, string>): string =>
  aliases[address]?.trim() || (fallback || "").trim() || shortAddr(address);

// ── per-wallet read state (chatId -> last-read message time) for unread badges ──
const readsKey = (addr: string) => `gtv_chatreads_${addr}`;
export function loadReads(addr: string | null): Record<string, number> {
  if (!addr || typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(readsKey(addr)) || "{}"); } catch { return {}; }
}
export function saveReads(addr: string | null, map: Record<string, number>): void {
  if (!addr || typeof window === "undefined") return;
  try { localStorage.setItem(readsKey(addr), JSON.stringify(map)); } catch {}
}

export const initials = (name: string) =>
  (name || "").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
export const shortAddr = (a: string) => (a && a.length > 10 ? `${a.slice(0, 5)}…${a.slice(-4)}` : a || "?");
