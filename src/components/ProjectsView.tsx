"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@/context/WalletContext";
import { fetchPublicProjects, publishMod, publishReport, ADMIN_ADDRESS, SOCIAL_KINDS, type PublicProject, type SnapProject, type SocialKind } from "@/lib/depm";
import { SocialIcon, WebsiteIcon, WhitepaperIcon } from "./SocialIcons";
import { PublicImg } from "./PublicImg";
import { ThemedSelect } from "./BoardDropdowns";
import { BarChart } from "./DashboardCharts";
import { Donut } from "./Donut";
import { colorAt } from "@/lib/dashboard";
import { Loading } from "@/components/Spinner";

function ago(ms: number): string {
  if (!ms) return "";
  const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`;
  return new Date(ms).toISOString().slice(0, 10);
}

type Sort = "recent" | "progress" | "name";
type Toast = (m: string, t?: "error" | "info" | "warning") => void;

function Logo({ p, size }: { p: PublicProject; size: string }) {
  if (p.logo?.txId) {
    return <PublicImg txId={p.logo.txId} alt={p.company} className={`${size} shrink-0 rounded-xl border border-slate-700 object-cover`} />;
  }
  return <span className={`${size} grid shrink-0 place-items-center rounded-xl bg-indigo-500/15 font-bold text-indigo-300`}>{p.company.slice(0, 1).toUpperCase()}</span>;
}

export default function ProjectsView() {
  const { address } = useWallet();
  const [note, setNote] = useState<{ msg: string; kind: "error" | "info" | "warning" } | null>(null);
  const toast: Toast = (msg, kind = "info") => { setNote({ msg, kind }); window.setTimeout(() => setNote(null), 3500); };
  const isAdmin = address === ADMIN_ADDRESS;
  const [projects, setProjects] = useState<PublicProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [cat, setCat] = useState("");
  const [team, setTeam] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [showFilter, setShowFilter] = useState(false);
  const [mod, setMod] = useState(false); // admin moderation view
  const [openKey, setOpenKey] = useState<string | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const didDeepLink = useRef(false);

  const load = (spin: boolean) => {
    if (spin) setRefreshing(true);
    fetchPublicProjects({ includeHidden: isAdmin }).then(setProjects).catch(() => setProjects([])).finally(() => { setLoading(false); setRefreshing(false); });
  };
  useEffect(() => { load(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [isAdmin]);

  // Deep link: /projects?b=<boardId> opens that board's page directly (the shareable company link).
  useEffect(() => {
    if (didDeepLink.current || projects.length === 0) return;
    const b = new URLSearchParams(window.location.search).get("b");
    if (!b) { didDeepLink.current = true; return; }
    const p = projects.find((x) => x.boardId === b);
    if (p) { setOpenKey(p.key); didDeepLink.current = true; }
  }, [projects]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setShowFilter(false);
    };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, []);

  const remove = (p: PublicProject) => {
    if (!confirm(`Remove "${p.company}" from the public DePM page? (admin action — fake/spam)`)) return;
    void publishMod("hide", p.key).then(() => toast("Removed from the public page.", "info")).catch(() => toast("Couldn't remove.", "error"));
    setProjects((list) => list.map((x) => x.key === p.key ? { ...x, hidden: true } : x));
    setOpenKey(null);
  };
  const restore = (p: PublicProject) => {
    void publishMod("unhide", p.key).then(() => toast("Restored to the public page.", "info")).catch(() => toast("Couldn't restore.", "error"));
    setProjects((list) => list.map((x) => x.key === p.key ? { ...x, hidden: false } : x));
  };
  const share = async (p: PublicProject) => {
    const url = `${window.location.origin}/projects?b=${encodeURIComponent(p.boardId)}`;
    try {
      if (navigator.share) await navigator.share({ title: `${p.company} on TrustVault`, url });
      else { await navigator.clipboard.writeText(url); toast("Link copied to clipboard.", "info"); }
    } catch { /* share sheet dismissed */ }
  };
  const report = (p: PublicProject) => {
    if (!address) { toast("Connect a wallet to report.", "warning"); return; }
    const reason = window.prompt(`Report "${p.company}" as fake or spam? Add a short reason (optional):`);
    if (reason === null) return;
    void publishReport(p.key, reason).then(() => toast("Report submitted — thanks. An admin will review it.", "info")).catch(() => toast("Couldn't submit the report.", "error"));
    setProjects((list) => list.map((x) => x.key === p.key ? { ...x, reports: [...(x.reports ?? []).filter((r) => r.by !== address), { by: address, reason, at: Date.now() }] } : x));
  };

  const categories = useMemo(() => [...new Set(projects.filter((p) => !p.hidden).map((p) => p.category).filter(Boolean))].sort() as string[], [projects]);
  const teams = useMemo(() => [...new Set(projects.filter((p) => !p.hidden).map((p) => p.employees).filter(Boolean))] as string[], [projects]);
  const activeFilters = (cat ? 1 : 0) + (team ? 1 : 0) + (sort !== "recent" ? 1 : 0);
  const flaggedCount = useMemo(() => projects.filter((p) => p.hidden || (p.reports?.length ?? 0) > 0).length, [projects]);

  const matches = (p: PublicProject, needle: string) => {
    if (!needle) return true;
    const hay = [p.company, p.tagline, p.description, p.category, p.location, ...p.projects.map((x) => x.name)].join(" ").toLowerCase();
    return hay.includes(needle);
  };

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = projects.filter((p) => !p.hidden && (!cat || p.category === cat) && (!team || p.employees === team) && matches(p, needle));
    if (sort === "name") list.sort((a, b) => a.company.localeCompare(b.company));
    else if (sort === "progress") list.sort((a, b) => (b.total ? b.done / b.total : 0) - (a.total ? a.done / a.total : 0));
    else list.sort((a, b) => b.updatedAt - a.updatedAt);
    return list;
  }, [projects, q, cat, team, sort]);

  const suggestions = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return projects.filter((p) => !p.hidden && matches(p, needle)).slice(0, 8);
  }, [projects, q]);

  const moderationList = useMemo(() => projects.filter((p) => p.hidden || (p.reports?.length ?? 0) > 0)
    .sort((a, b) => (b.reports?.length ?? 0) - (a.reports?.length ?? 0)), [projects]);

  const open = openKey ? projects.find((p) => p.key === openKey) ?? null : null;
  if (open) return (<><Toaster note={note} /><ProjectDetail p={open} isAdmin={isAdmin} canReport={!!address} onRemove={() => remove(open)} onRestore={() => restore(open)} onReport={() => report(open)} onShare={() => share(open)} onBack={() => setOpenKey(null)} /></>);

  return (
    <div>
      <Toaster note={note} />
      <div className="mb-2">
        <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-indigo-300">DePM · Decentralized Project Management</span>
        <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">Public projects</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
          Real, on-chain progress from teams building on TrustVault — not marketing. Each project chose to make a board public
          so anyone can see what they&apos;re actually shipping. Boards stay encrypted unless their owner opts in.
        </p>
      </div>

      {/* controls — search left, refresh + filter (+ admin moderation) pinned right */}
      <div className="mb-5 mt-4 flex items-center gap-2">
        <div ref={searchRef} className="relative">
          <svg className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="M21 21l-4-4" /></svg>
          <input value={q} onFocus={() => setSearchOpen(true)} onChange={(e) => { setQ(e.target.value); setSearchOpen(true); }} placeholder="Search projects…" className="w-52 rounded-lg border border-slate-700 bg-slate-900 py-2 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none sm:w-72" />
          {searchOpen && suggestions.length > 0 && (
            <div className="absolute left-0 z-40 mt-1 w-[24rem] max-w-[90vw] overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
              {suggestions.map((p) => {
                const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
                return (
                  <button key={p.key} onClick={() => { setOpenKey(p.key); setSearchOpen(false); }} className="flex w-full items-start gap-3 border-b border-slate-800 px-3 py-2.5 text-left last:border-0 hover:bg-slate-800/60">
                    <Logo p={p} size="h-9 w-9 text-sm" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5"><span className="truncate text-sm font-medium text-slate-100">{p.company}</span>{p.category && <span className="shrink-0 rounded-full bg-slate-800 px-1.5 py-0.5 text-[9px] text-slate-400">{p.category}</span>}</span>
                      {p.tagline && <span className="mt-0.5 block truncate text-[11px] text-slate-500">{p.tagline}</span>}
                      <span className="mt-0.5 block text-[10px] text-slate-600">{p.done}/{p.total} done · {pct}% · {p.projects.length} project{p.projects.length === 1 ? "" : "s"}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {isAdmin && (
            <button onClick={() => setMod((v) => !v)} title="Moderation — reported & hidden boards" aria-label="Moderation" className={`relative flex items-center justify-center rounded-lg border px-2.5 py-2 transition-colors ${mod ? "border-amber-500 bg-amber-500/15 text-amber-200" : "border-slate-700 bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200"}`}>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3z" /></svg>
              {flaggedCount > 0 && <span className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-slate-900">{flaggedCount}</span>}
            </button>
          )}
          <button onClick={() => load(true)} disabled={refreshing} title="Refresh from Arweave" aria-label="Refresh" className="flex items-center justify-center rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:opacity-60">
            <svg className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M5 9a8 8 0 0113-3M19 15a8 8 0 01-13 3" /></svg>
          </button>
          <div ref={filterRef} className="relative">
            <button onClick={() => setShowFilter((v) => !v)} title="Filter" aria-label="Filter" className={`relative flex items-center justify-center rounded-lg border px-2.5 py-2 transition-colors ${activeFilters || showFilter ? "border-indigo-500 bg-indigo-500/15 text-indigo-200" : "border-slate-700 bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200"}`}>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 20 20" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M2 5h16M5 10h10M8 15h4" /></svg>
              {activeFilters > 0 && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-indigo-400" />}
            </button>
            {showFilter && (
              <div className="absolute right-0 z-40 mt-1 w-64 space-y-3 rounded-xl border border-slate-700 bg-slate-900 p-3 shadow-2xl">
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Category</p>
                  <ThemedSelect value={cat} onChange={setCat} options={[{ value: "", label: "All categories" }, ...categories.map((c) => ({ value: c, label: c }))]} />
                </div>
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Team size</p>
                  <ThemedSelect value={team} onChange={setTeam} options={[{ value: "", label: "Any team size" }, ...teams.map((t) => ({ value: t, label: t }))]} />
                </div>
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Sort by</p>
                  <ThemedSelect value={sort} onChange={(v) => setSort(v as Sort)} options={[{ value: "recent", label: "Recently updated" }, { value: "progress", label: "Most progress" }, { value: "name", label: "Name A–Z" }]} />
                </div>
                <button onClick={() => { setCat(""); setTeam(""); setSort("recent"); }} disabled={activeFilters === 0} className="w-full rounded-lg border border-slate-700 px-2 py-1.5 text-[11px] font-medium text-slate-300 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-40">Reset filters</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {mod ? (
        <Moderation list={moderationList} onOpen={(p) => setOpenKey(p.key)} onRemove={remove} onRestore={restore} />
      ) : loading ? (
        <Loading label="Loading public projects…" className="py-16" />
      ) : shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-10 text-center">
          <p className="text-sm font-medium text-slate-300">{projects.length === 0 ? "No public projects yet." : "No projects match your search or filters."}</p>
          {projects.length === 0 && <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-slate-500">Project owners can publish a board from <strong className="text-slate-300">Board → ⚙ Settings → DePM</strong>.</p>}
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {shown.map((p) => <ProjectCard key={p.key} p={p} onOpen={() => setOpenKey(p.key)} onShare={() => share(p)} />)}
        </div>
      )}

      <p className="mt-6 rounded-xl border border-amber-800/40 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-200/90">
        Public info is self-published by each project and is <strong>not verified or endorsed</strong> by TrustVault. Do your own
        research before trusting or supporting any project. This is not financial advice.
      </p>
    </div>
  );
}

function Toaster({ note }: { note: { msg: string; kind: "error" | "info" | "warning" } | null }) {
  if (!note) return null;
  const tone = note.kind === "error" ? "border-rose-700/50 text-rose-200" : note.kind === "warning" ? "border-amber-700/50 text-amber-200" : "border-slate-700 text-slate-200";
  return (
    <div className={`fixed bottom-5 left-1/2 z-[200] -translate-x-1/2 rounded-lg border ${tone} bg-slate-900/95 px-4 py-2 text-xs shadow-2xl`}>{note.msg}</div>
  );
}

function Moderation({ list, onOpen, onRemove, onRestore }: { list: PublicProject[]; onOpen: (p: PublicProject) => void; onRemove: (p: PublicProject) => void; onRestore: (p: PublicProject) => void }) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-800/40 bg-amber-500/10 p-3 text-xs text-amber-200/90">
        <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3z" /></svg>
        Admin moderation — boards users reported as fake/spam, and ones you&apos;ve removed. Restore puts a removed board back; Remove takes a fake one down.
      </div>
      {list.length === 0 ? (
        <p className="py-16 text-center text-sm text-slate-500">No reported or removed boards. 🎉</p>
      ) : (
        <div className="space-y-3">
          {list.map((p) => (
            <article key={p.key} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <Logo p={p} size="h-10 w-10 text-base" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-white">{p.company}</span>
                      {p.hidden && <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-medium text-rose-300 ring-1 ring-inset ring-rose-500/30">Removed</span>}
                      {(p.reports?.length ?? 0) > 0 && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300 ring-1 ring-inset ring-amber-500/30">{p.reports!.length} report{p.reports!.length === 1 ? "" : "s"}</span>}
                    </div>
                    {p.tagline && <p className="mt-0.5 truncate text-xs text-slate-500">{p.tagline}</p>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => onOpen(p)} className="rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:bg-slate-800">Open</button>
                  {p.hidden
                    ? <button onClick={() => onRestore(p)} className="rounded-lg border border-emerald-700/50 px-2.5 py-1 text-[11px] font-medium text-emerald-300 hover:bg-slate-800">Restore</button>
                    : <button onClick={() => onRemove(p)} className="rounded-lg border border-rose-700/50 px-2.5 py-1 text-[11px] font-medium text-rose-300 hover:bg-slate-800">Remove</button>}
                </div>
              </div>
              {(p.reports?.length ?? 0) > 0 && (
                <ul className="mt-2 space-y-1 border-t border-slate-800 pt-2">
                  {p.reports!.slice(0, 5).map((r, i) => (
                    <li key={i} className="text-[11px] text-slate-400"><span className="text-slate-600">{ago(r.at)}:</span> {r.reason || <span className="italic text-slate-600">no reason given</span>}</li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function metaBits(p: PublicProject): string[] {
  return [p.category, p.employees && `${p.employees} team`, p.founded && `est. ${p.founded}`, p.location].filter(Boolean) as string[];
}

function ShareIcon() {
  return <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.7 10.7l6.6-3.4M8.7 13.3l6.6 3.4M18 8a3 3 0 10-3-3 3 3 0 003 3zM6 15a3 3 0 10-3-3 3 3 0 003 3zm12 7a3 3 0 10-3-3 3 3 0 003 3z" /></svg>;
}

function ProjectCard({ p, onOpen, onShare }: { p: PublicProject; onOpen: () => void; onShare: () => void }) {
  const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
  const meta = metaBits(p);
  return (
    <article className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex items-start gap-3">
        <Logo p={p} size="h-12 w-12 text-lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold text-white">{p.company}</h2>
            {p.category && <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-300">{p.category}</span>}
          </div>
          {p.tagline && <p className="mt-0.5 text-sm font-medium text-slate-300">{p.tagline}</p>}
        </div>
      </div>
      {p.description && <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-400">{p.description}</p>}
      {meta.length > 0 && <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">{meta.map((m, i) => <span key={i}>{m}</span>)}</div>}
      <LinkIcons p={p} />
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500"><span>Overall progress</span><span className="tabular-nums">{p.done}/{p.total} done · {pct}%</span></div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <span className="text-[11px] text-slate-600">{p.projects.length} public project{p.projects.length === 1 ? "" : "s"} · updated {ago(p.updatedAt)}</span>
        <div className="flex items-center gap-2">
          <button onClick={onShare} title="Share this project" aria-label="Share" className="flex items-center justify-center rounded-lg border border-slate-700 px-2 py-1.5 text-slate-400 hover:bg-slate-800 hover:text-indigo-300"><ShareIcon /></button>
          <button onClick={onOpen} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-indigo-300 hover:bg-slate-800">View details →</button>
        </div>
      </div>
    </article>
  );
}

// Full-page board view (replaces the grid). Project dropdown switches the visible project; charts +
// columns reflect the selection.
function ProjectDetail({ p, isAdmin, canReport, onRemove, onRestore, onReport, onShare, onBack }: {
  p: PublicProject; isAdmin: boolean; canReport: boolean;
  onRemove: () => void; onRestore: () => void; onReport: () => void; onShare: () => void; onBack: () => void;
}) {
  const [sel, setSel] = useState("__all__");
  const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
  const meta = metaBits(p);
  const visible = sel === "__all__" ? p.projects : p.projects.filter((x) => x.name === sel);
  const opts = [{ value: "__all__", label: `All projects (${p.projects.length})` }, ...p.projects.map((x) => ({ value: x.name, label: x.name }))];

  return (
    <div>
      <button onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-200">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" /></svg>
        Back to all projects
      </button>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-4">
            <Logo p={p} size="h-16 w-16 text-2xl" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-extrabold tracking-tight text-white">{p.company}</h1>
                {p.category && <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-300">{p.category}</span>}
                {p.hidden && <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-medium text-rose-300 ring-1 ring-inset ring-rose-500/30">Removed</span>}
              </div>
              {p.tagline && <p className="mt-1 text-sm font-medium text-slate-300">{p.tagline}</p>}
              {meta.length > 0 && <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">{meta.map((m, i) => <span key={i}>{m}</span>)}</div>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button onClick={onShare} title="Share this project" aria-label="Share" className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:bg-slate-800 hover:text-indigo-300"><ShareIcon />Share</button>
            {canReport && <button onClick={onReport} title="Report as fake/spam" className="rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-400 hover:bg-slate-800 hover:text-amber-300">Report</button>}
            {isAdmin && (p.hidden
              ? <button onClick={onRestore} className="rounded-lg border border-emerald-700/50 px-2.5 py-1 text-[11px] font-medium text-emerald-300 hover:bg-slate-800">Restore</button>
              : <button onClick={onRemove} className="rounded-lg border border-rose-700/50 px-2.5 py-1 text-[11px] font-medium text-rose-300 hover:bg-slate-800">Remove</button>)}
          </div>
        </div>

        {p.description && <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{p.description}</p>}
        <LinkIcons p={p} big />

        <div className="mt-5 max-w-md">
          <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500"><span>Overall progress</span><span className="tabular-nums">{p.done}/{p.total} done · {pct}%</span></div>
          <div className="h-2.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
        </div>
      </div>

      <div className="mt-5 mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-200">Insights</h2>
        {p.projects.length > 1 && <div className="w-56"><ThemedSelect value={sel} onChange={setSel} options={opts} /></div>}
      </div>
      <BoardCharts projects={visible} />

      <h2 className="mt-6 mb-3 text-sm font-semibold text-slate-200">Projects</h2>
      <div className="space-y-6 pb-6">
        {visible.map((proj) => <ProjectColumns key={proj.name} proj={proj} full />)}
        {visible.length === 0 && <p className="text-sm text-slate-500">No projects to show.</p>}
      </div>
      <p className="pb-6 text-[10px] text-slate-600">Updated {ago(p.updatedAt)}</p>
    </div>
  );
}

// Dashboard-style charts computed from the snapshot columns: status mix (donut) + tickets-per-column (bar).
function BoardCharts({ projects }: { projects: SnapProject[] }) {
  const done = projects.reduce((n, p) => n + p.done, 0);
  const total = projects.reduce((n, p) => n + p.total, 0);
  const open = Math.max(0, total - done);

  // tickets per column, merged by column label across the visible projects
  const byCol = new Map<string, number>();
  for (const p of projects) for (const c of p.columns) byCol.set(c.label, (byCol.get(c.label) ?? 0) + c.count);
  const colSeries = [...byCol.entries()].map(([label, value], i) => ({ label, value, color: colorAt(i) }));

  const donut = total > 0
    ? [
        { label: "Done", pct: Math.round((done / total) * 100), color: "#34d399" },
        { label: "In progress", pct: 100 - Math.round((done / total) * 100), color: "#64748b" },
      ]
    : [];

  if (total === 0 && colSeries.every((s) => s.value === 0)) {
    return <p className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 text-center text-xs text-slate-500">No tickets yet to chart.</p>;
  }

  return (
    <div className="grid items-stretch gap-4 md:grid-cols-2">
      <div className="flex h-64 flex-col rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <p className="mb-3 text-xs font-medium text-slate-400">Status mix</p>
        <div className="flex flex-1 items-center justify-center gap-5">
          {donut.length > 0 ? <Donut items={donut} size={130} /> : <p className="text-xs text-slate-600">No data</p>}
          <ul className="space-y-1.5 text-xs">
            <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "#34d399" }} />Done <span className="tabular-nums text-slate-500">{done}</span></li>
            <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "#64748b" }} />In progress <span className="tabular-nums text-slate-500">{open}</span></li>
            <li className="pt-1 text-[11px] text-slate-600">{total} tickets total</li>
          </ul>
        </div>
      </div>
      {/* h-64 gives a definite height so BarChart (flex-1) fills it — the Y axis + bars use the whole div */}
      <div className="flex h-64 flex-col rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <p className="mb-3 text-xs font-medium text-slate-400">Tickets by column</p>
        <BarChart series={colSeries} />
      </div>
    </div>
  );
}

function LinkIcons({ p, big }: { p: PublicProject; big?: boolean }) {
  const links: { key: string; url: string; title: string; icon: React.ReactNode }[] = [];
  if (p.website) links.push({ key: "web", url: p.website, title: "Website", icon: <WebsiteIcon /> });
  const wp = p.whitepaperFile?.txId ? `https://arweave.net/${p.whitepaperFile.txId}` : p.whitepaper;
  if (wp) links.push({ key: "wp", url: wp, title: "Whitepaper", icon: <WhitepaperIcon /> });
  for (const { kind, label } of SOCIAL_KINDS) {
    const url = p.socials?.[kind as SocialKind];
    if (url) links.push({ key: kind, url, title: label, icon: <SocialIcon kind={kind as SocialKind} /> });
  }
  if (links.length === 0) return null;
  const sz = big ? "h-9 w-9" : "h-8 w-8";
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      {links.map((l) => {
        const href = l.key === "email" ? (l.url.startsWith("mailto:") ? l.url : `mailto:${l.url}`) : (/^https?:\/\//.test(l.url) ? l.url : `https://${l.url}`);
        return (
          <a key={l.key} href={href} target="_blank" rel="noopener noreferrer" title={l.title} aria-label={l.title}
            className={`grid ${sz} place-items-center rounded-lg border border-slate-700 bg-slate-800/60 text-slate-400 transition-colors hover:border-indigo-500/50 hover:text-indigo-300`}>
            {l.icon}
          </a>
        );
      })}
    </div>
  );
}

