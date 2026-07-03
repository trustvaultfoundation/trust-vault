"use client";

// A single global user card. Any @mention pill (rich-text node view or rendered HTML) calls
// showUserCard() with its on-screen rect; this host renders the popup: avatar, name, socials,
// last activity, and Call / See profile / Edit actions. Editing writes the name + socials to your
// Access Keys. Mounted once in AppShell.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { placePopover } from "@/lib/popover";
import { collectActivity } from "@/lib/activity";
import { loadBoards } from "@/lib/board";
import { syncBoardState } from "@/lib/boardSync";
import { loadIdentities } from "@/lib/accessKeys";
import { fetchProfile, loadCachedProfile } from "@/lib/profile";
import { callUser, openUserProfile, type UserCardRequest } from "@/lib/profileNav";
import { UserAvatar } from "./UserAvatar";
import { SocialLinks } from "./SocialLinks";
import { IdentityEditor } from "./IdentityEditor";

type Toast = (m: string, t?: "error" | "info" | "warning" | "success") => void;

const short = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);
function timeAgo(at: number): string {
  const s = Math.floor((Date.now() - at) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`;
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function UserHovercardHost({ viewer, onToast }: { viewer: string; onToast?: Toast }) {
  const [card, setCard] = useState<UserCardRequest | null>(null);
  const [editing, setEditing] = useState(false);
  const [version, setVersion] = useState(0); // bumped after an on-chain refresh / identity save
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Measure the real popover size and place it next to the trigger, fully on-screen.
  useLayoutEffect(() => {
    if (!card) { setPos(null); return; }
    const el = popRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos(placePopover(card.rect, r.width || 280, r.height || 200));
  }, [card, editing, version]);

  useEffect(() => {
    const onCard = (e: Event) => { setCard((e as CustomEvent<UserCardRequest>).detail); setEditing(false); };
    window.addEventListener("gtv:user-card", onCard);
    return () => window.removeEventListener("gtv:user-card", onCard);
  }, []);

  // Fetch this person's on-chain profile (name + socials) when the card opens.
  useEffect(() => {
    if (!card) return;
    let on = true;
    fetchProfile(card.address).then(() => { if (on) setVersion((v) => v + 1); }).catch(() => {});
    return () => { on = false; };
  }, [card]);

  // When a card opens, pull fresh on-chain board events so "Last activity" is current.
  useEffect(() => {
    if (!card) return;
    let on = true;
    const shared = loadBoards(viewer).filter((b) => b.shared);
    if (shared.length === 0) return;
    Promise.allSettled(shared.map((b) => syncBoardState(b.id, viewer))).then(() => { if (on) setVersion((v) => v + 1); });
    return () => { on = false; };
  }, [card, viewer]);

  useEffect(() => {
    if (!card || editing) return; // don't dismiss while editing
    const close = () => setCard(null);
    const t = setTimeout(() => { document.addEventListener("mousedown", close); window.addEventListener("scroll", close, true); }, 0);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", close); window.removeEventListener("scroll", close, true); };
  }, [card, editing]);

  if (!card) return null;
  const ident = loadIdentities(viewer).find((i) => i.address === card.address);
  const pub = loadCachedProfile(card.address);
  const isMe = card.address === viewer;
  const name = ident?.label?.trim() || pub?.name?.trim() || (card.label && card.label !== "Owner" ? card.label : "") || (isMe ? "You" : short(card.address));
  const socials = pub?.socials ?? ident?.socials ?? [];
  let last: ReturnType<typeof collectActivity>[number] | null = null;
  try { last = collectActivity(viewer, card.address)[0] ?? null; } catch { last = null; }

  const W = 280;
  return createPortal(
    <div ref={popRef} onMouseDown={(e) => e.stopPropagation()} style={{ position: "fixed", top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: W, visibility: pos ? "visible" : "hidden" }} className="z-[300] overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
      {editing ? (
        <IdentityEditor owner={viewer} address={card.address} isSelf={isMe} initialLabel={name} initialSocials={socials} compact onToast={onToast}
          onSaved={() => { setEditing(false); setVersion((v) => v + 1); }} onCancel={() => setEditing(false)} />
      ) : (
        <>
          <div className="flex items-center gap-3 p-3">
            <UserAvatar seed={card.address} label={name} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{name}{isMe && <span className="ml-1.5 text-[10px] font-normal text-indigo-300">(you)</span>}</p>
              <p className="truncate font-mono text-[10px] text-slate-500">{short(card.address)}</p>
            </div>
            <button onClick={() => setEditing(true)} title={isMe ? "Edit your identity & socials" : "Edit this person's name"} className="shrink-0 text-slate-500 hover:text-indigo-300"><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" /></svg></button>
          </div>
          {socials.length > 0 && <div className="px-3 pb-2"><SocialLinks socials={socials} /></div>}
          <div className="border-t border-slate-800 px-3 py-2">
            <p className="text-[9px] uppercase tracking-wide text-slate-600">Last activity</p>
            {last ? (
              <p className="mt-0.5 truncate text-xs text-slate-300">{last.title} <span className="text-slate-500">· {timeAgo(last.at)}</span></p>
            ) : (
              <p className="mt-0.5 text-xs text-slate-600">Nothing you can see yet</p>
            )}
          </div>
          <div className="flex border-t border-slate-800">
            <button onClick={() => { setCard(null); callUser({ address: card.address, label: name }); }} className="flex flex-1 items-center justify-center gap-1.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 5.5A1.5 1.5 0 0 1 6 4h2.2a1 1 0 0 1 1 .8l.7 3a1 1 0 0 1-.5 1.1L8 9.8a11 11 0 0 0 5 5l.9-1.4a1 1 0 0 1 1.1-.5l3 .7a1 1 0 0 1 .8 1V17a1.5 1.5 0 0 1-1.5 1.5A12.5 12.5 0 0 1 4.5 5.5Z" /></svg>
              Call
            </button>
            <button onClick={() => { setCard(null); openUserProfile({ address: card.address, label: name }); }} className="flex flex-1 items-center justify-center gap-1.5 border-l border-slate-800 py-2 text-xs font-medium text-indigo-300 hover:bg-slate-800">
              See profile
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" /></svg>
            </button>
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}
