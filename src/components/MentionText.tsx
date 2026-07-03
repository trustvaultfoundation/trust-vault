"use client";

// Renders a plain string (a title, a note) with any "@Name" turned into a clickable pill
// that opens the user card — the read-side counterpart to MentionInput. Plain fields store
// the label (not an address), so we resolve each against the people you know (address book +
// board/chat members), matching the longest known name first. Unknown @words stay text.

import { Fragment, useMemo } from "react";
import { loadIdentities } from "@/lib/accessKeys";
import { loadBoards, loadBoardState } from "@/lib/board";
import { loadChats, loadChatState } from "@/lib/chat";
import { showUserCard } from "@/lib/profileNav";

type Dir = { label: string; id: string }[];
let cache: { viewer: string; at: number; dir: Dir } | null = null;

function directory(viewer: string): Dir {
  if (cache && cache.viewer === viewer && Date.now() - cache.at < 5000) return cache.dir;
  const map = new Map<string, string>(); // label -> address (first wins)
  const set = (addr: string, label?: string) => { const l = label?.trim(); if (addr && l && !map.has(l)) map.set(l, addr); };
  for (const id of loadIdentities(viewer)) set(id.address, id.label);
  for (const b of loadBoards(viewer)) for (const m of loadBoardState(b.id).members) set(m.address, m.label);
  for (const c of loadChats(viewer)) for (const m of loadChatState(c.id).members) set(m.address, m.label);
  const dir = [...map].map(([label, id]) => ({ label, id })).sort((a, b) => b.label.length - a.label.length);
  cache = { viewer, at: Date.now(), dir };
  return dir;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function MentionText({ text, viewer, className }: { text: string; viewer: string; className?: string }) {
  const nodes = useMemo<(string | { label: string; id: string })[]>(() => {
    if (!text || !text.includes("@")) return [text];
    const dir = directory(viewer);
    if (dir.length === 0) return [text];
    const re = new RegExp("@(" + dir.map((p) => esc(p.label)).join("|") + ")", "g");
    const out: (string | { label: string; id: string })[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index));
      out.push({ label: m[1], id: dir.find((p) => p.label === m![1])!.id });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }, [text, viewer]);

  if (nodes.length === 1 && typeof nodes[0] === "string") return <span className={className}>{nodes[0]}</span>;
  return (
    <span className={className}>
      {nodes.map((n, i) => typeof n === "string" ? <Fragment key={i}>{n}</Fragment> : (
        <button key={i} type="button" onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); showUserCard({ address: n.id, label: n.label, rect: { top: r.top, left: r.left, bottom: r.bottom } }); }} className="rounded px-0.5 font-medium text-violet-300 hover:bg-violet-500/15">@{n.label}</button>
      ))}
    </span>
  );
}