function ProjectColumns({ proj, full }: { proj: SnapProject; full?: boolean }) {
  const pct = proj.total > 0 ? Math.round((proj.done / proj.total) * 100) : 0;
  const cap = full ? 40 : 6;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="truncate text-sm font-semibold text-slate-200">{proj.name}</p>
        <span className="shrink-0 text-[10px] tabular-nums text-slate-500">{proj.done}/{proj.total} · {pct}%</span>
      </div>
      {proj.description && <p className="mb-2 whitespace-pre-wrap text-[11px] leading-relaxed text-slate-500">{proj.description}</p>}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {proj.columns.map((c) => (
          <div key={c.label} className={`w-44 shrink-0 rounded-lg border p-2.5 ${c.done ? "border-emerald-800/40 bg-emerald-500/5" : "border-slate-800 bg-slate-900/40"}`}>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="truncate text-[11px] font-medium text-slate-300">{c.label}</span>
              <span className="shrink-0 rounded bg-slate-800 px-1.5 text-[10px] tabular-nums text-slate-400">{c.count}</span>
            </div>
            <ul className="space-y-1">
              {c.tickets.slice(0, cap).map((t, i) => (
                <li key={i} className="truncate rounded bg-slate-800/60 px-2 py-1 text-[11px] text-slate-300" title={t.title}>{t.title}</li>
              ))}
              {c.count > cap && <li className="px-2 text-[10px] text-slate-500">+{c.count - cap} more</li>}
              {c.count === 0 && <li className="px-2 text-[10px] text-slate-600">—</li>}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
