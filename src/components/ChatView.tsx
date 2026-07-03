"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, Fragment } from "react";
import { createPortal } from "react-dom";
import { placePopover } from "@/lib/popover";
import {
  ChatMeta, ChatState, ChatMember, ChatMessage,
  loadChats, saveChats, loadChatState, saveChatState, mergeMessages, newChatId, newMsgId, initials, shortAddr,
  loadAliases, saveAliases, nameOf, latestMessageAt, REACTION_EMOJIS,
} from "@/lib/chat";
import {
  createChat, addChatMember, renameChat, sendMessages, discoverChats, foldChat, loadChatKey, saveChatKey, unwrapChatKey,
  ensureChatSelfGrant, toggleReaction, publishRead, editMessage,
} from "@/lib/chatSync";
import { loadIdentities, isValidArweaveAddress } from "@/lib/accessKeys";
import { looksLikePublicKey } from "@/lib/recipients";
import { ticketKeyIndex, ticketLinkTargets } from "@/lib/board";
import { eventRefIndex, eventLinkTargets } from "@/lib/calendar";
import { itsmKeyIndex, itsmMeta, itsmLinkTargets } from "@/lib/itsm";
import { mentionPeople, filterPeople, type MentionPerson } from "@/lib/mentions";
import { showUserCard } from "@/lib/profileNav";

type Toast = (m: string, t?: "error" | "info" | "warning") => void;
const EMPTY: ChatState = { members: [], messages: [] };

const PAGE = 20; // messages shown / loaded per scroll-up

const fmtClock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const sameDay = (a: number, b: number) => { const x = new Date(a), y = new Date(b); return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate(); };
const dayLabel = (ms: number) => {
  const d = new Date(ms), now = new Date();
  const diff = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };
  if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString(undefined, opts);
};

// Add/remove my address from a message's reactions for an optimistic update.
function applyReaction(reactions: Record<string, string[]> | undefined, emoji: string, addr: string, active: boolean): Record<string, string[]> | undefined {
  const next: Record<string, string[]> = { ...(reactions || {}) };
  const set = new Set(next[emoji] || []);
  if (active) set.add(addr); else set.delete(addr);
  if (set.size === 0) delete next[emoji]; else next[emoji] = [...set];
  return Object.keys(next).length ? next : undefined;
}

// Encrypted multi-party chat: pick members from Access Keys, messages are AES-encrypted
// and the key is RSA-wrapped to each member (like a shared board). Not realtime —
// Arweave indexing takes ~minutes, so it polls.
// Inline reference chips for chat messages — calendar events (emerald) and board
// tickets (indigo) share one pill style with a leading icon, so both read as tappable.
const REF_CHIP = "inline-flex max-w-[15rem] items-center gap-1 rounded px-1.5 align-baseline text-[0.92em] font-medium ring-1";
const EvtIcon = () => (<svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="4.5" width="18" height="16" rx="2" /><path strokeLinecap="round" d="M3 9h18M8 2.5v4M16 2.5v4" /></svg>);
const TagIcon = () => (<svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="4" y="5" width="16" height="14" rx="2" /><path strokeLinecap="round" d="M8 10h8M8 14h5" /></svg>);
// Service Desk: the support-headset icon (matches the left-nav, ref chips and the composer pills).
const ItsmChipIcon = () => (<svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M5.5 13V11.5A6.5 6.5 0 0 1 18.5 11.5V13" /><rect x="3.7" y="12" width="3.5" height="5.5" rx="1.7" /><rect x="16.8" y="12" width="3.5" height="5.5" rx="1.7" /><path strokeLinecap="round" strokeLinejoin="round" d="M5.45 17.5V19A2.3 2.3 0 0 0 7.75 21.3H8.2" /><rect x="8" y="19.8" width="3.2" height="3" rx="1.5" /></svg>);

// A reference inserted into the composer: a board ticket key, or a calendar event token.
type InsertRef = { token: string; label: string; kind: "ticket" | "event" | "itsm" };
// HTML-string versions of the icons above, for building chips inside the contenteditable.
const EVT_SVG = '<svg class="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="3" y="4.5" width="18" height="16" rx="2"></rect><path stroke-linecap="round" d="M3 9h18M8 2.5v4M16 2.5v4"></path></svg>';
const TAG_SVG = '<svg class="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="4" y="5" width="16" height="14" rx="2"></rect><path stroke-linecap="round" d="M8 10h8M8 14h5"></path></svg>';
const ITSM_SVG = '<svg class="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M5.5 13V11.5A6.5 6.5 0 0 1 18.5 11.5V13"></path><rect x="3.7" y="12" width="3.5" height="5.5" rx="1.7"></rect><rect x="16.8" y="12" width="3.5" height="5.5" rx="1.7"></rect><path stroke-linecap="round" stroke-linejoin="round" d="M5.45 17.5V19A2.3 2.3 0 0 0 7.75 21.3H8.2"></path><rect x="8" y="19.8" width="3.2" height="3" rx="1.5"></rect></svg>';
const refChipColor = (kind: string) => kind === "event" ? "bg-emerald-500/15 text-emerald-200 ring-emerald-500/30" : kind === "itsm" ? "bg-rose-500/15 text-rose-200 ring-rose-500/30" : "bg-indigo-500/15 text-indigo-200 ring-indigo-500/30";
const refChipSvg = (kind: string) => kind === "event" ? EVT_SVG : kind === "itsm" ? ITSM_SVG : TAG_SVG;
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Serialize the contenteditable composer to message text: chips → their token, text kept as-is.
function serializeEditor(el: HTMLElement | null): string {
  if (!el) return "";
  let out = "";
  el.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) out += node.textContent ?? "";
    else if (node.nodeType === Node.ELEMENT_NODE) {
      const e = node as HTMLElement;
      if (e.dataset && e.dataset.ref) out += ` ${e.dataset.ref} `;
      else if (e.dataset && e.dataset.mention) out += ` @${e.dataset.mention} `; // mention → @<address> token (round-trips to a clickable pill)
      else if (e.tagName === "BR") out += "\n";
      else out += serializeEditor(e);
    }
  });
  return out;
}

