"use client";

// User profile page: a wallet's identity + its recent activity across every page, with a
// page filter (default All) and a search to look up any wallet. Reached from a @mention's
// hovercard ("See profile") or the sidebar. Activity is gathered from what the viewer can
// already see (see lib/activity.ts) — it never reveals anything new about the subject.

import { useEffect, useMemo, useState } from "react";
import { collectActivity, ACTIVITY_SOURCES, type ActivitySource, type ActivityNav } from "@/lib/activity";
import { usePagedRows } from "@/lib/usePagedRows";
import { PaginationBar } from "./PaginationBar";
import { loadIdentities, isValidArweaveAddress } from "@/lib/accessKeys";
import { loadBoards, loadBoardState, saveBoards } from "@/lib/board";
import { syncBoardState, discoverSharedBoards, resolveBoardKey } from "@/lib/boardSync";
import { loadChats, loadChatState } from "@/lib/chat";
import { fetchProfile, loadCachedProfile } from "@/lib/profile";
import { UserAvatar } from "./UserAvatar";
import { PageIcon, CallIcon } from "./PageIcons";
import { SocialLinks } from "./SocialLinks";
import { IdentityEditor } from "./IdentityEditor";
import { callUser } from "@/lib/profileNav";

type Toast = (m: string, t?: "error" | "info" | "warning" | "success") => void;
type Person = { id: string; label: string };

