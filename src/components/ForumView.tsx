"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@/context/WalletContext";
import { LoginModal } from "@/components/LoginModal";
import {
  ADMIN_ADDRESS, CATEGORIES, DEFAULT_CATEGORY, categoryLabel,
  buildForumState, sortPosts, searchPosts,
  publishPost, publishComment, publishVote, publishMod,
  loadForumName, saveForumName,
  type ForumRaw, type ForumState, type ForumPost, type ForumComment, type ForumSort, type ModAction,
} from "@/lib/forum";
import { fetchForum } from "@/lib/forumSync";
import { Loading } from "@/components/Spinner";

// Relative "x ago".
function ago(ms: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`;
  return new Date(ms).toISOString().slice(0, 10);
}

const EMPTY_RAW: ForumRaw = { posts: [], comments: [], votes: [], mods: [] };

export default function ForumView() {
  const { address, isConnected } = useWallet();
  const isAdmin = address === ADMIN_ADDRESS;

  const [raw, setRaw] = useState<ForumRaw>(EMPTY_RAW);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<string>("all");
  const [sort, setSort] = useState<ForumSort>("hot");
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [name, setName] = useState("");
  const [nameOpen, setNameOpen] = useState(false);
  const [pendingAfterName, setPendingAfterName] = useState<(() => void) | null>(null);
  const [renaming, setRenaming] = useState<{ addr: string; name: string } | null>(null);

  useEffect(() => { setName(loadForumName()); }, []);

  const reload = useCallback(async () => {
    const data = await fetchForum();
    setRaw(data);
    setLoading(false);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const state: ForumState = useMemo(() => buildForumState(raw, address), [raw, address]);
  const activePost = activeId ? state.posts.find((p) => p.id === activeId) ?? null : null;

  const visiblePosts = useMemo(() => {
    let list = state.posts;
    if (category !== "all") list = list.filter((p) => p.category === category);
    list = searchPosts(list, query);
    return sortPosts(list, sort);
  }, [state.posts, category, query, sort]);

  // Optimistic insert so the UI updates instantly (Arweave indexing lags a few minutes); a delayed
  // reload reconciles with the chain.
  const optimistic = useCallback((patch: Partial<ForumRaw>) => {
    setRaw((r) => ({
      posts: [...(patch.posts ?? []), ...r.posts],
      comments: [...(patch.comments ?? []), ...r.comments],
      votes: [...(patch.votes ?? []), ...r.votes],
      mods: [...(patch.mods ?? []), ...r.mods],
    }));
    setTimeout(() => void reload(), 30_000);
  }, [reload]);

  const ensureName = (run: () => void) => {
    if (!isConnected) { setLoginOpen(true); return; }
    if (loadForumName().trim()) run();
    else { setPendingAfterName(() => run); setNameOpen(true); }
  };

  const submitPost = async (cat: string, title: string, body: string) => {
    const who = loadForumName();
    const id = await publishPost({ category: cat, title, body, name: who });
    optimistic({ posts: [{ txId: `local-${id}`, author: address!, b: { id, category: cat, title, body, at: Date.now(), name: who } }] });
    setComposing(false);
    setCategory(cat);
  };
  const submitComment = async (postId: string, parentId: string | undefined, body: string) => {
    const who = loadForumName();
    const id = await publishComment({ postId, parentId, body, name: who });
    optimistic({ comments: [{ txId: `local-${id}`, author: address!, b: { id, postId, parentId, body, at: Date.now(), name: who } }] });
  };
  const vote = (targetId: string, value: 1 | -1, current: 0 | 1 | -1) => {
    if (!isConnected) { setLoginOpen(true); return; }
    const next: 1 | -1 | 0 = current === value ? 0 : value; // click your current vote again → clear it
    void publishVote(targetId, next);
    optimistic({ votes: [{ txId: `local-v-${targetId}-${Date.now()}`, author: address!, b: { targetId, value: next, at: Date.now() } }] });
  };
  const mod = (action: ModAction, opts: { targetId?: string; targetAddr?: string; name?: string }) => {
    void publishMod({ action, ...opts });
    optimistic({ mods: [{ txId: `local-m-${Date.now()}`, author: address!, b: { action, ...opts, at: Date.now() } }] });
  };

  return (
    <div className="flex flex-col gap-4 md:flex-row">
      {/* Categories */}
      <aside className="md:w-52 md:shrink-0">
        <div className="flex gap-1.5 overflow-x-auto pb-1 md:flex-col md:overflow-visible">
          <CatBtn active={category === "all"} onClick={() => { setCategory("all"); setActiveId(null); }} label="All topics" />
          {CATEGORIES.map((c) => (
            <CatBtn key={c.id} active={category === c.id} onClick={() => { setCategory(c.id); setActiveId(null); }} label={c.label} />
          ))}
          {isAdmin && <CatBtn active={category === "blocked"} onClick={() => { setCategory("blocked"); setActiveId(null); }} label={`Blocked${state.blockedUsers.length ? ` (${state.blockedUsers.length})` : ""}`} />}
        </div>
        <button
          onClick={() => ensureName(() => setComposing(true))}
          className="mt-3 hidden w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 md:flex"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
          New topic
        </button>
      </aside>

      {/* Main column */}
      <main className="flex min-h-0 flex-1 flex-col">
        {isAdmin && category === "blocked" ? (
          <BlockedPanel users={state.blockedUsers} onUnblock={(addr) => mod("unblock", { targetAddr: addr })} />
        ) : activePost ? (
          <ThreadView
            post={activePost}
            comments={state.commentsByPost.get(activePost.id) ?? []}
            isAdmin={isAdmin}
            myAddress={address}
            onBack={() => setActiveId(null)}
            onVote={vote}
            onReply={(parentId, body) => ensureName(() => void submitComment(activePost.id, parentId, body))}
            onMod={mod}
            onRename={(addr, nm) => setRenaming({ addr, name: nm })}
          />
        ) : (
          <>
            {/* Toolbar */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="flex items-center rounded-lg border border-slate-700 bg-slate-800/60 p-0.5 text-xs">
                {(["hot", "new", "top"] as ForumSort[]).map((s) => (
                  <button key={s} onClick={() => setSort(s)} className={`rounded px-2.5 py-1 capitalize transition-colors ${sort === s ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"}`}>{s}</button>
                ))}
              </div>
              <div className="relative min-w-0 flex-1">
                <svg className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="M21 21l-4-4" /></svg>
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search topics…" className="w-full rounded-lg border border-slate-700 bg-slate-800/60 py-1.5 pl-8 pr-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none" />
              </div>
              <button onClick={() => ensureName(() => setComposing(true))} className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 md:hidden">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>New
              </button>
            </div>

            {/* List */}
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
              {loading && <Loading label="Loading the forum…" className="py-16" />}
              {!loading && visiblePosts.length === 0 && (
                <div className="py-16 text-center">
                  <p className="text-sm text-slate-400">No topics here yet.</p>
                  <button onClick={() => ensureName(() => setComposing(true))} className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Start the first one</button>
                </div>
              )}
              {visiblePosts.map((p) => (
                <PostRow key={p.id} post={p} onOpen={() => setActiveId(p.id)} onVote={vote} />
              ))}
            </div>
          </>
        )}
      </main>

      {composing && <Composer onClose={() => setComposing(false)} onSubmit={submitPost} initialCategory={category === "all" || category === "blocked" ? DEFAULT_CATEGORY : category} />}
      {nameOpen && (
        <NameModal
          title="Choose a display name"
          blurb="This is the only thing other people see on your forum posts — your wallet address stays hidden."
          initial={name}
          onClose={() => { setNameOpen(false); setPendingAfterName(null); }}
          onSave={(n) => { saveForumName(n); setName(n); setNameOpen(false); const run = pendingAfterName; setPendingAfterName(null); run?.(); }}
        />
      )}
      {renaming && (
        <NameModal
          title="Rename this user"
          blurb="Set the display name shown for this user across the forum (admin override)."
          initial={renaming.name}
          onClose={() => setRenaming(null)}
          onSave={(n) => { mod("rename", { targetAddr: renaming.addr, name: n }); setRenaming(null); }}
        />
      )}
      {loginOpen && <LoginModal onClose={() => setLoginOpen(false)} />}
    </div>
  );
}

function CatBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className={`shrink-0 rounded-lg px-3 py-1.5 text-left text-sm transition-colors md:w-full ${active ? "bg-indigo-500/15 font-medium text-indigo-200" : "text-slate-300 hover:bg-slate-800/60"}`}>{label}</button>
  );
}

function AdminTag() {
  return <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-rose-300 ring-1 ring-inset ring-rose-500/30">Admin</span>;
}

function Byline({ name, isAdmin, at, pinned }: { name: string; isAdmin: boolean; at: number; pinned?: boolean }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
      {pinned && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-300 ring-1 ring-inset ring-amber-500/30">Pinned</span>}
      <span className="font-medium text-slate-300">{name || "anon"}</span>
      {isAdmin && <AdminTag />}
      <span>· {ago(at)}</span>
    </span>
  );
}

function VoteControl({ score, myVote, onUp, onDown, row }: { score: number; myVote: 0 | 1 | -1; onUp: () => void; onDown: () => void; row?: boolean }) {
  return (
    <div className={`flex items-center ${row ? "flex-row gap-1.5" : "flex-col"} shrink-0`}>
      <button onClick={(e) => { e.stopPropagation(); onUp(); }} aria-label="Upvote" className={`rounded p-0.5 transition-colors ${myVote === 1 ? "text-indigo-400" : "text-slate-500 hover:text-slate-200"}`}>
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5M6 11l6-6 6 6" /></svg>
      </button>
      <span className={`text-xs font-semibold tabular-nums ${myVote === 1 ? "text-indigo-300" : myVote === -1 ? "text-rose-300" : "text-slate-400"}`}>{score}</span>
      <button onClick={(e) => { e.stopPropagation(); onDown(); }} aria-label="Downvote" className={`rounded p-0.5 transition-colors ${myVote === -1 ? "text-rose-400" : "text-slate-500 hover:text-slate-200"}`}>
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M6 13l6 6 6-6" /></svg>
      </button>
    </div>
  );
}

