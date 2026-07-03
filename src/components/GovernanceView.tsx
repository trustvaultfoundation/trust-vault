"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/context/WalletContext";
import { LoginModal } from "@/components/LoginModal";
import { Donate } from "@/components/Donate";
import { DonorLeaderboard } from "@/components/DonorLeaderboard";
import { ADMIN_ADDRESS, fetchDao, buildDaoState, publishProposal, publishVote, publishMod, type DaoRaw, type ProposalResult } from "@/lib/dao";
import { Loading } from "@/components/Spinner";

const EMPTY_RAW: DaoRaw = { proposals: [], votes: [], mods: [] };

export default function GovernanceView() {
  const { address, isConnected } = useWallet();
  const isAdmin = address === ADMIN_ADDRESS;

  const [raw, setRaw] = useState<DaoRaw>(EMPTY_RAW);
  const [loading, setLoading] = useState(true);
  const [loginOpen, setLoginOpen] = useState(false);
  const [composing, setComposing] = useState(false);

  const reload = useCallback(async () => { setRaw(await fetchDao()); setLoading(false); }, []);
  useEffect(() => { void reload(); }, [reload]);

  const proposals = useMemo(() => buildDaoState(raw, address), [raw, address]);

  const optimistic = useCallback((patch: Partial<DaoRaw>) => {
    setRaw((r) => ({ proposals: [...(patch.proposals ?? []), ...r.proposals], votes: [...(patch.votes ?? []), ...r.votes], mods: [...(patch.mods ?? []), ...r.mods] }));
    setTimeout(() => void reload(), 30_000);
  }, [reload]);

  const castVote = async (proposalId: string, option: string) => {
    if (!isConnected || !address) { setLoginOpen(true); return; }
    await publishVote(proposalId, option);
    optimistic({ votes: [{ txId: `local-v-${Date.now()}`, author: address, b: { proposalId, option, at: Date.now() } }] });
  };
  const adminMod = async (action: "delete" | "close", proposalId: string) => {
    if (!isAdmin) return;
    if (action === "delete" && !confirm("Delete this proposal? It will be hidden for everyone.")) return;
    await publishMod(action, proposalId);
    optimistic({ mods: [{ author: address!, b: { action, proposalId, at: Date.now() } }] });
  };

  return (
    <div>
      {/* Hero */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-indigo-300">Governance</span>
        <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">Shape TrustVault together</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          TrustVault is community-steered and <strong className="text-slate-200">entirely free</strong>. Governance is simple:{" "}
          <strong className="text-slate-200">one wallet, one vote</strong> — no token, no gas, no cost. Anyone connected can vote on
          proposals; the team posts them. Read the <Link href="/whitepaper" className="text-indigo-300 hover:underline">whitepaper</Link> for the full picture.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Explainer title="One wallet, one vote" body="Every connected wallet counts exactly once per proposal — no holdings, no weighting." />
          <Explainer title="Free & on-chain" body="Proposals and votes are signed records on Arweave. There's nothing to buy and no gas to vote." />
          <Explainer title="Open to everyone" body="The team posts proposals; the community decides. Change your vote any time before it closes." />
        </div>
      </section>

      {/* Support — each its own full-width line */}
      <section className="mt-5 space-y-4">
        <Donate />
        <DonorLeaderboard />
      </section>

      {/* Proposals */}
      <section className="mt-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Proposals</h2>
          {isAdmin && (
            <button onClick={() => setComposing(true)} className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>New proposal
            </button>
          )}
        </div>

        {loading ? (
          <Loading label="Loading proposals…" className="py-12" />
        ) : proposals.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center">
            <p className="text-sm font-medium text-slate-300">No proposals yet.</p>
            <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-slate-500">{isAdmin ? "Create the first proposal with the button above." : "Check back soon — the team will post proposals here for the community to vote on."}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {proposals.map((p) => (
              <ProposalCard key={p.id} p={p} isAdmin={isAdmin} onVote={(opt) => void castVote(p.id, opt)} canVote={isConnected} onConnect={() => setLoginOpen(true)} onMod={adminMod} />
            ))}
          </div>
        )}
      </section>

      <p className="mt-6 rounded-xl border border-slate-800 bg-slate-900/40 p-3 text-[11px] leading-relaxed text-slate-500">
        Governance is community signalling, recorded on Arweave. Outcomes guide the project but aren&apos;t a binding contract.
        TrustVault has no token; voting is free and confers no financial rights.
      </p>

      {composing && <ProposalComposer onClose={() => setComposing(false)} onCreate={async (title, body, options, endAt) => {
        const id = await publishProposal({ title, body, options, endAt, name: "Team" });
        optimistic({ proposals: [{ txId: `local-p-${id}`, author: address!, b: { id, title, body, options, endAt, at: Date.now(), name: "Team" } }] });
        setComposing(false);
      }} />}
      {loginOpen && <LoginModal onClose={() => setLoginOpen(false)} />}
    </div>
  );
}