export default function ChatView({ address, onToast, onOpenTicket, onOpenEvent, onOpenItsm, unread, onMarkRead, onMarkUnread, startWith, onStartWithHandled }: { address: string; onToast: Toast; onOpenTicket?: (boardId: string, ticketId: string) => void; onOpenEvent?: (eventId: string) => void; onOpenItsm?: (recordId: string) => void; unread?: Record<string, number>; onMarkRead?: (chatId: string, at: number) => void; onMarkUnread?: (chatId: string) => void; startWith?: { address: string; label?: string } | null; onStartWithHandled?: () => void }) {
  const [chats, setChats] = useState<ChatMeta[]>(() => loadChats(address));
  const [chatQuery, setChatQuery] = useState("");
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [state, setState] = useState<ChatState>(EMPTY);
  const [reads, setReads] = useState<Record<string, number>>({}); // reader -> last-read time (open chat)
  const [aliases, setAliases] = useState<Record<string, string>>(() => loadAliases(address));
  const [editingId, setEditingId] = useState<string | null>(null); // message being edited
  const [creating, setCreating] = useState(false);
  const [prefillMember, setPrefillMember] = useState<{ token: string; label: string; address: string } | null>(null); // a "Call" target seeded into New chat
  const [renaming, setRenaming] = useState(false); // editing the chat name
  const [renameVal, setRenameVal] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [narrow, setNarrow] = useState(false); // auto-collapse the chat list to icons when space is tight
  const [overlayOpen, setOverlayOpen] = useState(false); // (narrow only) full list floating over the chat
  const rowRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE);
  const pendingWraps = useRef<Record<string, string>>({});
  const threadRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false); // one sync in flight at a time
  const fastUntil = useRef(0); // poll fast until this timestamp (set on open / send)
  const lastReadPub = useRef<Record<string, number>>({}); // chatId -> latest msg time I published a read for
  const atBottomRef = useRef(true);
  const loadingMore = useRef(false);
  const prevScrollH = useRef(0);
  const justSent = useRef(false);
  const lastChat = useRef<string | null>(null);
  const autoOpenedUnread = useRef(false); // one-shot: on entry, open the top unread chat
  const userPicked = useRef(false);       // the user explicitly chose a chat → don't auto-switch

  // Auto-collapse the chat list to an icons-only rail when the Chat area itself gets narrow
  // (measured, not a viewport breakpoint — so it also reacts to the left nav expanding/collapsing).
  useEffect(() => {
    const el = rowRef.current; if (!el) return;
    const check = () => setNarrow((prev) => { const n = el.clientWidth < 560; if (prev && !n) setOverlayOpen(false); return n; });
    check();
    const ro = new ResizeObserver(check); ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const meta = chats.find((c) => c.id === currentId) ?? null;
  const myLabel = state.members.find((m) => m.address === address)?.label || shortAddr(address);
  const composerPeople = useMemo(() => mentionPeople(address, state.members.map((m) => ({ id: m.address, label: m.label }))), [address, state.members]);
  const ticketIndex = useMemo(() => ticketKeyIndex(address), [address, currentId]);
  const eventIndex = useMemo(() => eventRefIndex(address), [address, currentId]);
  const itsmIndex = useMemo(() => itsmKeyIndex(address), [address, currentId]);
  // Turn a token (CODE-NUM or EVT-id) into chip info — used to build/auto-format chips.
  const resolveRef = (token: string): InsertRef | null => {
    if (token.startsWith("EVT-")) { const ev = eventIndex[token]; return ev ? { token, label: (ev.boardCode ? ev.boardCode + " · " : "") + ev.title, kind: "event" } : null; }
    const up = token.toUpperCase();
    if (/^(INC|REQ|CHG|PRB)\d+$/.test(up)) { const r = itsmIndex[up]; return r ? { token: up, label: up, kind: "itsm" } : null; }
    const hit = ticketIndex[up]; return hit ? { token: up, label: up, kind: "ticket" } : null;
  };
  const nm = (addr: string, fallback?: string) => nameOf(addr, fallback, aliases);
  const lastAt = (c: ChatMeta) => Math.max(latestMessageAt(loadChatState(c.id)), c.updatedAt || 0, unread?.[c.id] || 0);
  const filteredChats = chats.filter((c) => c.title.toLowerCase().includes(chatQuery.trim().toLowerCase()));
  const sortedChats = [...filteredChats].sort((a, b) => lastAt(b) - lastAt(a));

  // On entering the chat (or switching wallet), open the most recent conversation
  // rather than the empty / create state.
  useEffect(() => {
    autoOpenedUnread.current = false; userPicked.current = false; // re-arm auto-open on wallet switch
    const list = loadChats(address);
    setChats(list); setAliases(loadAliases(address)); setCreating(false); setReads({});
    if (list.length > 0) {
      const recent = [...list].sort((a, b) => Math.max(latestMessageAt(loadChatState(a.id)), a.updatedAt || 0) < Math.max(latestMessageAt(loadChatState(b.id)), b.updatedAt || 0) ? 1 : -1)[0];
      setCurrentId(recent.id); setState(loadChatState(recent.id));
    } else { setCurrentId(null); setState(EMPTY); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  // discover chats shared with me
  useEffect(() => {
    let alive = true;
    discoverChats(address).then((refs) => {
      if (!alive || refs.length === 0) return;
      for (const r of refs) pendingWraps.current[r.chatId] = r.wrappedKey;
      const list = loadChats(address);
      const have = new Set(list.map((c) => c.id));
      const add = refs.filter((r) => !have.has(r.chatId));
      if (add.length === 0) return;
      for (const r of add) list.push({ id: r.chatId, title: "Chat", owner: r.owner, updatedAt: r.at });
      saveChats(address, list); setChats(list);
    }).catch(() => {});
    return () => { alive = false; };
  }, [address]);

  const ensureKey = async (chatId: string): Promise<Uint8Array | null> => {
    let key = loadChatKey(chatId);
    if (key) return key;
    const wrapped = pendingWraps.current[chatId];
    if (!wrapped) return null;
    // Prefer the encrypted state snapshot (one master-key unlock) over a per-chat decrypt prompt.
    try { const { whenHydrated } = await import("@/lib/stateSync"); await whenHydrated(); const c = loadChatKey(chatId); if (c) return c; } catch { /* sync off */ }
    try { key = await unwrapChatKey(wrapped); saveChatKey(chatId, key); return key; }
    catch { onToast("Couldn't unlock the chat (wallet declined).", "error"); return null; }
  };

  // Returns whether new messages arrived (drives the adaptive poll cadence).
  // `silent` background polls don't flash the refresh spinner.
  const sync = async (chatId: string, silent = false): Promise<boolean> => {
    if (syncingRef.current) return false;
    const m = loadChats(address).find((c) => c.id === chatId);
    if (!m) return false;
    const key = await ensureKey(chatId);
    if (!key) return false;
    // Heal: if I own this chat, ensure my key copy is on-chain (self-grant) so it's recoverable
    // on any device — not just in this browser. Idempotent + silent.
    if (m.owner === address) void ensureChatSelfGrant(chatId, address, key);
    syncingRef.current = true;
    if (!silent) setSyncing(true);
    try {
      const folded = await foldChat(chatId, m.owner, key);
      const prevMsgs = loadChatState(chatId).messages;
      const grew = mergeMessages(prevMsgs, folded.messages).length > prevMsgs.length;
      if (chatId === currentId) setReads(folded.reads);
      setState((prev) => {
        const next: ChatState = { members: folded.members.length ? folded.members : prev.members, messages: mergeMessages(prev.messages, folded.messages) };
        if (chatId === currentId) saveChatState(chatId, next);
        return next;
      });
      const title = folded.title ?? m.title;
      if (title !== m.title) { const metas = loadChats(address).map((c) => (c.id === chatId ? { ...c, title } : c)); saveChats(address, metas); setChats(metas); }
      return grew;
    } catch (e) { onToast(e instanceof Error ? e.message : "Couldn't sync the chat.", "error"); return false; }
    finally { syncingRef.current = false; if (!silent) setSyncing(false); }
  };

  // Poll the open chat: fast (~2.5s) right after opening / sending or whenever new
  // messages land, backing off toward 15s when the conversation is quiet.
  useEffect(() => {
    if (!currentId) return;
    fastUntil.current = Date.now() + 15_000;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let delay = 2500;
    const loop = async () => {
      if (!alive) return;
      const grew = await sync(currentId, true);
      if (!alive) return;
      delay = grew || Date.now() < fastUntil.current ? 2500 : Math.min(Math.round(delay * 1.5), 15_000);
      timer = setTimeout(loop, delay);
    };
    loop();
    return () => { alive = false; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  // when switching chats, show the latest page
  useEffect(() => { setVisibleCount(PAGE); atBottomRef.current = true; }, [currentId]);

  const shown = state.messages.slice(Math.max(0, state.messages.length - visibleCount));
  const hasMore = state.messages.length > shown.length;
  const otherMembers = state.members.filter((m) => m.address !== address);
  const myLastReadableId = [...shown].reverse().find((m) => m.author === address && !m.pending && !m.failed)?.id;
  // Editing bumps a message's "seen" threshold so it must be read again.
  const seenCount = (m: ChatMessage) => otherMembers.filter((om) => (reads[om.address] || 0) >= (m.editedAt ?? m.at)).length;
  const readThreshold = latestMessageAt(state); // newest activity (create/edit) I've now seen
  const otherThreshold = state.messages.reduce((mx, m) => (m.author !== address ? Math.max(mx, m.editedAt ?? m.at) : mx), 0);

  // Mark the open chat read (clears its badge) and publish a read receipt so others
  // can see I've seen their latest message — re-fires on edits too (readThreshold).
  useEffect(() => {
    if (!currentId) return;
    onMarkRead?.(currentId, readThreshold || Date.now());
    if (otherThreshold > (lastReadPub.current[currentId] || 0) && loadChatKey(currentId)) {
      lastReadPub.current[currentId] = otherThreshold;
      publishRead(currentId, address).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, readThreshold]);

  const onThreadScroll = () => {
    const el = threadRef.current; if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 48 && hasMore) { loadingMore.current = true; prevScrollH.current = el.scrollHeight; setVisibleCount((c) => c + PAGE); }
  };

  // Keep the viewport sensible: jump to bottom when opening a chat or sending /
  // receiving while already at the bottom; hold position when loading older messages.
  useLayoutEffect(() => {
    const el = threadRef.current; if (!el) return;
    if (lastChat.current !== currentId) { lastChat.current = currentId; el.scrollTop = el.scrollHeight; atBottomRef.current = true; loadingMore.current = false; return; }
    if (loadingMore.current) { el.scrollTop = el.scrollHeight - prevScrollH.current; loadingMore.current = false; prevScrollH.current = 0; return; }
    if (atBottomRef.current || justSent.current) { el.scrollTop = el.scrollHeight; justSent.current = false; }
  }, [shown.length, currentId]);

  const select = (id: string) => { setCurrentId(id); setCreating(false); setShowMembers(false); setEditingId(null); setRenaming(false); setReads({}); setState(loadChatState(id)); onMarkRead?.(id, latestMessageAt(loadChatState(id)) || Date.now()); };

  // One-shot on entering the Chat tab: the unread query is async, so `unread` arrives a
  // moment after mount. As soon as it does, open the most-recent unread conversation — unless
  // the user already picked one. This makes entering with a single unread chat clear its red
  // dot immediately; with two unread it opens/clears the newest and leaves the other unread.
  useEffect(() => {
    if (autoOpenedUnread.current || userPicked.current) return;
    const ids = Object.keys(unread ?? {});
    if (ids.length === 0) return;
    autoOpenedUnread.current = true;
    const top = ids.sort((a, b) => (unread![b] ?? 0) - (unread![a] ?? 0))[0];
    if (top === currentId) onMarkRead?.(top, unread![top]);
    else select(top);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread]);

  // "Call" from a profile/mention: open an existing 1:1 with this wallet, else start a new
  // chat with them pre-added.
  useEffect(() => {
    if (!startWith) return;
    userPicked.current = true; // an explicit "call"/mention target — don't auto-switch away
    const target = startWith.address;
    const dm = chats.map((c) => ({ id: c.id, st: loadChatState(c.id) })).find(({ st }) => st.members.length <= 2 && st.members.some((m) => m.address === target));
    if (dm) { select(dm.id); }
    else { setPrefillMember({ token: target, label: startWith.label || shortAddr(target), address: target }); setCurrentId(null); setCreating(true); }
    onStartWithHandled?.();
  }, [startWith]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rename the chat (owner only): save locally, and republish the manifest for shared chats.
  const doRename = async () => {
    setRenaming(false);
    const t = renameVal.trim();
    const m = loadChats(address).find((c) => c.id === currentId);
    if (!t || !m || t === m.title) return;
    const metas = loadChats(address).map((c) => (c.id === m.id ? { ...c, title: t } : c));
    saveChats(address, metas); setChats(metas);
    const key = loadChatKey(m.id);
    if (key && state.members.length > 1) { try { await renameChat(m.id, address, key, t, state.members); } catch { onToast("Renamed here, but couldn't sync the name to members.", "error"); } }
  };

  const onSetAlias = (addr: string, name: string) => {
    const next = { ...aliases };
    if (name.trim()) next[addr] = name.trim(); else delete next[addr];
    setAliases(next); saveAliases(address, next);
  };

  const react = async (msg: ChatMessage, emoji: string) => {
    if (!currentId) return;
    const key = await ensureKey(currentId);
    if (!key) { onToast("Couldn't unlock the chat.", "error"); return; }
    const active = !(msg.reactions?.[emoji] || []).includes(address);
    setState((prev) => { const next = { ...prev, messages: prev.messages.map((m) => (m.id === msg.id ? { ...m, reactions: applyReaction(m.reactions, emoji, address, active) } : m)) }; saveChatState(currentId, next); return next; });
    fastUntil.current = Date.now() + 20_000;
    try { await toggleReaction(currentId, address, key, msg.id, emoji, active); }
    catch { onToast("Couldn't save the reaction.", "error"); }
  };

  const startEdit = (m: ChatMessage) => setEditingId(m.id);
  const saveEditBody = (orig: ChatMessage, body: string): boolean => {
    setEditingId(null);
    const t = body.trim();
    if (!currentId || !t || t === orig.text) return true;
    const editedAt = Date.now();
    const cid = currentId;
    setState((prev) => { const next = { ...prev, messages: prev.messages.map((m) => (m.id === orig.id ? { ...m, text: t, editedAt } : m)) }; saveChatState(cid, next); return next; });
    fastUntil.current = Date.now() + 30_000;
    (async () => {
      const key = await ensureKey(cid);
      if (!key) { onToast("Couldn't unlock the chat to edit.", "error"); return; }
      try { await editMessage(cid, address, key, { ...orig, text: t, editedAt }); }
      catch { onToast("Couldn't save the edit.", "error"); }
    })();
    return true;
  };

  // Send a serialized body (chips already turned into their tokens). Returns true once the
  // message is queued so the composer can clear; the network round-trip runs in the background.
  const send = async (rawBody: string): Promise<boolean> => {
    const body = rawBody.trim();
    const cid = currentId;
    if (!body || !cid) return false;
    const key = await ensureKey(cid);
    if (!key) { onToast("Couldn't unlock the chat to send.", "error"); return false; }
    const msg: ChatMessage = { id: newMsgId(), author: address, authorLabel: myLabel, text: body, at: Date.now(), pending: true };
    justSent.current = true;
    fastUntil.current = Date.now() + 30_000; // keep polling snappy after sending
    setState((prev) => { const next = { ...prev, messages: [...prev.messages, msg] }; saveChatState(cid, next); return next; });
    sendMessages(cid, address, key, [msg])
      .then(() => setState((prev) => { const next = { ...prev, messages: prev.messages.map((x) => (x.id === msg.id ? { ...x, pending: false } : x)) }; saveChatState(cid, next); return next; }))
      .catch((e) => { setState((prev) => { const next = { ...prev, messages: prev.messages.map((x) => (x.id === msg.id ? { ...x, pending: false, failed: true } : x)) }; saveChatState(cid, next); return next; }); onToast(e instanceof Error ? e.message : "Message didn't send.", "error"); });
    return true;
  };

  const onCreate = async (title: string, meLabel: string, picks: { token: string; label: string }[]) => {
    setBusy(true);
    try {
      const id = newChatId();
      const { roster } = await createChat(id, address, meLabel, title, picks);
      const m: ChatMeta = { id, title, owner: address, updatedAt: Date.now() };
      const metas = [m, ...loadChats(address)]; saveChats(address, metas); setChats(metas);
      const st: ChatState = { members: roster, messages: [] }; saveChatState(id, st);
      setCurrentId(id); setState(st); setCreating(false);
      onToast("Chat created.", "info");
    } catch (e) { onToast(e instanceof Error ? e.message : "Couldn't create the chat.", "error"); }
    finally { setBusy(false); }
  };

  const onAddMember = async (token: string, label: string) => {
    if (!currentId) return;
    const key = await ensureKey(currentId);
    if (!key) { onToast("Couldn't unlock the chat.", "error"); return; }
    setBusy(true);
    try {
      const r = await addChatMember(currentId, address, key, meta?.title || "Chat", state.members, token, label);
      if ("error" in r) { onToast(r.error, "error"); return; }
      setState((prev) => { const next = { ...prev, members: r.roster }; saveChatState(currentId, next); return next; });
      onToast("Member added.", "info");
    } catch (e) { onToast(e instanceof Error ? e.message : "Couldn't add the member.", "error"); }
    finally { setBusy(false); }
  };

  // Turn board ticket keys (CODE-NUM) and calendar event tokens (EVT-id) into styled,
  // tappable chips — SEPARATE logic: tickets open the Board, events open the Calendar.
  // The event alt is first in the regex so a token isn't mis-split; a reference the reader
  // can't resolve (no access) renders muted, never as the raw token.
  const mentionName = (addr: string) => composerPeople.find((p) => p.id === addr)?.label || shortAddr(addr);
  const renderText = (body: string) => {
    const parts = body.split(/(https?:\/\/[^\s<]+|@[A-Za-z0-9_-]{43}|EVT-[A-Za-z0-9_-]{4,}|(?:INC|REQ|CHG|PRB|inc|req|chg|prb)\d{1,9}|[A-Za-z][A-Za-z0-9]{1,15}-\d{1,6})/g);
    if (parts.length === 1) return body;
    return parts.map((part, i) => {
      if (i % 2 === 1) {
        if (/^https?:\/\//.test(part)) return <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 break-all hover:opacity-80">{part}</a>;
        if (/^@[A-Za-z0-9_-]{43}$/.test(part)) {
          const addr = part.slice(1);
          const name = mentionName(addr);
          return <button key={i} type="button" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); showUserCard({ address: addr, label: name, rect: { top: r.top, left: r.left, bottom: r.bottom } }); }} className="rounded px-1 align-baseline text-[0.92em] font-medium ring-1 ring-violet-500/30 bg-violet-500/15 text-violet-200 hover:bg-violet-500/25">@{name}</button>;
        }
        const ev = eventIndex[part];
        if (ev) {
          const inner = <><EvtIcon />{ev.boardCode && <span className="font-semibold opacity-80">{ev.boardCode}</span>}<span className="truncate">{ev.title}</span></>;
          const cls = `${REF_CHIP} bg-emerald-500/15 text-emerald-200 ring-emerald-500/30`;
          return onOpenEvent
            ? <button key={i} type="button" onClick={() => onOpenEvent(ev.eventId)} title={`Open event · ${ev.boardTitle ? ev.boardTitle + " · " : ""}${ev.title}`} className={`${cls} hover:bg-emerald-500/25`}>{inner}</button>
            : <span key={i} className={cls}>{inner}</span>;
        }
        if (part.startsWith("EVT-")) return <span key={i} title="An event you don't have access to" className={`${REF_CHIP} bg-slate-700/40 text-slate-400 ring-slate-600/40`}><EvtIcon />event</span>;
        const upI = part.toUpperCase();
        if (/^(?:INC|REQ|CHG|PRB)\d+$/.test(upI)) {
          const r = itsmIndex[upI];
          if (r) {
            const inner = <><ItsmChipIcon /><span className="font-mono">{upI}</span></>;
            const cls = `${REF_CHIP} ${itsmMeta(r.type).chip}`;
            return onOpenItsm
              ? <button key={i} type="button" onClick={() => onOpenItsm(r.id)} title={`Open ${upI} · ${r.short}`} className={`${cls} hover:opacity-90`}>{inner}</button>
              : <span key={i} className={cls}>{inner}</span>;
          }
          return <span key={i} title="A Service Desk record you don't have access to" className={`${REF_CHIP} bg-slate-700/40 text-slate-400 ring-slate-600/40`}><ItsmChipIcon />record</span>;
        }
        const hit = ticketIndex[part.toUpperCase()];
        if (hit) {
          const key = part.toUpperCase();
          const inner = <><TagIcon /><span className="font-mono">{key}</span></>;
          const cls = `${REF_CHIP} bg-indigo-500/15 text-indigo-200 ring-indigo-500/30`;
          return onOpenTicket
            ? <button key={i} type="button" onClick={() => onOpenTicket(hit.boardId, hit.ticketId)} title={`Open ${key} · ${hit.boardTitle}`} className={`${cls} hover:bg-indigo-500/25`}>{inner}</button>
            : <span key={i} className={cls}>{inner}</span>;
        }
      }
      return <Fragment key={i}>{part}</Fragment>;
    });
  };


  // One row renderer for both the collapsed rail (icons only) and the full list.
  const renderRows = (collapsed: boolean) => sortedChats.map((c) => {
    const un = !!unread?.[c.id] && c.id !== currentId;
    return (
      <button key={c.id} onClick={() => { userPicked.current = true; select(c.id); setOverlayOpen(false); }} title={c.title} className={`relative flex items-center rounded-lg text-left ${collapsed ? "w-9 justify-center p-1" : "w-full gap-2 px-2 py-1.5"} ${c.id === currentId ? "bg-slate-800 text-slate-100" : un ? "bg-indigo-500/10 text-slate-100 hover:bg-indigo-500/15" : "text-slate-300 hover:bg-slate-800/50"}`}>
        <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-600/30 text-[10px] font-medium text-indigo-200">
          {initials(c.title)}
          {un && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-slate-900" />}
        </span>
        {!collapsed && <span className={`min-w-0 flex-1 truncate text-xs ${un ? "font-semibold text-white" : ""}`}>{c.title}</span>}
        {!collapsed && un && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />}
      </button>
    );
  });

  // The full list contents (header + search + rows) — reused by the inline column and the overlay.
  const fullColumn = (
    <>
      <div className="border-b border-slate-800 p-2 space-y-2">
        <button onClick={() => { userPicked.current = true; setCreating(true); setCurrentId(null); setOverlayOpen(false); }} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-2 py-1.5 text-[11px] font-medium text-white hover:bg-indigo-500">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
          New chat
        </button>
        {chats.length > 0 && (
          <div className="relative">
            <svg className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="M21 21l-4-4" /></svg>
            <input value={chatQuery} onChange={(e) => setChatQuery(e.target.value)} placeholder="Search chats…" className="w-full rounded-lg border border-slate-700 bg-slate-800 pl-7 pr-2 py-1 text-[11px] text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none" />
          </div>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-2 space-y-0.5">
        {chats.length === 0 && <p className="px-1 py-6 text-center text-[11px] text-slate-600">No chats yet.</p>}
        {chats.length > 0 && sortedChats.length === 0 && <p className="px-1 py-6 text-center text-[11px] text-slate-600">No chats match.</p>}
        {renderRows(false)}
      </div>
    </>
  );

  return (
    <div className="flex h-[calc(100vh-9rem)] flex-col">
      <div className="mb-4 shrink-0">
        <h2 className="text-lg font-semibold text-white">Chat</h2>
        <p className="text-xs text-slate-500 mt-0.5">End-to-end encrypted group chats with people from your Access Keys. Messages sync through Arweave (~minutes, not instant).</p>
      </div>

      <div ref={rowRef} className="relative flex flex-1 min-h-0 gap-4">
        {narrow ? (
          /* collapsed rail — icons only, with a toggle at the bottom that opens the full list as an overlay */
          <div className="flex w-14 shrink-0 flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
            <div className="border-b border-slate-800 p-2 flex justify-center">
              <button onClick={() => { userPicked.current = true; setCreating(true); setCurrentId(null); }} title="New chat" aria-label="New chat" className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white hover:bg-indigo-500">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-2 flex flex-col items-center gap-1">
              {renderRows(true)}
            </div>
            <div className="border-t border-slate-800 p-2 flex justify-center">
              <button onClick={() => setOverlayOpen(true)} title="Expand chat list" aria-label="Expand chat list" className="group flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 5v14" /><g className="transition-transform duration-300 group-hover:translate-x-0.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h11M16 8l4 4-4 4" /></g></svg>
              </button>
            </div>
          </div>
        ) : (
          /* full inline column — width shrinks with the screen */
          <div className="flex w-64 min-w-[8.5rem] max-w-[38%] shrink flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
            {fullColumn}
          </div>
        )}

        {/* narrow + expanded: full list floats OVER the chat area so it keeps its width */}
        {narrow && overlayOpen && (
          <>
            <div className="absolute inset-0 z-20" onClick={() => setOverlayOpen(false)} />
            <div className="absolute inset-y-0 left-0 z-30 flex w-64 max-w-[85%] flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
              {fullColumn}
              <div className="border-t border-slate-800 p-2 flex justify-end">
                <button onClick={() => setOverlayOpen(false)} title="Collapse chat list" aria-label="Collapse chat list" className="group flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M20 5v14" /><g className="transition-transform duration-300 group-hover:-translate-x-0.5"><path strokeLinecap="round" strokeLinejoin="round" d="M15 12H4M8 8l-4 4 4 4" /></g></svg>
                </button>
              </div>
            </div>
          </>
        )}

        {/* main */}
        <div className="flex min-w-0 flex-1 flex-col rounded-xl border border-slate-800 bg-slate-900/40">
          {creating ? (
            <NewChat address={address} busy={busy} initialPicks={prefillMember ? [prefillMember] : undefined} onCancel={() => { setCreating(false); setPrefillMember(null); }} onCreate={onCreate} />
          ) : meta ? (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-2.5 shrink-0">
                <div className="min-w-0">
                  {renaming ? (
                    <input autoFocus value={renameVal} onChange={(e) => setRenameVal(e.target.value)} onBlur={doRename} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); doRename(); } else if (e.key === "Escape") setRenaming(false); }} className="w-full rounded border border-indigo-500 bg-slate-800 px-1.5 py-0.5 text-sm font-medium text-white focus:outline-none" />
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-sm font-medium text-slate-200">{meta.title}</p>
                      {meta.owner === address && <button onClick={() => { setRenameVal(meta.title); setRenaming(true); }} title="Rename chat" className="shrink-0 text-slate-500 hover:text-slate-200"><svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z" /></svg></button>}
                    </div>
                  )}
                  <button onClick={() => setShowMembers((v) => !v)} className="text-[11px] text-slate-500 hover:text-slate-300">{state.members.length} member{state.members.length === 1 ? "" : "s"}</button>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button onClick={() => (unread?.[meta.id] ? onMarkRead?.(meta.id, Date.now()) : onMarkUnread?.(meta.id))} title={unread?.[meta.id] ? "Mark as read" : "Mark as unread (show a notification)"} className={`flex items-center justify-center rounded-lg border px-2 py-1.5 transition-colors ${unread?.[meta.id] ? "border-indigo-500 bg-indigo-500/15 text-indigo-200" : "border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"}`}>
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path strokeLinecap="round" d="M13.5 21a2 2 0 01-3 0" /></svg>
                  </button>
                  <button onClick={() => sync(meta.id)} disabled={syncing} title="Refresh" className="flex items-center justify-center rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-slate-400 hover:bg-slate-700 hover:text-slate-200 disabled:opacity-60">
                    <svg className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M5.5 14a7 7 0 0011.9 2.5M18.5 10A7 7 0 006.6 7.5" /></svg>
                  </button>
                </div>
              </div>

              {showMembers && <MembersBar address={address} members={state.members} busy={busy} isOwner={meta.owner === address} aliases={aliases} onAddMember={onAddMember} onSetAlias={onSetAlias} />}

              <div ref={threadRef} onScroll={onThreadScroll} className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
                <div className="flex min-h-full flex-col justify-end space-y-1">
                  {state.messages.length === 0 && <p className="py-10 text-center text-xs text-slate-600">No messages yet — say hello.</p>}
                  {hasMore && <p className="py-1 text-center text-[10px] text-slate-600">Scroll up for older messages…</p>}
                  {shown.map((m, i) => {
                    const prev = shown[i - 1];
                    const newDay = !prev || !sameDay(prev.at, m.at);
                    const mine = m.author === address;
                    const showName = !mine && (!prev || prev.author !== m.author || newDay);
                    return (
                      <Fragment key={m.id}>
                        {newDay && (
                          <div className="flex items-center gap-2 py-2">
                            <div className="h-px flex-1 bg-slate-800" />
                            <span className="rounded-full bg-slate-800/80 px-2 py-0.5 text-[10px] text-slate-400">{dayLabel(m.at)}</span>
                            <div className="h-px flex-1 bg-slate-800" />
                          </div>
                        )}
                        <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                          <div className="group/msg max-w-[78%] pb-4">
                            {showName && <p className="mb-0.5 px-1 text-[10px] text-slate-500">{nm(m.author, m.authorLabel)}</p>}
                            <div className="relative">
                              <div className={`rounded-2xl px-3 py-1.5 text-sm ${mine ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-100"} ${editingId === m.id ? "ring-2 ring-amber-400/70" : ""}`}>
                                <p className="whitespace-pre-wrap break-words">{renderText(m.text)}</p>
                                <p className={`mt-0.5 text-right text-[9px] ${mine ? "text-indigo-200" : "text-slate-500"}`}>{m.failed ? "failed" : m.pending ? "sending…" : `${m.editedAt ? "edited · " : ""}${fmtClock(m.at)}`}</p>
                              </div>
                              {!m.pending && !m.failed && editingId !== m.id && (
                                <div className={`absolute -bottom-3 z-20 hidden items-center gap-0.5 rounded-full border border-slate-700 bg-slate-900 px-1 py-0.5 shadow-lg group-hover/msg:flex ${mine ? "right-1" : "left-1"}`}>
                                  {REACTION_EMOJIS.map((e) => <button key={e} onClick={() => react(m, e)} className="rounded-full px-0.5 text-sm leading-none transition-transform hover:scale-125">{e}</button>)}
                                  {mine && <button onClick={() => startEdit(m)} title="Edit message" className="flex h-5 w-5 items-center justify-center rounded-full text-slate-400 hover:bg-slate-800 hover:text-slate-200"><svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z" /></svg></button>}
                                </div>
                              )}
                            </div>
                            {m.reactions && Object.keys(m.reactions).length > 0 && (
                              <div className={`mt-1 flex flex-wrap gap-1 ${mine ? "justify-end" : "justify-start"}`}>
                                {Object.entries(m.reactions).map(([emoji, who]) => (
                                  <button key={emoji} onClick={() => react(m, emoji)} title={who.map((a) => nm(a)).join(", ")} className={`flex items-center gap-0.5 rounded-full border px-1.5 py-px text-[11px] ${who.includes(address) ? "border-indigo-500 bg-indigo-500/20 text-indigo-200" : "border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600"}`}>
                                    <span className="leading-none">{emoji}</span><span className="text-[9px]">{who.length}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                            {mine && m.id === myLastReadableId && seenCount(m) > 0 && (
                              <p className="mt-0.5 px-1 text-right text-[9px] text-slate-500">{otherMembers.length > 1 ? `Seen by ${seenCount(m)}` : "Seen"}</p>
                            )}
                          </div>
                        </div>
                      </Fragment>
                    );
                  })}
                </div>
              </div>

              {(() => {
                const em = editingId ? state.messages.find((x) => x.id === editingId) : null;
                return em
                  ? <ChipComposer key={`edit-${em.id}`} address={address} people={composerPeople} resolve={resolveRef} initial={em.text} onCancel={() => setEditingId(null)} onSubmit={(body) => saveEditBody(em, body)} />
                  : <ChipComposer key="new" address={address} people={composerPeople} resolve={resolveRef} onSubmit={send} />;
              })()}
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-center">
              <div>
                <p className="text-sm text-slate-500">Select a chat, or start a new one.</p>
                <button onClick={() => { userPicked.current = true; setCreating(true); }} className="mt-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500">New chat</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Combobox over the wallet's Access Keys: type to filter, click to pick. Used by both
// the new-chat form and the add-member bar.
// "+" composer picker — search board tickets/sub-tickets AND calendar events, insert a
// reference token. Tickets and events are listed in separate sections (separate logic).
// Chip-rendering message composer (contenteditable): inserted refs show as live pills while
// you type; on send the editor is serialized back to plain tokens (CODE-NUM / EVT-id) so the
// links still resolve for everyone. Caret position is remembered across the picker.
function ChipComposer({ address, people, resolve, onSubmit, initial, onCancel, placeholder }: { address: string; people: MentionPerson[]; resolve: (token: string) => InsertRef | null; onSubmit: (body: string) => boolean | Promise<boolean>; initial?: string; onCancel?: () => void; placeholder?: string }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastRange = useRef<Range | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [empty, setEmpty] = useState(!initial?.trim());
  const [mention, setMention] = useState<{ query: string; top: number; left: number } | null>(null);
  const [mActive, setMActive] = useState(0);
  const mentionItems = mention ? filterPeople(people, mention.query) : [];
  const editing = !!onCancel;
  useEffect(() => { setMActive(0); }, [mention?.query]);

  const refresh = () => setEmpty(serializeEditor(editorRef.current).trim() === "");
  const saveRange = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && editorRef.current?.contains(sel.anchorNode)) lastRange.current = sel.getRangeAt(0).cloneRange();
  };
  // Keep the caret in view as the box scrolls, so you always see what you're writing.
  const keepCaretVisible = () => requestAnimationFrame(() => {
    const editor = editorRef.current, sel = window.getSelection();
    if (!editor || !sel || !sel.rangeCount || !editor.contains(sel.anchorNode)) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect(), er = editor.getBoundingClientRect();
    if (!rect.top && !rect.bottom) { editor.scrollTop = editor.scrollHeight; return; }
    if (rect.bottom > er.bottom) editor.scrollTop += rect.bottom - er.bottom + 4;
    else if (rect.top < er.top) editor.scrollTop -= er.top - rect.top + 4;
  });

  const buildChip = (ref: InsertRef): HTMLElement => {
    const chip = document.createElement("span");
    chip.contentEditable = "false";
    chip.dataset.ref = ref.token;
    chip.className = `mx-px inline-flex max-w-[14rem] items-center gap-1 rounded px-1.5 align-baseline text-[0.92em] font-medium ring-1 ${refChipColor(ref.kind)}`;
    chip.innerHTML = refChipSvg(ref.kind) + `<span class="truncate ${ref.kind === "ticket" || ref.kind === "itsm" ? "font-mono" : ""}">${escapeHtml(ref.label)}</span>`;
    return chip;
  };
  const chipFragment = (ref: InsertRef) => { const f = document.createDocumentFragment(); f.appendChild(buildChip(ref)); f.appendChild(document.createTextNode(" ")); return f; };

  // Edit mode: turn the existing message text (tokens included) into chips + text, focus at end.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !initial) return;
    editor.innerHTML = ""; // guard React StrictMode's double-invoke from duplicating chips
    initial.split(/(@[A-Za-z0-9_-]{43}|EVT-[A-Za-z0-9_-]{4,}|(?:INC|REQ|CHG|PRB|inc|req|chg|prb)\d{1,9}|[A-Za-z][A-Za-z0-9]{1,15}-\d{1,6})/g).forEach((part, i) => {
      if (i % 2 === 1) {
        const mm = part.match(/^@([A-Za-z0-9_-]{43})$/);
        if (mm) { const addr = mm[1]; editor.appendChild(buildMentionChip({ id: addr, label: people.find((p) => p.id === addr)?.label || shortAddr(addr) })); editor.appendChild(document.createTextNode(" ")); return; }
        const ref = resolve(part); if (ref) { editor.appendChild(buildChip(ref)); editor.appendChild(document.createTextNode(" ")); return; }
      }
      if (part) editor.appendChild(document.createTextNode(part));
    });
    refresh();
    editor.focus();
    const r = document.createRange(); r.selectNodeContents(editor); r.collapse(false);
    const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(r); lastRange.current = r.cloneRange();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const insertNode = (node: Node, forced?: Range) => {
    const editor = editorRef.current;
    if (!editor) return;
    const sel = window.getSelection();
    let range: Range | null = forced ?? (sel && sel.rangeCount && editor.contains(sel.anchorNode)
      ? sel.getRangeAt(0)
      : (lastRange.current && editor.contains(lastRange.current.commonAncestorContainer) ? lastRange.current : null));
    editor.focus();
    if (!range) { range = document.createRange(); range.selectNodeContents(editor); range.collapse(false); }
    range.deleteContents();
    // A DocumentFragment is emptied by insertNode, so capture its last child to place the caret.
    const tail = node.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? node.lastChild : node;
    range.insertNode(node);
    if (tail) {
      range.setStartAfter(tail); range.collapse(true);
      sel?.removeAllRanges(); sel?.addRange(range);
      lastRange.current = range.cloneRange();
    }
    refresh(); keepCaretVisible();
  };

  const insertRef = (ref: InsertRef) => {
    setPickerOpen(false);
    const chip = document.createElement("span");
    chip.contentEditable = "false";
    chip.dataset.ref = ref.token;
    chip.className = `mx-px inline-flex max-w-[14rem] items-center gap-1 rounded px-1.5 align-baseline text-[0.92em] font-medium ring-1 ${refChipColor(ref.kind)}`;
    chip.innerHTML = refChipSvg(ref.kind) + `<span class="truncate ${ref.kind === "ticket" || ref.kind === "itsm" ? "font-mono" : ""}">${escapeHtml(ref.label)}</span>`;
    const frag = document.createDocumentFragment();
    frag.appendChild(chip);
    frag.appendChild(document.createTextNode(" "));
    insertNode(frag);
  };

  // Auto-chip: a just-typed token (e.g. DESIGN-12) becomes a chip when you press space.
  const tryAutoChip = (): boolean => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    const r = sel.getRangeAt(0);
    const node = r.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return false;
    const m = (node.textContent ?? "").slice(0, r.startOffset).match(/((?:INC|REQ|CHG|PRB|inc|req|chg|prb)\d{1,9}|[A-Za-z][A-Za-z0-9]{1,15}-\d{1,6}|EVT-[A-Za-z0-9_-]{4,})$/);
    if (!m) return false;
    const ref = resolve(m[1]);
    if (!ref) return false;
    const tokenRange = document.createRange();
    tokenRange.setStart(node, r.startOffset - m[1].length);
    tokenRange.setEnd(node, r.startOffset);
    insertNode(chipFragment(ref), tokenRange);
    return true;
  };

  // ── @mentions ──────────────────────────────────────────────────────────────
  const buildMentionChip = (p: MentionPerson): HTMLElement => {
    const chip = document.createElement("span");
    chip.contentEditable = "false";
    chip.dataset.mention = p.id;
    chip.className = "mx-px inline-flex items-center rounded px-1 align-baseline text-[0.92em] font-medium ring-1 bg-violet-500/15 text-violet-200 ring-violet-500/30";
    chip.textContent = `@${p.label}`;
    return chip;
  };
  // Watch the text just before the caret for a "@word" being typed; show the picker at the caret.
  const detectMention = () => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) { setMention(null); return; }
    const r = sel.getRangeAt(0);
    if (!r.collapsed || r.startContainer.nodeType !== Node.TEXT_NODE) { setMention(null); return; }
    const before = (r.startContainer.textContent ?? "").slice(0, r.startOffset);
    const m = before.match(/(?:^|\s)@(\w{0,30})$/);
    if (!m) { setMention(null); return; }
    const rect = r.getBoundingClientRect();
    const er = editorRef.current?.getBoundingClientRect();
    const top = rect.top || er?.top || 0;
    const left = rect.left || er?.left || 0;
    setMention({ query: m[1], ...placePopover({ top, left, bottom: rect.bottom || top + 18 }, 224, 232) });
  };
  const chooseMention = (p: MentionPerson) => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) { setMention(null); return; }
    const r = sel.getRangeAt(0);
    const node = r.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) { setMention(null); return; }
    const m = (node.textContent ?? "").slice(0, r.startOffset).match(/@(\w{0,30})$/);
    if (!m) { setMention(null); return; }
    const tokenRange = document.createRange();
    tokenRange.setStart(node, r.startOffset - m[0].length);
    tokenRange.setEnd(node, r.startOffset);
    const frag = document.createDocumentFragment();
    frag.appendChild(buildMentionChip(p));
    frag.appendChild(document.createTextNode(" "));
    insertNode(frag, tokenRange);
    setMention(null);
  };

  const doSubmit = async () => {
    const editor = editorRef.current;
    const body = serializeEditor(editor).replace(/[^\S\n]{2,}/g, " ").trim();
    if (!body) { if (editing) onCancel?.(); return; }
    if (await onSubmit(body)) { if (!editing && editor) { editor.innerHTML = ""; editor.focus(); lastRange.current = null; setEmpty(true); } }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (mention && mentionItems.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMActive((a) => (a + 1) % mentionItems.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMActive((a) => (a - 1 + mentionItems.length) % mentionItems.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); chooseMention(mentionItems[mActive]); return; }
      if (e.key === "Escape") { e.preventDefault(); setMention(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSubmit(); }
    // Shift+Enter inserts a line break (a real paragraph) and never sends. execCommand renders
    // the break reliably (a trailing "\n" text node otherwise wouldn't show until you type more).
    else if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); document.execCommand("insertLineBreak"); refresh(); keepCaretVisible(); }
    else if (e.key === "Escape" && onCancel) { e.preventDefault(); onCancel(); }
    else if (e.key === " ") { if (tryAutoChip()) e.preventDefault(); }
  };
  const onPaste = (e: React.ClipboardEvent) => { e.preventDefault(); insertNode(document.createTextNode(e.clipboardData.getData("text/plain"))); };

  return (
    <div className="relative border-t border-slate-800 p-2 shrink-0">
      {pickerOpen && <LinkPicker address={address} onClose={() => setPickerOpen(false)} onInsert={insertRef} />}
      {mention && createPortal(
        <div style={{ position: "fixed", top: mention.top, left: mention.left, width: 224 }} className="z-[200] max-h-56 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-1 shadow-2xl">
          {mentionItems.length === 0 ? (
            <p className="px-2 py-2 text-[11px] text-slate-500">No people to mention</p>
          ) : mentionItems.map((p, i) => (
            <button key={p.id} type="button" onMouseDown={(e) => { e.preventDefault(); chooseMention(p); }} onMouseEnter={() => setMActive(i)}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${i === mActive ? "bg-slate-800" : "hover:bg-slate-800/60"}`}>
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-[10px] font-semibold text-violet-200">{(p.label[0] || "@").toUpperCase()}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{p.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
      <div className="flex items-end gap-2">
        <button type="button" onClick={() => setPickerOpen((v) => !v)} title="Insert a board ticket or calendar event" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors ${pickerOpen ? "border-indigo-500 bg-indigo-500/15 text-indigo-200" : "border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500 hover:text-white"}`}>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
        </button>
        <div className="relative min-w-0 flex-1">
          <div
            ref={editorRef}
            contentEditable
            role="textbox"
            aria-multiline="true"
            suppressContentEditableWarning
            onInput={() => { refresh(); keepCaretVisible(); detectMention(); }}
            onKeyDown={onKeyDown}
            onKeyUp={() => { saveRange(); detectMention(); }}
            onMouseUp={() => { saveRange(); detectMention(); }}
            onBlur={() => { saveRange(); setTimeout(() => setMention(null), 150); }}
            onPaste={onPaste}
            className="w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none min-h-[2.25rem] max-h-24"
          />  
          {empty && !editing && <span className="pointer-events-none absolute left-3 top-1.5 text-sm text-slate-500">Write a message…</span>}
        </div>
        {editing && (
          <button type="button" onClick={onCancel} title="Cancel editing (Esc)" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-400 transition-colors hover:border-rose-500/50 hover:text-rose-300">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        )}
        <button type="button" onClick={doSubmit} disabled={!editing && empty} title={editing ? "Save changes" : "Send"} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50">
          {editing
            ? <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            : <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>}
        </button>
      </div>
    </div>
  );
}

function LinkPicker({ address, onInsert, onClose }: { address: string; onInsert: (ref: InsertRef) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const tickets = useMemo(() => ticketLinkTargets(address), [address]);
  const events = useMemo(() => eventLinkTargets(address), [address]);
  const records = useMemo(() => itsmLinkTargets(address), [address]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);
  const term = q.trim().toLowerCase();
  const tHits = (term ? tickets.filter((t) => t.key.toLowerCase().includes(term) || t.title.toLowerCase().includes(term)) : tickets).slice(0, 8);
  const eHits = (term ? events.filter((e) => e.title.toLowerCase().includes(term)) : events).slice(0, 8);
  const rHits = (term ? records.filter((r) => r.token.toLowerCase().includes(term) || r.label.toLowerCase().includes(term)) : records).slice(0, 8);
  return (
    <div ref={boxRef} className="absolute bottom-full left-2 right-2 z-20 mb-2 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }} placeholder="Search tickets, events & records…" className="w-full border-b border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none" />
      <div className="max-h-64 overflow-y-auto p-1">
        {tHits.length === 0 && eHits.length === 0 && rHits.length === 0 && <p className="px-2 py-5 text-center text-[11px] text-slate-600">Nothing to link yet — create a ticket, event or Service Desk record first.</p>}
        {rHits.length > 0 && <p className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Service Desk</p>}
        {rHits.map((r) => (
          <button key={r.token} type="button" onClick={() => onInsert({ token: r.token, label: r.token, kind: "itsm" })} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-800">
            <span className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] ring-1 ring-inset ${itsmMeta(r.type).chip}`}><ItsmChipIcon />{r.token}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{r.label}</span>
            <span className="shrink-0 text-[10px] text-slate-500">{r.state}</span>
          </button>
        ))}
        {tHits.length > 0 && <p className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Board tickets</p>}
        {tHits.map((t) => (
          <button key={`${t.boardId}:${t.ticketId}`} type="button" onClick={() => onInsert({ token: t.key, label: t.key, kind: "ticket" })} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-800">
            <span className="flex shrink-0 items-center gap-1 rounded bg-indigo-500/20 px-1.5 py-0.5 font-mono text-[10px] text-indigo-200"><TagIcon />{t.key}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{t.title}</span>
            <span className="shrink-0 truncate text-[10px] text-slate-500">{t.boardTitle}</span>
          </button>
        ))}
        {eHits.length > 0 && <p className="px-2 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Calendar events</p>}
        {eHits.map((ev) => (
          <button key={ev.eventId} type="button" onClick={() => onInsert({ token: ev.token, label: (ev.boardCode ? ev.boardCode + " · " : "") + ev.title, kind: "event" })} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-800">
            <span className="flex shrink-0 items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-200"><EvtIcon />{ev.boardCode || "Event"}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{ev.title}</span>
            <span className="shrink-0 text-[10px] text-slate-500">{ev.date}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function AccessKeyPicker({ address, exclude, onPick }: { address: string; exclude: string[]; onPick: (token: string, label: string, addr: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const ids = useMemo(() => loadIdentities(address).filter((i) => i.address !== address), [address]);
  const available = ids.filter((i) => !exclude.includes(i.address));
  const filtered = available.filter((i) => `${i.label} ${i.address}`.toLowerCase().includes(q.trim().toLowerCase()));
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  useEffect(() => { setActive(0); }, [q, open]);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: "nearest" }); }, [active]);
  const choose = (i: typeof filtered[number]) => { onPick(i.publicKey || i.address, i.label || shortAddr(i.address), i.address); setQ(""); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (!filtered.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(filtered.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); const i = filtered[active]; if (i) choose(i); }
  };
  return (
    <div ref={boxRef} className="relative">
      <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="M21 21l-4-4" /></svg>
      <input value={q} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onKeyDown={onKeyDown} placeholder="Search Access Keys to add…" className="w-full rounded-lg border border-slate-700 bg-slate-800 pl-8 pr-7 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none" />
      <svg onClick={() => setOpen((v) => !v)} className={`absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 cursor-pointer text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" /></svg>
      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 max-h-52 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
          {ids.length === 0 ? (
            <p className="px-2.5 py-2 text-[11px] text-slate-600">No saved Access Keys yet — add people in the Access Keys tab.</p>
          ) : available.length === 0 ? (
            <p className="px-2.5 py-2 text-[11px] text-slate-600">Everyone from Access Keys is already added.</p>
          ) : filtered.length === 0 ? (
            <p className="px-2.5 py-2 text-[11px] text-slate-600">No matches.</p>
          ) : filtered.map((i, idx) => (
            <button key={i.address} ref={idx === active ? activeRef : undefined} onMouseMove={() => setActive(idx)} onClick={() => choose(i)} className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs ${idx === active ? "bg-slate-800 text-slate-100" : "text-slate-200 hover:bg-slate-800"}`}>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600/30 text-[9px] font-medium text-indigo-200">{initials(i.label || i.address)}</span>
              <span className="min-w-0 flex-1 truncate">{i.label || shortAddr(i.address)}</span>
              <span className="shrink-0 text-[10px] text-slate-500">{shortAddr(i.address)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Members bar for an existing chat — chips you can rename locally + (owner) add via
// the Access Keys dropdown.
function MembersBar({ address, members, busy, isOwner, aliases, onAddMember, onSetAlias }: { address: string; members: ChatMember[]; busy: boolean; isOwner: boolean; aliases: Record<string, string>; onAddMember: (token: string, label: string) => void; onSetAlias: (addr: string, name: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const start = (m: ChatMember) => { setEditing(m.address); setDraft(aliases[m.address] || ""); };
  const commit = (addr: string) => { onSetAlias(addr, draft); setEditing(null); };
  return (
    <div className="border-b border-slate-800 bg-slate-900/60 px-4 py-2 shrink-0">
      <div className="flex flex-wrap items-center gap-1.5">
        {members.map((m) => editing === m.address ? (
          <span key={m.address} className="flex items-center gap-1 rounded-full bg-slate-800 px-1.5 py-0.5 ring-1 ring-indigo-500">
            <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commit(m.address); if (e.key === "Escape") setEditing(null); }} placeholder={m.label} className="w-24 bg-transparent text-[11px] text-slate-100 placeholder:text-slate-500 focus:outline-none" />
            <button onClick={() => commit(m.address)} title="Save" className="text-emerald-400 hover:text-emerald-300"><svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg></button>
            <button onClick={() => setEditing(null)} title="Cancel" className="text-slate-500 hover:text-slate-300"><svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg></button>
          </span>
        ) : (
          <span key={m.address} className="group/mem flex items-center gap-1.5 rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-200" title={m.address}>
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-indigo-600/30 text-[8px] text-indigo-200">{initials(nameOf(m.address, m.label, aliases))}</span>
            {nameOf(m.address, m.label, aliases)}{m.address === address ? " (you)" : ""}
            <button onClick={() => start(m)} title="Rename (only for you)" className="text-slate-500 opacity-0 transition-opacity hover:text-indigo-300 group-hover/mem:opacity-100"><svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z" /></svg></button>
          </span>
        ))}
        {isOwner && <button onClick={() => setAdding((v) => !v)} className="rounded-full border border-dashed border-slate-600 px-2 py-0.5 text-[11px] text-slate-400 hover:border-indigo-500 hover:text-indigo-300">{adding ? "− close" : "+ add"}</button>}
      </div>
      {adding && isOwner && <AddMember address={address} existing={members.map((m) => m.address)} busy={busy} onAdd={(t, l) => { onAddMember(t, l); setAdding(false); }} />}
    </div>
  );
}

function AddMember({ address, existing, busy, onAdd }: { address: string; existing: string[]; busy: boolean; onAdd: (token: string, label: string) => void }) {
  const [token, setToken] = useState("");
  const [label, setLabel] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const submit = () => { const t = token.trim(); if (!t) return; if (!isValidArweaveAddress(t) && !looksLikePublicKey(t)) return; onAdd(t, label.trim()); setToken(""); setLabel(""); };
  return (
    <div className="mt-2 rounded-lg border border-slate-800 bg-slate-800/40 p-2 space-y-1.5">
      <AccessKeyPicker address={address} exclude={existing} onPick={(t, l) => onAdd(t, l)} />
      <button onClick={() => setShowPaste((v) => !v)} className="text-[11px] text-slate-500 hover:text-slate-300">{showPaste ? "− Hide" : "+ Add someone new by address / public key"}</button>
      {showPaste && (
        <div className="space-y-1.5">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name / label" className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none" />
          <div className="flex gap-1.5">
            <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Arweave address or public key" className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none" />
            <button onClick={submit} disabled={busy || !token.trim()} className="shrink-0 rounded bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-indigo-500 disabled:opacity-50">{busy ? "…" : "Add"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// New-chat form (vertically centred): name + your display name + Access-Keys member
// dropdown (multi-pick) → a group chat. A chat needs at least one other member; the
// name is optional (defaults sensibly).
function NewChat({ address, busy, initialPicks, onCancel, onCreate }: { address: string; busy: boolean; initialPicks?: { token: string; label: string; address: string }[]; onCancel: () => void; onCreate: (title: string, meLabel: string, picks: { token: string; label: string }[]) => void }) {
  const [title, setTitle] = useState("");
  const [meLabel, setMeLabel] = useState(shortAddr(address));
  const [picks, setPicks] = useState<{ token: string; label: string; address: string }[]>(() => initialPicks ?? []);
  const [token, setToken] = useState("");
  const [label, setLabel] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const addPick = (tok: string, lab: string, addr: string) => { if (addr === address || picks.some((p) => p.address === addr)) return; setPicks((p) => [...p, { token: tok, label: lab || shortAddr(addr), address: addr }]); };
  const addPasted = () => { const t = token.trim(); if (!t) return; if (!isValidArweaveAddress(t) && !looksLikePublicKey(t)) return; addPick(t, label.trim() || shortAddr(t), isValidArweaveAddress(t) ? t : t.slice(0, 24)); setToken(""); setLabel(""); setShowPaste(false); };
  const defaultTitle = () => (picks.length > 1 ? "Group chat" : picks[0]?.label || "Chat");
  const create = () => onCreate(title.trim() || defaultTitle(), meLabel.trim() || shortAddr(address), picks.map((p) => ({ token: p.token, label: p.label })));

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="w-full max-w-md space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">New chat</h3>
            <button onClick={onCancel} className="text-[11px] text-slate-400 hover:text-slate-200">Cancel</button>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Chat name <span className="normal-case text-slate-600">(optional)</span></label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`e.g. Design team — defaults to “${defaultTitle()}”`} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none" />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Your display name</label>
            <input value={meLabel} onChange={(e) => setMeLabel(e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Members ({picks.length})</label>
            {picks.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {picks.map((p) => (
                  <span key={p.address} className="flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-200">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-indigo-600/30 text-[8px] text-indigo-200">{initials(p.label)}</span>
                    {p.label}
                    <button onClick={() => setPicks((x) => x.filter((y) => y.address !== p.address))} className="text-slate-500 hover:text-red-400">×</button>
                  </span>
                ))}
              </div>
            )}
            <AccessKeyPicker address={address} exclude={picks.map((p) => p.address)} onPick={(t, l, a) => addPick(t, l, a)} />
            <div>
              <button onClick={() => setShowPaste((v) => !v)} className="text-[11px] text-slate-500 hover:text-slate-300">{showPaste ? "− Hide" : "+ Add someone new by address / public key"}</button>
              {showPaste && (
                <div className="mt-1.5 rounded-lg border border-dashed border-slate-700 p-2 space-y-1.5">
                  <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name / label" className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none" />
                  <div className="flex gap-1.5">
                    <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Arweave address or public key" className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none" />
                    <button onClick={addPasted} disabled={!token.trim()} className="shrink-0 rounded bg-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-600 disabled:opacity-50">Add</button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button onClick={create} disabled={busy || picks.length === 0} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50">{busy ? "Creating…" : "Create chat"}</button>
            <p className="text-[10px] text-slate-600">{picks.length === 0 ? "Add at least one member." : "New wallets must be added by public key."}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