const short = (a: string) => (a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

function timeAgo(at: number): string {
  const s = Math.floor((Date.now() - at) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7); if (w < 5) return `${w}w ago`;
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

// Everyone the viewer might look up. The name shown prefers the address-book name YOU chose
// (Access Keys → identities), then a board/chat member label, then a short address. Board self-
// labels like "Owner" must NOT win over your address-book name. You are always "You".
function buildDirectory(viewer: string): Person[] {
  const member = new Map<string, string>(); // board/chat member labels (lower priority)
  const book = new Map<string, string>();   // address-book names (higher priority)
  // "Owner" is foldBoard's auto-placeholder for the board owner, not a name anyone chose — ignore it.
  const addMember = (addr: string, label?: string) => { const l = label?.trim(); if (addr && l && l !== "Owner" && !member.has(addr)) member.set(addr, l); };
  for (const b of loadBoards(viewer)) for (const m of loadBoardState(b.id).members) addMember(m.address, m.label);
  for (const c of loadChats(viewer)) for (const m of loadChatState(c.id).members) addMember(m.address, m.label);
  for (const id of loadIdentities(viewer)) { const l = id.label?.trim(); if (id.address && l) book.set(id.address, l); }
  const addrs = new Set<string>([...member.keys(), ...book.keys(), viewer]);
  return [...addrs]
    .map((id) => ({ id, label: id === viewer ? "You" : book.get(id) || member.get(id) || short(id) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export default function ProfileView({ address, subject, onChangeSubject, onOpenActivity, onToast }: { address: string; subject: string; onChangeSubject: (addr: string, label?: string) => void; onOpenActivity: (nav: ActivityNav, rect: DOMRect) => void; onToast: Toast }) {
  const [q, setQ] = useState("");
  const [searchActive, setSearchActive] = useState(0); // keyboard-highlighted search result
  const [filter, setFilter] = useState<ActivitySource | "all">("all");
  const [copied, setCopied] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [version, setVersion] = useState(0); // bumped after an on-chain refresh / identity save

  // Discover every board shared with / owned by this wallet (recovering ones missing from the
  // local list), cache their keys, then fold each from Arweave — so another member's activity is
  // complete and current (their actions live in the shared, encrypted board log, not locally).
  useEffect(() => {
    let on = true;
    setSyncing(true);
    (async () => {
      try {
        const refs = await discoverSharedBoards(address).catch(() => []);
        const metas = loadBoards(address);
        const have = new Set(metas.map((b) => b.id));
        const added = refs.filter((r) => !have.has(r.boardId));
        if (added.length) { for (const r of added) metas.push({ id: r.boardId, title: "Shared board", owner: r.owner, shared: true, role: r.role, updatedAt: r.at }); saveBoards(address, metas); }
        await Promise.allSettled(refs.map((r) => resolveBoardKey(r.boardId, r.wrappedKey))); // cache keys
        const shared = loadBoards(address).filter((b) => b.shared);
        await Promise.allSettled(shared.map((b) => syncBoardState(b.id, address)));
      } catch { /* best effort */ }
      if (on) { setVersion((v) => v + 1); setSyncing(false); }
    })();
    return () => { on = false; };
  }, [address, subject]);

  const directory = useMemo(() => buildDirectory(address), [address, version]);
  const pub = useMemo(() => loadCachedProfile(subject), [subject, version]); // on-chain profile (name + socials)
  const bookName = loadIdentities(address).find((i) => i.address === subject)?.label?.trim();
  const subjectLabel = bookName || pub?.name?.trim() || directory.find((p) => p.id === subject)?.label || (subject === address ? "You" : short(subject));
  const subjectSocials = pub?.socials ?? loadIdentities(address).find((i) => i.address === subject)?.socials ?? [];
  const activity = useMemo(() => collectActivity(address, subject), [address, subject, version]);
  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const a of activity) c[a.source] = (c[a.source] ?? 0) + 1; return c; }, [activity]);
  const shown = filter === "all" ? activity : activity.filter((a) => a.source === filter);
  // Fit the activity list to the height available + page the overflow (shared with Vault / Service Desk).
  const { containerRef, page: curPage, setPage, totalPages, pageItems, pageSize } = usePagedRows(shown, 50, `${subject}|${filter}|${version}`);

  const term = q.trim().toLowerCase();
  const results = term
    ? directory.filter((p) => p.label.toLowerCase().includes(term) || p.id.toLowerCase().includes(term)).slice(0, 8)
    : [];
  const rawAddr = isValidArweaveAddress(q.trim()) ? q.trim() : null;
  // Flat list of search options (people + a raw address), so ↑/↓/Enter can walk them.
  const searchOptions: { id: string; label?: string; raw: boolean }[] = [
    ...results.map((p) => ({ id: p.id, label: p.label, raw: false })),
    ...(rawAddr && !results.some((r) => r.id === rawAddr) ? [{ id: rawAddr, label: undefined, raw: true }] : []),
  ];
  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { setQ(""); return; }
    if (!searchOptions.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setSearchActive((a) => Math.min(searchOptions.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSearchActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); const o = searchOptions[searchActive]; if (o) pick(o.id, o.label); }
  };

  useEffect(() => { setSearchActive(0); }, [q]);
  useEffect(() => { setFilter("all"); setEditing(false); }, [subject]);
  // Pull the subject's on-chain profile (name + socials) so it's current.
  useEffect(() => { let on = true; fetchProfile(subject).then(() => { if (on) setVersion((v) => v + 1); }).catch(() => {}); return () => { on = false; }; }, [subject]);

  const copy = () => { navigator.clipboard?.writeText(subject).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => onToast("Couldn't copy", "error")); };
  const pick = (addr: string, label?: string) => { setQ(""); onChangeSubject(addr, label); };

  return (
    <div className="flex h-[calc(100vh-9rem)] flex-col gap-4">
      {/* search any wallet */}
      <div className="relative max-w-md shrink-0">
        <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="M21 21l-4-4" /></svg>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchKey} placeholder="Search people or paste a wallet address…" className="w-full rounded-lg border border-slate-700 bg-slate-800 pl-9 pr-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none" />
        {searchOptions.length > 0 && (
          <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-slate-700 bg-slate-900 p-1 shadow-2xl">
            {results.map((p, i) => (
              <button key={p.id} onMouseMove={() => setSearchActive(i)} onClick={() => pick(p.id, p.label)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${i === searchActive ? "bg-slate-800" : "hover:bg-slate-800"}`}>
                <UserAvatar seed={p.id} label={p.label} size={24} />
                <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{p.label}</span>
                <span className="shrink-0 font-mono text-[10px] text-slate-500">{short(p.id)}</span>
              </button>
            ))}
            {rawAddr && !results.some((r) => r.id === rawAddr) && (
              <button onMouseMove={() => setSearchActive(results.length)} onClick={() => pick(rawAddr)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${searchActive === results.length ? "bg-slate-800" : "hover:bg-slate-800"}`}>
                <UserAvatar seed={rawAddr} size={24} />
                <span className="min-w-0 flex-1 truncate text-xs text-slate-200">Open this wallet</span>
                <span className="shrink-0 font-mono text-[10px] text-slate-500">{short(rawAddr)}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* identity header */}
      {editing ? (
        <IdentityEditor owner={address} address={subject} isSelf={subject === address} initialLabel={subjectLabel} initialSocials={subjectSocials} onToast={onToast}
          onSaved={() => { setEditing(false); setVersion((v) => v + 1); }} onCancel={() => setEditing(false)} />
      ) : (
        <div className="flex shrink-0 flex-wrap items-center gap-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <UserAvatar seed={subject} label={subjectLabel} size={56} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-lg font-semibold text-white">{subjectLabel}</h2>
              {subject === address && <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] font-medium text-indigo-300 ring-1 ring-inset ring-indigo-500/30">You</span>}
            </div>
            <button onClick={copy} title="Copy address" className="mt-0.5 flex items-center gap-1.5 font-mono text-xs text-slate-400 hover:text-slate-200">
              {short(subject)}
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 012-2h10" /></svg>
              {copied && <span className="text-emerald-400">copied</span>}
            </button>
            {subjectSocials.length > 0 && <SocialLinks socials={subjectSocials} className="mt-2" />}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {subject === address ? (
              <button onClick={() => setEditing(true)} title="Edit your identity & socials" className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 text-xs font-medium text-slate-300 transition-colors hover:border-indigo-500/50 hover:text-white">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>
                Edit profile
              </button>
            ) : (
              <>
                <button onClick={() => setEditing(true)} title="Edit this person's name" aria-label="Edit name" className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-300 transition-colors hover:border-indigo-500/50 hover:text-white">
                  <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>
                </button>
                <button onClick={() => callUser({ address: subject, label: subjectLabel })} title="Call" aria-label="Call" className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-300 transition-colors hover:border-indigo-500/50 hover:text-white">
                  <CallIcon className="h-[18px] w-[18px]" />
                </button>
                <button onClick={() => callUser({ address: subject, label: subjectLabel })} title="Send message" aria-label="Send message" className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white transition-colors hover:bg-indigo-500">
                  <PageIcon kind="chat" className="h-[18px] w-[18px]" />
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* page filter */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label="All" count={activity.length} />
        {ACTIVITY_SOURCES.map((s) => <FilterChip key={s.key} active={filter === s.key} onClick={() => setFilter(s.key)} label={s.label} count={counts[s.key] ?? 0} icon={<PageIcon kind={s.key} className="h-3.5 w-3.5" />} />)}
      </div>

      {/* activity list — sized to the remaining height and paginated so the page never scrolls */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-800">
        <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden">
          {shown.length === 0 ? (
            <p className="px-4 py-10 text-center text-xs text-slate-600">{syncing ? "Checking the chain for shared activity…" : activity.length === 0 ? "No activity you can see for this wallet yet." : "No activity on this page."}</p>
          ) : (
            pageItems.map((a, i) => (
              <button key={`${a.id}-${curPage * pageSize + i}`} data-row onClick={(e) => onOpenActivity(a.nav, e.currentTarget.getBoundingClientRect())} className="flex w-full items-center gap-3 border-b border-slate-800/60 px-3 py-2.5 text-left last:border-0 hover:bg-slate-800/40">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-slate-400" title={ACTIVITY_SOURCES.find((s) => s.key === a.source)?.label}><PageIcon kind={a.source} className="h-3.5 w-3.5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-slate-200">{a.title}</p>
                  {a.sub && <p className="truncate text-[10px] text-slate-500">{a.sub}</p>}
                </div>
                <span className="shrink-0 text-[10px] tabular-nums text-slate-500">{timeAgo(a.at)}</span>
                <svg className="h-3.5 w-3.5 shrink-0 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M9 6l6 6-6 6" /></svg>
              </button>
            ))
          )}
        </div>
        <PaginationBar page={curPage} totalPages={totalPages} onPage={setPage} />
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, label, count, icon }: { active: boolean; onClick: () => void; label: string; count: number; icon?: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${active ? "border-indigo-500 bg-indigo-500/15 text-indigo-200" : "border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500"}`}>
      {icon}{label}
      <span className={`rounded px-1 text-[10px] tabular-nums ${active ? "bg-indigo-500/30 text-indigo-100" : "bg-slate-700 text-slate-400"}`}>{count}</span>
    </button>
  );
}