function PostRow({ post, onOpen, onVote }: { post: ForumPost; onOpen: () => void; onVote: (id: string, v: 1 | -1, cur: 0 | 1 | -1) => void }) {
  // A div (not a <button>) so the vote <button>s inside aren't nested buttons (invalid HTML).
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }} className="flex w-full cursor-pointer items-start gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-left transition-colors hover:border-slate-700">
      <VoteControl score={post.score} myVote={post.myVote} onUp={() => onVote(post.id, 1, post.myVote)} onDown={() => onVote(post.id, -1, post.myVote)} />
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center gap-2">
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">{categoryLabel(post.category)}</span>
          <Byline name={post.name} isAdmin={post.isAdmin} at={post.at} pinned={post.pinned} />
        </div>
        <h3 className="truncate text-sm font-semibold text-slate-100">{post.title || "(untitled)"}</h3>
        {post.body && <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-xs text-slate-400">{post.body}</p>}
        <p className="mt-1 text-[11px] text-slate-500">{post.commentCount} {post.commentCount === 1 ? "comment" : "comments"}</p>
      </div>
    </div>
  );
}

function ThreadView({ post, comments, isAdmin, myAddress, onBack, onVote, onReply, onMod, onRename }: {
  post: ForumPost; comments: ForumComment[]; isAdmin: boolean; myAddress: string | null;
  onBack: () => void; onVote: (id: string, v: 1 | -1, cur: 0 | 1 | -1) => void;
  onReply: (parentId: string | undefined, body: string) => void;
  onMod: (action: ModAction, opts: { targetId?: string; targetAddr?: string; name?: string }) => void;
  onRename: (addr: string, name: string) => void;
}) {
  const [reply, setReply] = useState("");
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" /></svg>
        All topics
      </button>

      <article className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex items-start gap-3">
          <VoteControl score={post.score} myVote={post.myVote} onUp={() => onVote(post.id, 1, post.myVote)} onDown={() => onVote(post.id, -1, post.myVote)} />
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">{categoryLabel(post.category)}</span>
              <Byline name={post.name} isAdmin={post.isAdmin} at={post.at} pinned={post.pinned} />
              {isAdmin && <AdminMenu onMod={onMod} onRename={onRename} targetId={post.id} targetAddr={post.author} name={post.name} pinned={post.pinned} isPost />}
            </div>
            <h1 className="text-lg font-bold text-white">{post.title || "(untitled)"}</h1>
            {post.body && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{post.body}</p>}
          </div>
        </div>
      </article>

      {/* Reply box */}
      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/40 p-3">
        <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3} placeholder="Add a comment…" className="w-full resize-y rounded-lg border border-slate-700 bg-slate-800/60 p-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none" />
        <div className="mt-2 flex justify-end">
          <button disabled={!reply.trim()} onClick={() => { onReply(undefined, reply.trim()); setReply(""); }} className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50">Comment</button>
        </div>
      </div>

      {/* Comments */}
      <div className="mt-4 space-y-3">
        <p className="text-xs font-medium text-slate-500">{post.commentCount} {post.commentCount === 1 ? "comment" : "comments"}</p>
        {comments.map((c) => (
          <CommentNode key={c.id} comment={c} depth={0} isAdmin={isAdmin} onVote={onVote} onReply={onReply} onMod={onMod} onRename={onRename} />
        ))}
      </div>
    </div>
  );
}

