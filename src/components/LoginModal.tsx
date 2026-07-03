"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useWallet } from "@/context/WalletContext";
import { detectWallet, incapableReason, type DetectedWallet } from "@/lib/walletProvider";
import { isPasskeySupported, loadEmbeddedMarker } from "@/lib/embeddedWallet";
import { useIsMobileDevice } from "@/lib/useIsMobile";
import { DesktopOnlyNotice } from "@/components/DesktopOnly";

// Two ways in:
//  • Passkey (recommended) — a passwordless, no-extension embedded Arweave wallet (Face ID / Touch ID /
//    Windows Hello). Free, end-to-end encrypted, recoverable across the user's synced devices.
//  • An Arweave wallet — whatever capable wallet is injected (Wander or another). A present-but-
//    incapable wallet is shown disabled with the reason.
export function LoginModal({ onClose }: { onClose: () => void }) {
  const { connect, connectPasskey, isConnecting } = useWallet();
  const isMobile = useIsMobileDevice(); // phones/tablets can't sign in yet — desktop only
  const [busy, setBusy] = useState<null | "create" | "recover" | "wallet">(null);
  const [error, setError] = useState<string | null>(null);
  // Client-only detection (reads window) to avoid an SSR/hydration mismatch.
  const [detected, setDetected] = useState<DetectedWallet | null>(null);
  const [passkeyOk, setPasskeyOk] = useState(false);
  const [returning, setReturning] = useState(false);
  useEffect(() => {
    setDetected(detectWallet());
    setPasskeyOk(isPasskeySupported());
    setReturning(!!loadEmbeddedMarker());
  }, []);

  const run = async (kind: "create" | "recover" | "wallet") => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "wallet") await connect();
      else await connectPasskey(kind === "create");
      onClose(); // the landing's isConnected→/dashboard effect takes over
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't sign in. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const anyBusy = busy !== null || isConnecting;
  const reason = detected ? incapableReason(detected) : null;
  const canConnectWallet = !!detected?.present && !!detected?.capable;
  const walletName = detected?.name ?? "Arweave wallet";

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div onMouseDown={(e) => e.stopPropagation()} className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-white">Sign in to TrustVault</h2>
          <button onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-200"><svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>

        {isMobile ? (
          <div className="p-5"><DesktopOnlyNotice /></div>
        ) : (
        <div className="space-y-3 p-5">
          <p className="text-xs leading-relaxed text-slate-400">
            Your documents stay end-to-end encrypted — only you hold the keys.
          </p>

          {/* Passkey (recommended) — no extension, no password. */}
          {passkeyOk && (
            <div className="space-y-2">
              <button
                onClick={() => run(returning ? "recover" : "create")}
                disabled={anyBusy}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy === "create" || busy === "recover" ? <Spinner /> : <PasskeyGlyph />}
                {busy === "create" || busy === "recover"
                  ? "Waiting for your passkey…"
                  : returning
                    ? "Sign in with your passkey"
                    : "Create an account with a passkey"}
              </button>
              <p className="text-center text-[10px] leading-relaxed text-slate-500">
                Uses Face ID · Touch ID · Windows Hello. No extension, no password — free and encrypted to you.
              </p>
              {/* Let a returning user mint a fresh account, or a new user recover an existing passkey. */}
              <button
                onClick={() => run(returning ? "create" : "recover")}
                disabled={anyBusy}
                className="w-full text-center text-[11px] text-indigo-300 hover:underline disabled:opacity-50"
              >
                {returning ? "Create a new account instead" : "I already have a passkey — sign in"}
              </button>
            </div>
          )}

          {passkeyOk && (
            <div className="flex items-center gap-3 py-0.5">
              <span className="h-px flex-1 bg-slate-800" />
              <span className="text-[10px] uppercase tracking-wide text-slate-600">or</span>
              <span className="h-px flex-1 bg-slate-800" />
            </div>
          )}

          {/* Detected injected wallet (Wander or any other capable wallet). */}
          <button
            onClick={() => run("wallet")}
            disabled={anyBusy || !canConnectWallet}
            title={reason ?? undefined}
            className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              passkeyOk ? "border border-slate-700 text-slate-200 hover:border-slate-500 hover:text-white" : "bg-indigo-600 text-white hover:bg-indigo-500"
            }`}
          >
            {busy === "wallet" ? <Spinner /> : <WalletGlyph />}
            {busy === "wallet" ? "Connecting…" : detected?.present ? `Connect ${walletName}` : "Connect a wallet"}
          </button>

          {detected?.present && !detected.capable && reason && (
            <p className="text-[11px] leading-relaxed text-amber-300/90">{reason}</p>
          )}
          {error && <p className="text-[11px] text-rose-300">{error}</p>}

          <p className="text-center text-[10px] leading-relaxed text-slate-600">
            Prefer a wallet? Install{" "}
            <a href="https://www.wander.app" target="_blank" rel="noopener noreferrer" className="text-indigo-300 hover:underline">Wander</a>
            {" "}— or use any Arweave wallet — then reload.
          </p>
        </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function PasskeyGlyph() {
  // Fingerprint — the universal "passkey / biometric" mark.
  return <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}><path strokeLinecap="round" strokeLinejoin="round" d="M7.86 4.24A7.5 7.5 0 0 1 19.5 10.5c0 2.92-.56 5.71-1.57 8.27M5.74 6.36A7.47 7.47 0 0 0 4.5 10.5a7.46 7.46 0 0 1-1.15 3.99M5.34 17.55A11.21 11.21 0 0 0 8.25 10.5a3.75 3.75 0 1 1 7.5 0c0 .53-.02 1.05-.06 1.57M12 10.5a14.94 14.94 0 0 1-3.6 9.75m6.63-4.6a18.67 18.67 0 0 1-2.48 5.33" /></svg>;
}
function WalletGlyph() {
  return <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><rect x="3" y="6" width="18" height="13" rx="2.5" /><path strokeLinecap="round" d="M3 10h18M16.5 14.5h.5" /></svg>;
}
function Spinner({ className = "" }: { className?: string }) {
  return <svg className={`h-4 w-4 animate-spin text-white/90 ${className}`} viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" /></svg>;
}
