"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Donate } from "@/components/Donate";

// ── content model (Help-style topic browser) ──
type Block =
  | { p: string }
  | { h: string }
  | { ul: string[] }
  | { ol: string[] }
  | { tip: string }
  | { note: string }
  | { donate: true };

type Topic = { id: string; title: string; intro?: string; blocks: Block[] };

const TOPICS: Topic[] = [
  {
    id: "overview",
    title: "Overview",
    intro: "TrustVault is a free, end-to-end encrypted workspace stored permanently on Arweave — and the first place where a company can prove, on-chain, that its work is real.",
    blocks: [
      { p: "Teams run their real work in TrustVault (documents, project boards, service desk, chat, calendar), and can publish a live, tamper-proof view of their progress for investors and users to see. The community helps steer the project through free, one-wallet-one-vote governance." },
      { h: "Why it matters" },
      { ul: [
        "Crypto runs on promises — most roadmaps and marketing turn out exaggerated or false, so serious people learned not to believe them.",
        "TrustVault flips that: instead of a pitch, it shows the actual work, updated in real time and anchored on Arweave so it can't be quietly rewritten.",
        "And it's free: no token to buy, no subscription. If it's useful, you can support it with an optional donation.",
      ] },
      { tip: "New here? Read “The trust problem” and “DePM: proof, not promises” first, then “The platform” to see what each part does for your company." },
    ],
  },
  {
    id: "problem",
    title: "The trust problem in crypto",
    intro: "The industry has a credibility crisis — the biggest barrier between good projects and the people who'd back them.",
    blocks: [
      { p: "Ask anyone who's been around a while: the roadmap was fiction, the “partnerships” were screenshots, the team went quiet after the raise. After enough of that, people stop believing anything a project says — even when it's true." },
      { h: "Why it happens" },
      { ul: [
        "Roadmaps are marketing, not commitments — there's no cost to promising features that never ship.",
        "Progress is invisible — outsiders can't tell if a team is building or stalling, so they assume the worst.",
        "Marketing rewards hype over substance; the loudest projects often have the least underneath.",
      ] },
      { p: "The fix isn't another promise. It's removing the need to take the team's word for it at all." },
    ],
  },
  {
    id: "depm",
    title: "DePM: proof, not promises",
    intro: "DePM — Decentralized Project Management — is TrustVault's answer to the trust problem: show the real work, on-chain, instead of marketing it.",
    blocks: [
      { p: "A company runs its day-to-day project management inside TrustVault — boards, tickets, columns, progress. With one switch, it can publish a chosen board to a public page where anyone can see what the team is actually shipping: the columns, the ticket titles, and how much is done versus in progress." },
      { h: "Why it's different from a roadmap" },
      { ul: [
        "It's the real board, not a curated slide — the same one the team works in every day.",
        "It updates automatically as work happens, so a stalled project looks stalled and a moving one looks like it's moving.",
        "It's anchored on Arweave — permanent and tamper-evident, so history can't be quietly rewritten.",
        "The company chooses exactly which projects are public; private work stays end-to-end encrypted.",
      ] },
      { h: "What this gives each side" },
      { ul: [
        "Companies: prove momentum and earn trust without leaking secrets — transparency as a competitive advantage.",
        "Investors & supporters: judge a project by what it's building, not just by its pitch.",
        "Users & communities: an honest view of a project's real state, so they can believe in it for the right reasons.",
      ] },
      { note: "DePM shows progress, not a guarantee of success — a transparent team can still fail, but you'll see it happening. Public info is self-published; always do your own research." },
    ],
  },
  {
    id: "platform",
    title: "The platform — what it does for your company",
    intro: "TrustVault is the encrypted workspace a company actually runs on. Each part has a clear job — and most can feed the public DePM view.",
    blocks: [
      { h: "Documents & Vault" },
      { p: "Encrypted document storage on Arweave — contracts, designs, legal, anything sensitive. Files are encrypted in your browser; only people you share with can open them. A permanent, breach-resistant home for the documents that matter, with no server to trust." },
      { h: "Board (project management)" },
      { p: "Boards with projects, columns and tickets to run your delivery, shared end-to-end encrypted with your team. This is the source of truth DePM publishes from — so public progress is a by-product of doing the work." },
      { h: "DePM — public projects" },
      { p: "The public, on-chain showcase of the boards you choose to make public, with your company profile, logo, links and per-project descriptions." },
      { h: "Service Desk (ITSM)" },
      { p: "Incidents, requests, changes and problems with priority, approvals and SLAs — support and operations handled professionally and visibly." },
      { h: "Chat" },
      { p: "End-to-end encrypted group chat for your team and partners, tied into your boards and records." },
      { h: "Calendar" },
      { p: "Meetings, tasks and reminders alongside your tickets' due dates, with shareable invites and meeting links." },
      { h: "Timesheet" },
      { p: "A calendar-style week of every hour your team logs across its boards — card worklog, calendar events and Service Desk working time, side by side — plus holiday and vacation requests that managers approve. Time tracking and leave, without leaving the workspace." },
      { h: "Dashboard" },
      { p: "Analytics over your documents, any board, or any Service Desk team — charts and exportable reports for stand-ups and updates." },
      { h: "Documentation" },
      { p: "A space to write things down — specs, processes, knowledge — with rich text, attachments and diagrams." },
      { h: "Forum & Governance" },
      { p: "A public community space for feedback, plus free one-wallet-one-vote governance so the direction is a shared, on-chain decision." },
      { tip: "The point: a company gets a complete, encrypted operating system — and the trust dividend of being able to prove what it's doing, all for free." },
    ],
  },
  {
    id: "free",
    title: "Free, forever",
    intro: "TrustVault has no token, no subscription, and no paywall. Here's how that works and why.",
    blocks: [
      { ul: [
        "The app runs entirely in your browser and stores data on Arweave — there's no company server to pay for per user.",
        "Most actions (encrypted records, board events, votes, small files) fit Arweave's free upload tier, so they cost you nothing.",
        "There is no token to buy and nothing to unlock — every feature is available to everyone.",
        "Large file uploads may need a small amount of Arweave/Turbo credit, paid directly to the network, not to us.",
      ] },
      { p: "We keep it free because trust compounds. If TrustVault is useful to you, optional donations (see “Support the project”) fund continued development." },
    ],
  },
  {
    id: "governance",
    title: "How governance works",
    intro: "Free, snapshot-style governance that runs entirely in your browser against Arweave — one wallet, one vote.",
    blocks: [
      { ol: [
        "The team posts a proposal with a set of options and a deadline.",
        "To vote, connect a wallet and pick an option; your vote is signed by your wallet and stored on Arweave.",
        "Every wallet counts exactly once — results are a simple tally of votes per option.",
        "You can change your mind any time before the deadline; your latest vote is the one that counts.",
      ] },
      { h: "Who can do what" },
      { ul: [
        "Anyone with a connected wallet can vote — no token, no balance, no gas.",
        "The project team posts proposals and can close or remove one (e.g. spam or a mistake).",
        "Outcomes guide the project; they're community signalling, not a binding contract.",
      ] },
      { note: "One wallet = one vote is simple and free, but it isn't sybil-proof — someone could vote from many wallets. Treat results as a strong community signal, weighed alongside the forum and real-world context." },
    ],
  },
  {
    id: "support",
    title: "Support the project",
    intro: "TrustVault is free. If it's valuable to you, an optional donation keeps it being built.",
    blocks: [
      { p: "There's no token and nothing to buy. Donations are voluntary gifts that fund development — they grant no token, equity, rights, or expectation of return, and are non-refundable. Send any amount on a network below." },
      { donate: true },
    ],
  },
  {
    id: "roadmap",
    title: "Roadmap",
    intro: "Honest and incremental — and, fittingly, you'll be able to watch it happen on our own public DePM board.",
    blocks: [
      { ol: [
        "Phase 1 — The encrypted workspace + DePM public projects (live): documents, boards, service desk, chat, calendar, dashboard, forum.",
        "Phase 2 — Free, one-wallet-one-vote governance and this whitepaper; the community forms.",
        "Phase 3 — Deeper DePM (richer public profiles, analytics) and more team collaboration.",
        "Phase 4 — The community steers priorities through governance: features, integrations and partnerships.",
      ] },
    ],
  },
  {
    id: "trust",
    title: "Why you can trust TrustVault",
    intro: "The whole pitch is simple: don't trust us — verify us.",
    blocks: [
      { ul: [
        "Verifiable progress: our work (and any team's) is published on-chain via DePM — judge us by what's shipping, not by this document.",
        "Free, no token: there's nothing to sell you, so our incentive is to build something genuinely useful.",
        "End-to-end encrypted: your private data is encrypted in your browser; we never see your keys or plaintext.",
        "Permanent & transparent: it all lives on Arweave, public and tamper-evident where it's meant to be public.",
        "Yours to leave: your data is on an open network, not locked in our database.",
      ] },
      { p: "In a market full of promises, the project that proves itself earns the trust — and the trust is what lasts." },
    ],
  },
  {
    id: "risks",
    title: "Notes & disclaimer",
    blocks: [
      { note: "TrustVault is provided “as is”, without warranties. Crypto networks and on-chain systems can contain bugs; anything published to Arweave (including public DePM boards and forum posts) is permanent and cannot be deleted. Public project information is self-published and not verified by us. Governance is non-binding community signalling. Donations are voluntary and confer no rights or returns. Nothing here is financial, investment, or legal advice — do your own research and consult professionals. See the full Terms for details." },
    ],
  },
];