function CommentNode({ comment, depth, isAdmin, onVote, onReply, onMod, onRename }: {
  comment: ForumComment; depth: number; isAdmin: boolean;
  onVote: (id: string, v: 1 | -1, cur: 0 | 1 | -1) => void;
  onReply: (parentId: string | undefined, body: string) => void;
  onMod: (action: ModAction, opts: { targetId?: string; targetAddr?: string; name?: string }) => void;
  onRename: (addr: string, name: string) => void;
}) {
  const [replying, setReplying] = useState(false);
  const [body, setBody] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className={depth > 0 ? "border-l border-slate-800 pl-3" : ""}>
      <div className="rounded-lg bg-slate-900/40 p-2.5">
        <div className="flex items-center gap-2">
          <button onClick={() => setCollapsed((v) => !v)} className="text-slate-600 hover:text-slate-300" aria-label={collapsed ? "Expand" : "Collapse"}>
            <svg className={`h-3 w-3 transition-transform ${collapsed ? "-rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" /></svg>
          </button>
          <Byline name={comment.name} isAdmin={comment.isAdmin} at={comment.at} />
          {isAdmin && <AdminMenu onMod={onMod} onRename={onRename} targetId={comment.id} targetAddr={comment.author} name={comment.name} />}
        </div>
        {!collapsed && (
          <>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-300">{comment.body}</p>
            <div className="mt-1.5 flex items-center gap-3">
              <VoteControl row score={comment.score} myVote={comment.myVote} onUp={() => onVote(comment.id, 1, comment.myVote)} onDown={() => onVote(comment.id, -1, comment.myVote)} />
              <button onClick={() => setReplying((v) => !v)} className="text-[11px] font-medium text-slate-500 hover:text-slate-200">Reply</button>
            </div>
            {replying && (
              <div className="mt-2">
                <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="Reply…" className="w-full resize-y rounded-lg border border-slate-700 bg-slate-800/60 p-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none" />
                <div className="mt-1.5 flex justify-end gap-2">
                  <button onClick={() => { setReplying(false); setBody(""); }} className="rounded-lg px-3 py-1 text-[11px] text-slate-400 hover:text-white">Cancel</button>
                  <button disabled={!body.trim()} onClick={() => { onReply(comment.id, body.trim()); setBody(""); setReplying(false); }} className="rounded-lg bg-indigo-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-indigo-500 disabled:opacity-50">Reply</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {!collapsed && comment.children.length > 0 && (
        <div className="mt-2 space-y-2">
          {comment.children.map((ch) => (
            <CommentNode key={ch.id} comment={ch} depth={depth + 1} isAdmin={isAdmin} onVote={onVote} onReply={onReply} onMod={onMod} onRename={onRename} />
          ))}
        </div>
      )}
    </div>
  );
}

function AdminMenu({ onMod, onRename, targetId, targetAddr, name, pinned, isPost }: { onMod: (action: ModAction, opts: { targetId?: string; targetAddr?: string; name?: string }) => void; onRename: (addr: string, name: string) => void; targetId: string; targetAddr: string; name: string; pinned?: boolean; isPost?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200" aria-label="Moderate">
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-lg border border-slate-700 bg-slate-900 py-1 text-xs shadow-2xl">
          <MItem onClick={() => { onMod("hide", { targetId }); setOpen(false); }}>Hide</MItem>
          <MItem onClick={() => { onMod("delete", { targetId }); setOpen(false); }}>Delete</MItem>
          {isPost && <MItem onClick={() => { onMod(pinned ? "unpin" : "pin", { targetId }); setOpen(false); }}>{pinned ? "Unpin" : "Pin"}</MItem>}
          <MItem onClick={() => { onRename(targetAddr, name); setOpen(false); }}>Rename user…</MItem>
          <MItem danger onClick={() => { onMod("block", { targetAddr }); setOpen(false); }}>Block user</MItem>
        </div>
      )}
    </div>
  );
}
function MItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return <button onClick={onClick} className={`block w-full px-3 py-1.5 text-left hover:bg-slate-800 ${danger ? "text-rose-300" : "text-slate-300"}`}>{children}</button>;
}

function Composer({ onClose, onSubmit, initialCategory }: { onClose: () => void; onSubmit: (cat: string, title: string, body: string) => Promise<void>; initialCategory: string }) {
  const [cat, setCat] = useState(initialCategory);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true); setErr(null);
    try { await onSubmit(cat, title.trim(), body.trim()); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't post."); setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div onMouseDown={(e) => e.stopPropagation()} className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-white">New topic</h2>
          <button onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-200"><svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>
        <div className="space-y-3 overflow-y-auto p-5">
          <select value={cat} onChange={(e) => setCat(e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none">
            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none" />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} placeholder="Description (optional)" className="w-full resize-y rounded-lg border border-slate-700 bg-slate-800/60 p-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none" />
          {err && <p className="text-[11px] text-rose-300">{err}</p>}
          <p className="text-[10px] leading-relaxed text-slate-600">Posts are public and permanent on Arweave. Only your display name is shown — never your wallet address.</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-800 px-5 py-3">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button>
          <button disabled={busy || !title.trim()} onClick={submit} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">{busy ? "Posting…" : "Post"}</button>
        </div>
      </div>
    </div>
  );
}

function NameModal({ initial, title, blurb, onClose, onSave }: { initial: string; title: string; blurb: string; onClose: () => void; onSave: (name: string) => void }) {
  const [v, setV] = useState(initial);
  return (
    <div className="fixed inset-0 z-[125] flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div onMouseDown={(e) => e.stopPropagation()} className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        <p className="mt-1 text-xs text-slate-400">{blurb}</p>
        <input autoFocus value={v} onChange={(e) => setV(e.target.value)} maxLength={40} placeholder="e.g. ada_lovelace" className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none" />
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs text-slate-400 hover:text-white">Cancel</button>
          <button disabled={!v.trim()} onClick={() => onSave(v.trim())} className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50">Save</button>
        </div>
      </div>
    </div>
  );
}

// Admin-only panel listing blocked users with an Unblock action (so a mistaken block can be undone).
function BlockedPanel({ users, onUnblock }: { users: { address: string; name: string }[]; onUnblock: (addr: string) => void }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <h2 className="mb-3 text-sm font-semibold text-white">Blocked users</h2>
      {users.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-500">No blocked users.</p>
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.address} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
              <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{u.name}</span>
              <button onClick={() => onUnblock(u.address)} className="shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700">Unblock</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
