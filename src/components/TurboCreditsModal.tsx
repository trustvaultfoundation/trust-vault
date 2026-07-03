"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createTurboCheckout, getTurboBalance, estimateGiBForUsd, USD_PRESETS } from "@/lib/turboCredits";
import { estimateArCredits, topUpWithAr, retryPendingFundTxs, pendingFundTxs, submitFundTx, startPendingRetryLoop, trackPending, scanAndAutoCredit, creditedTxIds, type TurboPayment } from "@/lib/turboCrypto";

const shortAddr = (a: string) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-5)}` : a);
const fmtGiB = (g: number) => (g >= 1 ? `${g.toFixed(g >= 10 ? 0 : 1)} GB` : `${Math.round(g * 1024)} MB`);

// Buy Turbo credits for the currently connected wallet so larger uploads succeed. Fiat (card)
// checkout is hosted by Turbo/Stripe and credits this exact address — no AR, no signature.
export function TurboCreditsModal({ address, onClose, onToast }: {
  address: string;
  onClose: () => void;
  onToast?: (m: string, t?: "error" | "info" | "warning") => void;
}) {
  const [method, setMethod] = useState<"card" | "crypto">("card");
  const [cents, setCents] = useState(1000); // $10
  const [custom, setCustom] = useState("");
  const [balance, setBalance] = useState<number | null>(null);
  const [estGiB, setEstGiB] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // crypto (AR) top-up
  const [ar, setAr] = useState("0.1");
  const [arBalance, setArBalance] = useState<number | null>(null);
  const [arCredits, setArCredits] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null); // non-error status (e.g. "payment sent")
  const [payments, setPayments] = useState<TurboPayment[]>([]); // AR top-ups found on-chain
  const [credited, setCredited] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [recoverId, setRecoverId] = useState("");
  const [recovering, setRecovering] = useState(false);

  const refreshBalance = useCallback(() => { getTurboBalance(address).then(setBalance).catch(() => {}); }, [address]);
  useEffect(() => { refreshBalance(); }, [refreshBalance]);

  // Scan on-chain payments and AUTOMATICALLY credit any confirmed ones Turbo hasn't applied — no
  // button. Refresh the balance when something lands and tell other views (Settings) to update.
  const scanPayments = useCallback(async () => {
    setScanning(true);
    try {
      const { payments: list, credited: done, creditedNow } = await scanAndAutoCredit(address);
      setPayments(list); setCredited(done);
      if (creditedNow > 0) { refreshBalance(); window.dispatchEvent(new Event("gtv:turbo-credited")); }
    } finally {
      setScanning(false);
    }
  }, [address, refreshBalance]);

  // On open: scan + auto-credit, and keep finishing any freshly-made pending credit in the background.
  useEffect(() => {
    let alive = true;
    void scanPayments();
    if (pendingFundTxs().length > 0) startPendingRetryLoop();
    retryPendingFundTxs().then((n) => { if (alive && n > 0) { refreshBalance(); void scanPayments(); } }).catch(() => {});
    const onCredited = () => { refreshBalance(); setCredited(creditedTxIds()); };
    window.addEventListener("gtv:turbo-credited", onCredited);
    return () => { alive = false; window.removeEventListener("gtv:turbo-credited", onCredited); };
  }, [scanPayments, refreshBalance]);

  const pendingAr = payments.filter((p) => !credited.has(p.txId)).reduce((s, p) => s + p.ar, 0);

  // Connected wallet's AR balance (for the crypto tab).
  useEffect(() => {
    let alive = true;
    fetch(`https://arweave.net/wallet/${address}/balance`)
      .then((r) => r.text())
      .then((w) => { if (alive) setArBalance(parseFloat(w) / 1e12); })
      .catch(() => {});
    return () => { alive = false; };
  }, [address]);

  // Rough credits the entered AR buys (best-effort; only while the crypto tab is open).
  useEffect(() => {
    let alive = true;
    setArCredits(null);
    const n = parseFloat(ar);
    if (method === "crypto" && n > 0) estimateArCredits(n).then((c) => { if (alive) setArCredits(c); }).catch(() => {});
    return () => { alive = false; };
  }, [ar, method]);

  const payCrypto = async () => {
    setError(null); setNotice(null);
    const n = parseFloat(ar);
    if (!(n > 0)) { setError("Enter an amount of AR to pay."); return; }
    if (arBalance != null && n > arBalance) { setError("That's more AR than this wallet holds."); return; }
    setBusy(true);
    try {
      const res = await topUpWithAr(n);
      if (res.status === "credited") {
        onToast?.(res.credits != null ? `Paid ${n} AR — ${res.credits.toFixed(res.credits >= 1 ? 2 : 4)} credits added.` : "Payment credited.", "info");
        refreshBalance();
        void scanPayments();
        onClose();
      } else {
        // AR sent; Arweave still confirming — it'll credit automatically once it does. Surface the
        // full tx id (and load it into recovery) so nothing is lost even if this browser is closed.
        setRecoverId(res.txId);
        void scanPayments();
        setNotice(`Payment sent (${n} AR). Arweave is confirming it — credits are added automatically in a few minutes (this keeps trying in the background). Transaction: ${res.txId}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Crypto top-up failed.");
    } finally {
      setBusy(false);
    }
  };

  const recover = async () => {
    setError(null); setNotice(null);
    const id = recoverId.trim();
    if (id.length < 43) { setError("Paste the full Arweave transaction ID (43 characters)."); return; }
    setRecovering(true);
    try {
      const ok = await submitFundTx(id);
      if (ok) { refreshBalance(); setCredited(creditedTxIds()); void scanPayments(); setRecoverId(""); onToast?.("Payment credited to your wallet.", "info"); }
      else { trackPending(id); setNotice("That transaction isn't confirmed on Arweave yet — it's saved and will credit automatically once it is."); }
    } finally {
      setRecovering(false);
    }
  };

  // Rough "how much storage" for the chosen amount (best-effort; hidden if the price API is down).
  useEffect(() => {
    let alive = true;
    setEstGiB(null);
    if (cents >= 500) estimateGiBForUsd(cents).then((g) => { if (alive) setEstGiB(g); }).catch(() => {});
    return () => { alive = false; };
  }, [cents]);

  const setPreset = (usd: number) => { setCents(usd * 100); setCustom(""); };
  const onCustom = (v: string) => {
    setCustom(v.replace(/[^0-9.]/g, ""));
    const usd = parseFloat(v);
    if (Number.isFinite(usd)) setCents(Math.round(usd * 100));
  };

  const proceed = async () => {
    setError(null);
    if (cents < 500) { setError("The minimum top-up is $5."); return; }
    if (cents > 1_000_000) { setError("The maximum top-up is $10,000."); return; }
    setBusy(true);
    try {
      const { url } = await createTurboCheckout(address, cents);
      // Open Turbo's hosted Stripe checkout in a new tab; the payment credits this wallet.
      window.open(url, "_blank", "noopener,noreferrer");
      onToast?.("Opened Turbo checkout in a new tab. Credits land on your wallet once payment completes.", "info");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start checkout.");
    } finally {
      setBusy(false);
    }
  };

  if (typeof document === "undefined") return null;
  const usd = (cents / 100).toLocaleString(undefined, { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });

  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div onMouseDown={(e) => e.stopPropagation()} className="relative w-full max-w-md overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-white">Add Turbo credits</h2>
          <button onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-200">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <p className="text-xs leading-relaxed text-slate-400">
            Small files are free; larger ones use <span className="text-slate-200">Turbo credits</span>. Top up the
            wallet you&apos;re signed in with — by card or with AR — so you can upload bigger files.
          </p>

          {/* wallet + balance */}
          <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs">
            <span className="flex items-center gap-1.5 text-slate-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="font-mono text-slate-300">{shortAddr(address)}</span>
            </span>
            <span className="text-slate-400">
              Balance: <span className="text-slate-200">{balance == null ? "—" : `${balance.toFixed(balance >= 1 ? 2 : 4)} credits`}</span>
            </span>
          </div>

          {/* payment method */}
          <div className="grid grid-cols-2 gap-2">
            {([["card", "Card", "Visa · Mastercard"], ["crypto", "Crypto", "AR & more"]] as const).map(([m, label, sub]) => (
              <button key={m} onClick={() => { setMethod(m); setError(null); }} className={`rounded-lg border px-3 py-2 text-left transition-colors ${method === m ? "border-indigo-500 bg-indigo-500/10" : "border-slate-700 bg-slate-800 hover:border-slate-600"}`}>
                <span className={`block text-sm font-semibold ${method === m ? "text-indigo-200" : "text-slate-200"}`}>{label}</span>
                <span className="block text-[11px] text-slate-500">{sub}</span>
              </button>
            ))}
          </div>

          {method === "crypto" ? (
            <div className="space-y-3">
              <p className="text-xs leading-relaxed text-slate-400">
                Pay with AR straight from your connected wallet — no card. You&apos;ll approve the transfer in
                your wallet; Turbo credits this address.
              </p>
              <p className="flex items-start gap-1.5 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-[11px] leading-relaxed text-slate-400">
                <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><circle cx="12" cy="12" r="9" /><path strokeLinecap="round" d="M12 8v4l2.5 1.5" /></svg>
                <span>Crypto payments take a <span className="text-slate-300">few minutes to be approved</span> — Arweave has to confirm the transfer before Turbo credits it. It finishes automatically.</span>
              </p>

              {/* pending crypto payments credit themselves automatically once Arweave confirms */}
              {(pendingAr > 0 || (scanning && payments.length === 0)) && (
                <p className="flex items-center gap-1.5 rounded-lg border border-amber-800/40 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-200">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                  {scanning && payments.length === 0
                    ? "Checking your payments…"
                    : `${pendingAr.toFixed(pendingAr >= 1 ? 2 : 4)} AR confirming — credited automatically, no action needed.`}
                  {" "}<span className="text-amber-200/60">Full history in Settings.</span>
                </p>
              )}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Amount (AR)</label>
                  <span className="text-[11px] text-slate-500">Wallet: {arBalance == null ? "—" : `${arBalance.toFixed(4)} AR`}</span>
                </div>
                <input
                  value={ar}
                  onChange={(e) => setAr(e.target.value.replace(/[^0-9.]/g, ""))}
                  inputMode="decimal"
                  placeholder="0.1"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
                />
                {arCredits != null && (
                  <p className="mt-2 text-[11px] text-slate-500">≈ <span className="text-slate-300">{arCredits.toFixed(arCredits >= 1 ? 2 : 4)} credits</span> for {ar || "0"} AR.</p>
                )}
                <p className="mt-1 text-[11px] text-slate-600">You&apos;ll sign the transfer in your wallet — that signature is how you approve the payment.</p>
              </div>
              {notice && <p className="break-words rounded-lg border border-amber-800/50 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">{notice}</p>}
              {error && <p className="rounded-lg border border-red-800/50 bg-red-950/20 px-3 py-2 text-xs text-red-300">{error}</p>}
              <button
                onClick={payCrypto}
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:opacity-60"
              >
                {busy ? "Confirm in your wallet…" : `Pay ${ar || "0"} AR`}
              </button>

              {/* Recover a payment whose Arweave tx has since confirmed (or one this browser lost). */}
              <details className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs">
                <summary className="cursor-pointer text-slate-400">
                  Recover a payment by transaction ID
                </summary>
                <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                  Paid AR but credits haven&apos;t shown? Paste the transaction ID and we&apos;ll ask Turbo to credit it
                  once Arweave has confirmed it (usually a few minutes).
                </p>
                <div className="mt-2 flex gap-2">
                  <input
                    value={recoverId}
                    onChange={(e) => setRecoverId(e.target.value.trim())}
                    placeholder="Arweave transaction ID"
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
                  />
                  <button onClick={recover} disabled={recovering} className="shrink-0 rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-600 disabled:opacity-60">
                    {recovering ? "…" : "Credit"}
                  </button>
                </div>
              </details>
            </div>
          ) : (
          /* amount presets (card) */
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Amount</label>
            <div className="grid grid-cols-4 gap-2">
              {USD_PRESETS.map((p) => {
                const on = !custom && cents === p * 100;
                return (
                  <button key={p} onClick={() => setPreset(p)} className={`rounded-lg border px-2 py-2 text-sm font-semibold transition-colors ${on ? "border-indigo-500 bg-indigo-500/15 text-indigo-200" : "border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600"}`}>
                    ${p}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-slate-500">$</span>
              <input
                value={custom}
                onChange={(e) => onCustom(e.target.value)}
                inputMode="decimal"
                placeholder="Custom amount (min $5)"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            {estGiB != null && (
              <p className="mt-2 text-[11px] text-slate-500">≈ <span className="text-slate-300">{fmtGiB(estGiB)}</span> of permanent storage for ${usd}.</p>
            )}

            {error && <p className="mt-3 rounded-lg border border-red-800/50 bg-red-950/20 px-3 py-2 text-xs text-red-300">{error}</p>}

            <button
              onClick={proceed}
              disabled={busy}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:opacity-60"
            >
              {busy ? "Starting checkout…" : `Continue to secure checkout · $${usd}`}
            </button>
          </div>
          )}

          <p className="text-center text-[11px] text-slate-600">
            Powered by Turbo (ArDrive). Card via Stripe; crypto via your wallet. Credits are added to the wallet above.
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
