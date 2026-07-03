"use client";

import { useCallback, useEffect, useState } from "react";
import { loadChats, loadReads, saveReads, loadChatState, latestMessageAt } from "./chat";
import { latestMessageAts } from "./chatSync";

// Tracks which chats have unread messages (others' messages newer than my last read),
// polled in the background so the sidebar Chat icon can show a notification even when
// the Chat tab isn't open. Uses a single tags-only GraphQL query (no decryption).
export function useChatUnread(address: string | null) {
  const [unread, setUnread] = useState<Record<string, number>>({});

  const recompute = useCallback(async () => {
    if (!address) { setUnread({}); return; }
    const ids = loadChats(address).map((c) => c.id);
    if (ids.length === 0) { setUnread({}); return; }
    let latest: Record<string, number> = {};
    try { latest = await latestMessageAts(ids, address); } catch { return; }
    const reads = loadReads(address);
    // Seed a chat's read mark from what's already cached locally (what I've seen), so
    // messages that arrived since I last opened it correctly show as unread.
    let seeded = false;
    for (const id of ids) if (reads[id] == null) { reads[id] = latestMessageAt(loadChatState(id)); seeded = true; }
    if (seeded) saveReads(address, reads);
    const next: Record<string, number> = {};
    for (const id of ids) { const at = latest[id] ?? 0; if (at > (reads[id] ?? 0)) next[id] = at; }
    setUnread(next);
  }, [address]);

  useEffect(() => {
    let alive = true;
    let t: ReturnType<typeof setTimeout> | null = null;
    const loop = async () => { if (!alive) return; await recompute(); if (!alive) return; t = setTimeout(loop, 12_000); };
    loop();
    return () => { alive = false; if (t) clearTimeout(t); };
  }, [recompute]);

  const markRead = useCallback((chatId: string, at?: number) => {
    setUnread((u) => {
      // Clamp the persisted read mark to AT LEAST the network-latest that made this chat
      // unread (u[chatId]) — not just the locally-cached latest (`at`). Otherwise the next
      // background poll, which compares against the network-latest, would resurrect the dot
      // for a message that simply hasn't been folded into local state yet.
      const networkAt = u[chatId] ?? 0;
      const reads = loadReads(address);
      reads[chatId] = Math.max(reads[chatId] ?? 0, at ?? Date.now(), networkAt);
      saveReads(address, reads);
      if (!(chatId in u)) return u;
      const n = { ...u };
      delete n[chatId];
      return n;
    });
  }, [address]);

  // Force a chat to show as unread (read mark below its latest message).
  const markUnread = useCallback((chatId: string) => {
    const reads = loadReads(address);
    reads[chatId] = 0;
    saveReads(address, reads);
    const at = latestMessageAt(loadChatState(chatId));
    setUnread((u) => (at > 0 ? { ...u, [chatId]: at } : u));
  }, [address]);

  return { unread, total: Object.keys(unread).length, markRead, markUnread, refresh: recompute };
}
