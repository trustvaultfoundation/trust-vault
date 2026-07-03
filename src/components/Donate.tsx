"use client";

import { useState } from "react";

// TrustVault is free. Donations are voluntary and fund development — no token, no rights, no returns.
const WALLETS: { chain: string; symbol: string; address: string }[] = [
  { chain: "Bitcoin", symbol: "BTC", address: "3GyQfQ6Zzpb2FHy64PHd4UijhofjKwuBJo" },
  { chain: "Ethereum", symbol: "ETH", address: "0xB9784A480d4F7a4B71E9609B664697Fb544bbD2F" },
  { chain: "Solana", symbol: "SOL", address: "DZDeYw6yfMVj7vVQ9ZbrT7QYfHu8qqwDsw5kACDZxpQL" },
  { chain: "Sui", symbol: "SUI", address: "0x94f15f6081e8099975a8e6f676bf80c98c2f58edf31cc489ab6091d87e70a91f" },
  { chain: "Cardano", symbol: "ADA", address: "addr1vxy4cpcrn4anfny3wyns49qwy35j7fkcc768mp5eve57dgs235ygj" },
  { chain: "Litecoin", symbol: "LTC", address: "MQE64H15ErmZ82YUVUp75nnPhNN1cNXq1G" },
];

// Brand coin logos for each network (colour circle + the network's mark).
function CoinIcon({ symbol }: { symbol: string }) {
  const cls = "h-7 w-7 shrink-0";
  switch (symbol) {
    case "BTC":
      return (
        <svg className={cls} viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#f7931a" />
          <text x="12" y="16.6" textAnchor="middle" fontSize="13" fontWeight="800" fill="#fff" fontFamily="Arial, Helvetica, sans-serif">₿</text>
        </svg>
      );
    case "ETH":
      return (
        <svg className={cls} viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#627eea" />
          <g fill="#fff">
            <path d="M12 3.2 L12 9.9 L17.2 12.2 Z" fillOpacity="0.55" />
            <path d="M12 3.2 L6.8 12.2 L12 9.9 Z" />
            <path d="M12 14.7 L12 20.8 L17.2 13.2 Z" fillOpacity="0.55" />
            <path d="M12 20.8 L12 14.7 L6.8 13.2 Z" />
            <path d="M6.8 12.2 L12 14.6 L17.2 12.2 L12 9.9 Z" fillOpacity="0.3" />
          </g>
        </svg>
      );
    case "SOL":
      return (
        <svg className={cls} viewBox="0 0 24 24">
          <defs><linearGradient id="tv-sol" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#9945ff" /><stop offset="1" stopColor="#14f195" /></linearGradient></defs>
          <circle cx="12" cy="12" r="12" fill="#0b0b14" />
          <g fill="url(#tv-sol)">
            <path d="M8.3 6.8 H18 L15.7 8.9 H6 Z" />
            <path d="M6 11 H15.7 L18 13.1 H8.3 Z" />
            <path d="M8.3 15.1 H18 L15.7 17.2 H6 Z" />
          </g>
        </svg>
      );
    case "SUI":
      return (
        <svg className={cls} viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#4da2ff" />
          <g transform="translate(12 12) scale(0.46) translate(-12.9 -16.45)">
            <path fillRule="evenodd" clipRule="evenodd" fill="#fff" d="M20.6338 13.746C21.9783 15.434 22.7822 17.5688 22.7822 19.8911C22.7822 22.2133 21.9538 24.4133 20.5741 26.1108L20.4546 26.2575L20.4233 26.0714C20.3962 25.9139 20.3649 25.7537 20.3283 25.5934C19.637 22.5569 17.3854 19.9535 13.6794 17.8445C11.1765 16.424 9.74383 14.7156 9.36766 12.7723C9.12457 11.5161 9.30519 10.2545 9.6542 9.17352C10.0032 8.09389 10.522 7.18808 10.9633 6.64352L12.4056 4.8808C12.6581 4.57117 13.1321 4.57117 13.3847 4.8808L20.6352 13.746H20.6338ZM22.914 11.9846L13.2502 0.169807C13.0656 -0.0556256 12.7206 -0.0556256 12.5359 0.169807L2.87358 11.9846L2.84235 12.024C1.06469 14.2308 0 17.0351 0 20.088C0 27.1972 5.77296 32.9607 12.8931 32.9607C20.0132 32.9607 25.7862 27.1972 25.7862 20.088C25.7862 17.0351 24.7215 14.2308 22.9438 12.0254L22.9126 11.986L22.914 11.9846ZM5.1863 13.708L6.05 12.6501L6.0758 12.8456C6.09617 13.0004 6.12198 13.1552 6.15185 13.3114C6.71136 16.2461 8.70901 18.6919 12.0484 20.5864C14.9519 22.2391 16.6426 24.139 17.1288 26.2222C17.3325 27.0913 17.3678 27.9469 17.2795 28.6951L17.2741 28.7413L17.232 28.7617C15.9215 29.4013 14.448 29.7612 12.8917 29.7612C7.43111 29.7612 3.00395 25.3422 3.00395 19.8897C3.00395 17.5485 3.82012 15.3987 5.18358 13.7053L5.1863 13.708Z" />
          </g>
        </svg>
      );
    case "ADA":
      return (
        <svg className={cls} viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#0033ad" />
          <g fill="#fff">
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="16" cy="12" r="0.95" /><circle cx="14" cy="15.46" r="0.95" /><circle cx="10" cy="15.46" r="0.95" /><circle cx="8" cy="12" r="0.95" /><circle cx="10" cy="8.54" r="0.95" /><circle cx="14" cy="8.54" r="0.95" />
            <circle cx="17.54" cy="15.2" r="0.6" /><circle cx="12" cy="18.4" r="0.6" /><circle cx="6.46" cy="15.2" r="0.6" /><circle cx="6.46" cy="8.8" r="0.6" /><circle cx="12" cy="5.6" r="0.6" /><circle cx="17.54" cy="8.8" r="0.6" />
          </g>
        </svg>
      );
    case "LTC":
      return (
        <svg className={cls} viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#345d9d" />
          <text x="12" y="16.6" textAnchor="middle" fontSize="13" fontWeight="800" fill="#fff" fontFamily="Arial, Helvetica, sans-serif">Ł</text>
        </svg>
      );
    default:
      return <svg className={cls} viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#475569" /></svg>;
  }
}