function ProposalCard({ p, isAdmin, onVote, canVote, onConnect, onMod }: { p: ProposalResult; isAdmin: boolean; onVote: (option: string) => void; canVote: boolean; onConnect: () => void; onMod: (action: "delete" | "close", id: string) => void }) {
  const ended = !p.open;
  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="mb-1 flex items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${p.open ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" : "bg-slate-700/40 text-slate-400 ring-slate-600/40"}`}>{p.open ? "Open" : "Closed"}</span>
        <span className="text-[11px] text-slate-500">{p.voterCount} {p.voterCount === 1 ? "vote" : "votes"} · {ended ? "ended" : "ends"} {new Date(p.endAt).toISOString().slice(0, 10)}</span>
        {isAdmin && (
          <span className="ml-auto flex items-center gap-1.5">
            {p.open && <button onClick={() => onMod("close", p.id)} className="rounded-md border border-slate-700 px-2 py-0.5 text-[10px] font-medium text-slate-300 hover:bg-slate-800">Close</button>}
            <button onClick={() => onMod("delete", p.id)} className="rounded-md border border-slate-700 px-2 py-0.5 text-[10px] font-medium text-rose-300 hover:bg-slate-800">Delete</button>
          </span>
        )}
      </div>
      <h3 className="text-base font-semibold text-white">{p.title}</h3>
      {p.body && <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-400">{p.body}</p>}
      <div className="mt-3 space-y-2">
        {p.tally.map((t) => {
          const mine = p.myOption === t.option;
          return (
            <div key={t.option}>
              <div className="mb-0.5 flex items-center justify-between text-xs">
                <span className={`font-medium ${mine ? "text-indigo-300" : "text-slate-300"}`}>{t.option}{mine && " · your vote"}</span>
                <span className="tabular-nums text-slate-400">{t.votes} · {t.pct.toFixed(0)}%</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                  <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${t.pct}%` }} />
                </div>
                {p.open && (
                  <button
                    onClick={() => (canVote ? onVote(t.option) : onConnect())}
                    className={`shrink-0 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${mine ? "border-indigo-500 text-indigo-300" : "border-slate-700 text-slate-200 hover:bg-slate-700"}`}
                  >
                    {mine ? "Voted" : "Vote"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}

function Explainer({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">{body}</p>
    </div>
  );
}

function ProposalComposer({ onClose, onCreate }: { onClose: () => void; onCreate: (title: string, body: string, options: string[], endAt: number) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [options, setOptions] = useState<string[]>(["Yes", "No"]);
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setOpt = (i: number, v: string) => setOptions((o) => o.map((x, j) => (j === i ? v : x)));
  const addOpt = () => setOptions((o) => [...o, ""]);
  const removeOpt = (i: number) => setOptions((o) => o.filter((_, j) => j !== i));

  const endAt = Date.now() + Math.max(1, days) * 86_400_000;
  const submit = async () => {
    const clean = options.map((o) => o.trim()).filter(Boolean);
    if (!title.trim()) { setErr("Add a title."); return; }
    if (clean.length < 2) { setErr("Add at least two options."); return; }
    if (new Set(clean.map((o) => o.toLowerCase())).size !== clean.length) { setErr("Options must be unique."); return; }
    setBusy(true); setErr(null);
    try { await onCreate(title.trim(), body.trim(), clean, endAt); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't create the proposal."); setBusy(false); }
  };

  const field = "w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none";
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div onMouseDown={(e) => e.stopPropagation()} className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-white">New proposal</h2>
          <button onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-200"><svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>
        <div className="space-y-4 overflow-y-auto p-5">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Proposal title" className={field} />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="Describe the proposal…" className={`${field} resize-y`} />

          {/* options — added one per line */}
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-400">Options</p>
            <div className="space-y-1.5">
              {options.map((o, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-4 shrink-0 text-right text-[10px] tabular-nums text-slate-500">{i + 1}</span>
                  <input value={o} onChange={(e) => setOpt(i, e.target.value)} placeholder={`Option ${i + 1}`} className={`${field} py-1.5`} />
                  <button onClick={() => removeOpt(i)} disabled={options.length <= 2} title="Remove option" className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-slate-700 text-slate-500 hover:text-rose-300 disabled:opacity-30">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
                  </button>
                </div>
              ))}
            </div>
            <button onClick={addOpt} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-700 px-2.5 py-1.5 text-xs font-medium text-indigo-300 hover:border-indigo-500/50 hover:text-indigo-200">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
              Add option
            </button>
          </div>

          {/* custom voting period */}
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-400">Voting period</p>
            <div className="flex flex-wrap items-center gap-2">
              <input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Math.max(1, Math.min(365, Math.floor(Number(e.target.value) || 1))))} className="w-20 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none" />
              <span className="text-xs text-slate-400">day{days === 1 ? "" : "s"}</span>
              <span className="text-[11px] text-slate-500">· ends {new Date(endAt).toISOString().slice(0, 10)}</span>
              <span className="ml-auto flex gap-1.5">
                {[3, 7, 14, 30].map((d) => (
                  <button key={d} onClick={() => setDays(d)} className={`rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors ${days === d ? "border-indigo-500 text-indigo-300" : "border-slate-700 text-slate-400 hover:text-slate-200"}`}>{d}d</button>
                ))}
              </span>
            </div>
          </div>

          {err && <p className="text-xs text-rose-400">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-800 px-5 py-3">
          <button onClick={onClose} className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800">Cancel</button>
          <button onClick={submit} disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">{busy ? "Posting…" : "Post proposal"}</button>
        </div>
      </div>
    </div>
  );
}
