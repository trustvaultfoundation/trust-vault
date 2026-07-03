"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadItsm, loadItsmSeen, saveItsmSeen, saveSharedItsm, type ItsmRecord } from "./itsm";
import { loadBoards } from "./board";
import { discoverBoardItsm } from "./itsmSync";

const shortAddr = (a: string) => (a && a.length > 10 ? `${a.slice(0, 5)}…${a.slice(-4)}` : a || "?");

// Tracks NEW Service Desk records the user hasn't seen yet (records created/updated by SOMEONE
// ELSE on a board I'm in, newer than my last "seen" mark), polled in the background so the
// sidebar shows a notification dot even when the section is closed — mirrors useChatUnread.
export function useItsmUnread(address: string | null) {
  const [total, setTotal] = useState(0);
  const recordsRef = useRef<ItsmRecord[]>([]);

  const recompute = useCallback(async () => {
    if (!address) { setTotal(0); recordsRef.current = []; return; }
    const me = shortAddr(address);
    const boardRecs: ItsmRecord[] = [];
    for (const b of loadBoards(address)) { try { boardRecs.push(...await discoverBoardItsm(b.id)); } catch { /* no key / offline */ } }
    saveSharedItsm(address, boardRecs); // populate the cross-link cache app-wide (not just in ITSMView)
    const map = new Map<string, ItsmRecord>();
    for (const r of loadItsm(address).records) map.set(r.id, r);
    for (const r of boardRecs) map.set(r.id, r);
    const recs = [...map.values()];
    recordsRef.current = recs;
    const seen = loadItsmSeen(address);
    let n = 0;
    for (const r of recs) {
      if (r.owner === me || r.createdBy === me) continue; // my own work isn't a notification
      if (seen[r.id] == null || r.updatedAt > seen[r.id]) n++;
    }
    setTotal(n);
  }, [address]);

  useEffect(() => {
    let alive = true;
    let t: ReturnType<typeof setTimeout> | null = null;
    const loop = async () => { if (!alive) return; await recompute(); if (!alive) return; t = setTimeout(loop, 45_000); };
    loop();
    // Recompute immediately when a record is opened/marked-seen so the dot updates without lag.
    const onSeen = () => { void recompute(); };
    window.addEventListener("gtv-itsm-seen", onSeen);
    return () => { alive = false; if (t) clearTimeout(t); window.removeEventListener("gtv-itsm-seen", onSeen); };
  }, [recompute]);

  // Mark every currently-known record as seen (called when the user opens the section).
  const markAllSeen = useCallback(() => {
    if (!address) return;
    const seen = loadItsmSeen(address);
    for (const r of recordsRef.current) seen[r.id] = Math.max(seen[r.id] ?? 0, r.updatedAt);
    saveItsmSeen(address, seen);
    setTotal(0);
  }, [address]);

  return { total, markAllSeen, refresh: recompute };
}