export function Donate({ compact = false }: { compact?: boolean }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (sym: string, addr: string) => {
    try { await navigator.clipboard.writeText(addr); setCopied(sym); setTimeout(() => setCopied((c) => (c === sym ? null : c)), 1800); } catch { /* ignore */ }
  };
  return (
    <div className={compact ? "" : "rounded-2xl border border-slate-800 bg-slate-900/60 p-5"}>
      {!compact && (
        <>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <svg className="h-4 w-4 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 21s-7-4.35-9.5-8.5A5 5 0 0112 6a5 5 0 019.5 6.5C19 16.65 12 21 12 21z" /></svg>
            Support TrustVault
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
            TrustVault is, and stays, <strong className="text-slate-200">free</strong>. There&apos;s no token and nothing to buy — if it&apos;s useful to you,
            an optional donation keeps it being built. Send any amount on a network below.
          </p>
        </>
      )}
      <ul className={`grid gap-2.5 ${compact ? "mt-0 sm:grid-cols-2" : "mt-4 sm:grid-cols-2 lg:grid-cols-3"}`}>
        {WALLETS.map((w) => (
          <li key={w.symbol} className="rounded-xl border border-slate-800 bg-slate-800/40 p-3">
            <div className="flex items-center gap-2.5">
              <CoinIcon symbol={w.symbol} />
              <span className="min-w-0 text-xs font-semibold text-slate-200">{w.chain}<span className="text-slate-500"> · {w.symbol}</span></span>
              <button onClick={() => copy(w.symbol, w.address)} title="Copy address" aria-label="Copy address" className="ml-auto shrink-0 rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-700 hover:text-indigo-200">
                {copied === w.symbol
                  ? <svg className="h-3.5 w-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  : <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 012-2h10" /></svg>}
              </button>
            </div>
            <p className="mt-2 break-all font-mono text-[10px] leading-snug text-slate-500">{w.address}</p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[10px] leading-relaxed text-slate-600">
        Donations are voluntary gifts — they grant no token, equity, rights, or expectation of return, and are non-refundable.
        Double-check the network before sending; transfers are irreversible.
      </p>
    </div>
  );
}
