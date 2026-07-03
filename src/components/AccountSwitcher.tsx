"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/context/WalletContext";
import { walletLabel, type LinkedWallet } from "@/lib/linkedWallets";

type Toast = (m: string, t?: "error" | "info" | "warning") => void;

// Small balance pill used in the header next to the account switcher.
export function BalancePill({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5">
      {icon}
      <span className="text-xs font-medium text-slate-200 tabular-nums">{value}</span>
    </div>
  );
}

// Header pill showing the active wallet, with a dropdown to switch between linked accounts, copy the
// address, or add another (sends you to Settings → Account & wallets). Shared by the app shell and the
// public-page header. `onToast` is optional so the public pages (no toast system) can still use it.
export function AccountSwitcher({ onToast }: { onToast?: Toast }) {
  const { address, balance, linkedWallets, switchWallet } = useWallet();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  if (!address) return null;
  const copy = () => { navigator.clipboard.writeText(address); onToast?.("Wallet address copied", "info"); setOpen(false); };
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Account"
        className="group flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 transition-colors hover:border-slate-500"
      >
        <span className="h-2 w-2 rounded-full bg-emerald-400" />
        <span className="font-mono text-xs text-slate-300 transition-colors group-hover:text-white">{address.slice(0, 6)}…{address.slice(-4)}</span>
        <svg className={`h-3.5 w-3.5 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-64 overflow-hidden rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-2xl">
          <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Accounts</p>
          {linkedWallets.map((w: LinkedWallet) => {
            const active = w.address === address;
            return (
              <button
                key={w.address}
                onClick={() => { setOpen(false); if (!active) switchWallet(w.address).catch((e) => onToast?.(e instanceof Error ? e.message : "Couldn't switch wallet.")); }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left ${active ? "bg-indigo-600/15" : "hover:bg-slate-800"}`}
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${active ? "bg-emerald-400" : "bg-slate-600"}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs text-slate-200">{walletLabel(w)}</span>
                  <span className="block truncate text-[10px] text-slate-500">{w.type === "embedded" ? "Passkey wallet" : "Browser wallet"}{active && balance ? ` · ${balance} AR` : ""}</span>
                </span>
                {active && <span className="shrink-0 text-[9px] font-medium uppercase tracking-wide text-indigo-300">Active</span>}
              </button>
            );
          })}
          {linkedWallets.length > 1 && (
            <p className="px-3 pb-1 pt-0.5 text-[10px] leading-snug text-slate-600">Switching reopens Wander to confirm the account.</p>
          )}
          <div className="my-1 border-t border-slate-800" />
          <button onClick={copy} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-300 hover:bg-slate-800">
            <svg className="h-3.5 w-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 012-2h10" /></svg>
            Copy address
          </button>
          <button onClick={() => { setOpen(false); router.push("/settings"); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-300 hover:bg-slate-800">
            <svg className="h-3.5 w-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
            Add another wallet
          </button>
        </div>
      )}
    </div>
  );
}
