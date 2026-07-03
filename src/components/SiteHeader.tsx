"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWallet } from "@/context/WalletContext";
import { BrandWordmark } from "@/components/BrandWordmark";
import { LoginModal } from "@/components/LoginModal";
import { AccountSwitcher, BalancePill } from "@/components/AccountSwitcher";
import { ArweaveTokenIcon } from "@/components/TokenIcon";

// Shared top header for the public pages (landing / help / forum). Signed-out it shows a "Sign in"
// button (opens the LoginModal); signed-in it shows the same cluster as inside the app — balance pill,
// account switcher and disconnect.
export function SiteHeader() {
  const { isConnected, balance, disconnect } = useWallet();
  const router = useRouter();
  const [loginOpen, setLoginOpen] = useState(false);

  return (
    <header className="relative z-20 flex shrink-0 items-center justify-between border-b border-slate-800/70 px-6 py-4">
      <Link href="/" aria-label="TrustVault home"><BrandWordmark /></Link>

      <div className="flex items-center gap-2.5">
        {isConnected ? (
          <>
            <BalancePill icon={<ArweaveTokenIcon />} value={`${balance ?? "…"} AR`} />
            <AccountSwitcher />
            <button
              onClick={async () => { await disconnect(); router.replace("/"); }}
              title="Disconnect"
              aria-label="Disconnect"
              className="group flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 text-slate-500 transition-colors hover:border-red-800/60 hover:text-red-400"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 21H6a2 2 0 01-2-2V5a2 2 0 012-2h3" />
                <g className="transition-transform duration-300 group-hover:translate-x-0.5"><path strokeLinecap="round" strokeLinejoin="round" d="M16 17l5-5-5-5M21 12H9" /></g>
              </svg>
            </button>
          </>
        ) : (
          <button onClick={() => setLoginOpen(true)} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500">Sign in</button>
        )}
      </div>

      {loginOpen && <LoginModal onClose={() => setLoginOpen(false)} />}
    </header>
  );
}
