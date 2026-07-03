"use client";

import Link from "next/link";

// TrustVault sign-in and the app are DESKTOP-ONLY for now — the wallet flow needs a desktop
// browser, and native mobile apps are planned. Shown to phones/tablets in place of the app
// (AppShell gate) and in place of the sign-in options (LoginModal). Detection lives in
// useIsMobileDevice; callers decide when to render this.
export function DesktopOnlyScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-slate-950 px-6 text-center">
      <span className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-indigo-300">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path strokeLinecap="round" d="M11 18.5h2" /></svg>
        Desktop only for now
      </span>
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/60">
        <svg className="h-8 w-8 text-indigo-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><rect x="3" y="4" width="18" height="12" rx="2" /><path strokeLinecap="round" d="M8 20h8M12 16v4" /></svg>
      </div>
      <h1 className="text-xl font-bold text-white">Open TrustVault on a computer</h1>
      <p className="max-w-sm text-sm leading-relaxed text-slate-400">
        Signing in needs a desktop-browser wallet, so TrustVault is available on desktop for now.
        Native iOS &amp; Android apps are on the way.
      </p>
      <Link href="/help" className="rounded-xl border border-slate-700 px-6 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-white">
        Documentation
      </Link>
    </div>
  );
}

// Compact inline version for the sign-in modal (no full-screen chrome).
export function DesktopOnlyNotice() {
  return (
    <div className="flex flex-col items-center gap-3 py-2 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-800 bg-slate-800/60">
        <svg className="h-6 w-6 text-indigo-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><rect x="3" y="4" width="18" height="12" rx="2" /><path strokeLinecap="round" d="M8 20h8M12 16v4" /></svg>
      </div>
      <p className="text-sm font-medium text-white">Open TrustVault on a computer</p>
      <p className="max-w-xs text-xs leading-relaxed text-slate-400">
        Signing in needs a desktop-browser wallet, so TrustVault is desktop-only for now. Native
        iOS &amp; Android apps are on the way.
      </p>
    </div>
  );
}
