"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/context/WalletContext";
import { ADMIN_ADDRESS, fetchDonors, publishDonor, removeDonor, type Donor } from "@/lib/donors";
import { Loading } from "@/components/Spinner";

// Top supporters — admin-curated leaderboard. Top 10 shown; the top 3 get medal backgrounds.
const RANK = [
  { ring: "border-amber-500/50 bg-amber-500/10", badge: "bg-amber-500 text-amber-950", medal: "1" },
  { ring: "border-slate-400/50 bg-slate-400/10", badge: "bg-slate-300 text-slate-900", medal: "2" },
  { ring: "border-orange-700/50 bg-orange-700/15", badge: "bg-orange-600 text-orange-50", medal: "3" },
];

const shortDonor = (s: string) => (s.length > 22 && !s.includes(" ") ? `${s.slice(0, 8)}…${s.slice(-6)}` : s);
const fmt = (n: number) => `$${n.toLocaleString("en-US")}`;

export function DonorLeaderboard() {
  const { address } = useWallet();
  const isAdmin = address === ADMIN_ADDRESS;
  const [donors, setDonors] = useState<Donor[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const load = () => { fetchDonors().then(setDonors).catch(() => setDonors([])).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);

  const remove = async (d: Donor) => {
    if (!confirm(`Remove "${d.donor}" from the leaderboard?`)) return;
    setDonors((l) => l.filter((x) => x.id !== d.id));
    await removeDonor(d.id).catch(() => {});
  };
  const top = donors.slice(0, 10);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <svg className="h-4 w-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 21h8M12 17v4M7 4h10v4a5 5 0 01-10 0V4zM5 6H3v1a3 3 0 003 3M19 6h2v1a3 3 0 01-3 3" /></svg>
          Top supporters
        </h2>
        {isAdmin && (
          <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-800">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>Add
          </button>
        )}
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-slate-400">The people keeping TrustVault free. Thank you 💜</p>

      {loading ? (
        <Loading label="Loading…" />
      ) : top.length === 0 ? (
        <p className="py-8 text-center text-xs text-slate-500">No supporters listed yet{isAdmin ? " — add the first with the button above." : "."}</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {top.map((d, i) => {
            const r = RANK[i];
            return (
              <li key={d.id} className={`flex items-center gap-3 rounded-xl border p-2.5 ${r ? r.ring : "border-slate-800 bg-slate-800/40"}`}>
                <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold tabular-nums ${r ? r.badge : "bg-slate-800 text-slate-400"}`}>{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-100" title={d.donor}>{shortDonor(d.donor)}</span>
                  {d.note && <span className="block truncate text-[11px] text-slate-500">{d.note}</span>}
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-200">{fmt(d.amount)}</span>
                {isAdmin && (
                  <button onClick={() => remove(d)} title="Remove" aria-label="Remove" className="shrink-0 rounded-md p-1 text-slate-500 hover:text-rose-300">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {adding && <AddDonor onClose={() => setAdding(false)} onSaved={(d) => { setDonors((l) => [...l.filter((x) => x.id !== d.id), d].sort((a, b) => b.amount - a.amount)); setAdding(false); }} />}
    </div>
  );
}

function AddDonor({ onClose, onSaved }: { onClose: () => void; onSaved: (d: Donor) => void }) {
  const [donor, setDonor] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    const amt = Number(amount);
    if (!donor.trim() || !(amt > 0)) { setErr("Add a wallet/name and an amount greater than 0."); return; }
    setBusy(true); setErr(null);
    try {
      const id = await publishDonor({ donor: donor.trim(), amount: amt, note: note.trim() || undefined });
      onSaved({ id, donor: donor.trim(), amount: amt, note: note.trim() || undefined, at: Date.now() });
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save."); setBusy(false); }
  };
  const field = "w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none";
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div onMouseDown={(e) => e.stopPropagation()} className="relative w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-white">Add supporter</h2>
          <button onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-200"><svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>
        <div className="space-y-3 p-5">
          <label className="block text-xs font-medium text-slate-400">Wallet or name
            <input value={donor} onChange={(e) => setDonor(e.target.value)} placeholder="0x… or a display name" className={`${field} mt-1`} />
          </label>
          <label className="block text-xs font-medium text-slate-400">Total contributed (USD)
            <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="500" className={`${field} mt-1`} />
          </label>
          <label className="block text-xs font-medium text-slate-400">Note (optional)
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. BTC · early backer" className={`${field} mt-1`} />
          </label>
          {err && <p className="text-xs text-rose-400">{err}</p>}
          <p className="text-[10px] leading-relaxed text-slate-600">Editing an existing supporter? Add them again with the same wallet/name and the new total — only the team can publish, on-chain.</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-800 px-5 py-3">
          <button onClick={onClose} className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800">Cancel</button>
          <button onClick={submit} disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">{busy ? "Saving…" : "Add"}</button>
        </div>
      </div>
    </div>
  );
}