export default function WhitepaperView({ className = "" }: { className?: string }) {
  const [selId, setSelId] = useState(TOPICS[0].id);
  const [navOpen, setNavOpen] = useState(false);
  const [query, setQuery] = useState("");
  const idx = TOPICS.findIndex((t) => t.id === selId);
  const sel = TOPICS[idx] ?? TOPICS[0];
  const prev = idx > 0 ? TOPICS[idx - 1] : null;
  const next = idx < TOPICS.length - 1 ? TOPICS[idx + 1] : null;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return TOPICS;
    return TOPICS.filter((t) => (t.title + " " + (t.intro ?? "") + " " + JSON.stringify(t.blocks)).toLowerCase().includes(q));
  }, [query]);

  const open = (id: string) => { setSelId(id); setNavOpen(false); };

  return (
    <div className={`relative flex items-start gap-0 md:gap-4 ${className}`}>
      {navOpen && <div className="fixed inset-0 z-20 bg-black/50 md:hidden" onClick={() => setNavOpen(false)} aria-hidden />}
      <div className={`fixed inset-y-0 left-0 z-30 flex w-72 max-w-[85%] shrink-0 flex-col rounded-xl border border-slate-800 bg-slate-900 transition-transform duration-200 md:sticky md:top-4 md:z-auto md:max-h-[calc(100vh-7rem)] md:w-64 md:max-w-none md:translate-x-0 md:self-start md:bg-slate-900/40 ${navOpen ? "translate-x-0 shadow-2xl shadow-black/50" : "-translate-x-[110%]"}`}>
        <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2 md:hidden">
          <span className="text-xs font-semibold text-slate-300">Contents</span>
          <button onClick={() => setNavOpen(false)} title="Close" className="rounded p-1 text-slate-400 hover:text-slate-200"><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>
        <div className="border-b border-slate-800 p-2">
          <div className="relative">
            <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="M21 21l-4-4" /></svg>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the paper…" className="w-full rounded-lg border border-slate-700 bg-slate-800/60 py-1.5 pl-8 pr-3 text-xs text-slate-200 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none" />
          </div>
        </div>
        <nav className="flex-1 min-h-0 overflow-y-auto p-2">
          {results.length === 0 ? (
            <p className="px-1 py-6 text-center text-[11px] text-slate-600">No matches.</p>
          ) : results.map((t) => (
            <button key={t.id} onClick={() => open(t.id)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs ${t.id === selId ? "bg-slate-800 text-slate-100" : "text-slate-300 hover:bg-slate-800/50"}`}>
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-slate-800 text-[10px] font-semibold text-slate-400">{TOPICS.indexOf(t) + 1}</span>
              <span className="min-w-0 truncate">{t.title}</span>
            </button>
          ))}
        </nav>
      </div>

      <div className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-3xl px-1 sm:px-4">
          <button onClick={() => setNavOpen(true)} className="mb-3 mt-1 inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-500 md:hidden">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
            Contents
          </button>
          <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-indigo-300">Whitepaper · v1</span>
          <h1 className="mt-3 pt-1 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">{sel.title}</h1>
          {sel.intro && <p className="mt-2 text-base leading-relaxed text-slate-300">{sel.intro}</p>}

          <div className="mt-5 space-y-3">
            {sel.blocks.map((b, i) => <BlockView key={i} block={b} />)}
          </div>

          <div className="mt-8 grid grid-cols-2 gap-3 border-t border-slate-800 pt-4 pb-12">
            {prev ? (
              <button onClick={() => open(prev.id)} className="group/n flex flex-col items-start rounded-lg border border-slate-800 px-3 py-2 text-left transition-colors hover:border-slate-700 hover:bg-slate-800/40">
                <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500"><svg className="h-3 w-3 transition-transform group-hover/n:-translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M15 6l-6 6 6 6" /></svg> Back</span>
                <span className="mt-0.5 text-xs font-medium text-slate-200 group-hover/n:text-white">{prev.title}</span>
              </button>
            ) : <span />}
            {next ? (
              <button onClick={() => open(next.id)} className="group/n flex flex-col items-end rounded-lg border border-slate-800 px-3 py-2 text-right transition-colors hover:border-slate-700 hover:bg-slate-800/40">
                <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500">Next <svg className="h-3 w-3 transition-transform group-hover/n:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M9 6l6 6-6 6" /></svg></span>
                <span className="mt-0.5 text-xs font-medium text-slate-200 group-hover/n:text-white">{next.title}</span>
              </button>
            ) : <span />}
          </div>
        </div>
      </div>
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  if ("h" in block) return <h2 className="pt-2 text-base font-semibold text-white">{block.h}</h2>;
  if ("p" in block) return <p className="text-sm leading-relaxed text-slate-300">{block.p}</p>;
  if ("ul" in block) return (
    <ul className="space-y-1.5">
      {block.ul.map((li, i) => (
        <li key={i} className="flex gap-2 text-sm leading-relaxed text-slate-300"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-indigo-400/70" /><span className="min-w-0">{li}</span></li>
      ))}
    </ul>
  );
  if ("ol" in block) return (
    <ol className="space-y-1.5">
      {block.ol.map((li, i) => (
        <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-slate-300"><span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[10px] font-semibold text-slate-300">{i + 1}</span><span className="min-w-0">{li}</span></li>
      ))}
    </ol>
  );
  if ("tip" in block) return (
    <div className="flex gap-2.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2.5">
      <svg className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 3a6 6 0 00-3 11.2V16h6v-1.8A6 6 0 0012 3zM9.5 20h5M10 22h4" /></svg>
      <p className="text-xs leading-relaxed text-indigo-100">{block.tip}</p>
    </div>
  );
  if ("donate" in block) return <Donate compact />;
  // note
  return (
    <div className="flex gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
      <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.3 4.3 2.6 18a2 2 0 001.7 3h15.4a2 2 0 001.7-3L13.7 4.3a2 2 0 00-3.4 0z" /></svg>
      <p className="text-xs leading-relaxed text-amber-100">{block.note}</p>
    </div>
  );
}
