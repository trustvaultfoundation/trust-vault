"use client";

import { useEffect, useState } from "react";

const KEY = "gtv_cookie_consent_v1";

// A themed, GDPR/ePrivacy-style consent notice. TrustVault keeps your wallet + encrypted
// data in the browser (local storage) — strictly necessary to run the app — and uses no
// third-party tracking. We still ask for consent and remember the choice (per-device).
// If analytics are ever added, gate them on `level === "all"`.
export function CookieConsent() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setShow(true);
    } catch {
      /* storage blocked — don't nag */
    }
  }, []);
  const choose = (level: "all" | "necessary") => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ level, at: Date.now() }));
    } catch {
      /* ignore */
    }
    setShow(false);
  };
  if (!show) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[90] flex justify-center px-4 pb-4">
      <div className="pointer-events-auto w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900/95 p-4 shadow-2xl shadow-black/40 backdrop-blur sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="flex-1">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-white">
              <svg className="h-4 w-4 text-indigo-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><circle cx="12" cy="12" r="9" /><circle cx="9" cy="9.5" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="11" r="1" fill="currentColor" stroke="none" /><circle cx="10" cy="14.5" r="1" fill="currentColor" stroke="none" /><circle cx="14.5" cy="15" r="0.8" fill="currentColor" stroke="none" /></svg>
              We value your privacy
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              TrustVault stores data on your device (local storage) to run the app — your wallet and encrypted files
              stay in your browser. We use only strictly-necessary storage and no third-party tracking.{" "}
              <a href="/help" className="text-indigo-300 underline-offset-2 hover:underline">Learn more</a>.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button onClick={() => choose("necessary")} className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-white">
              Necessary only
            </button>
            <button onClick={() => choose("all")} className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-indigo-500">
              Accept
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
