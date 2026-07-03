"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@/context/WalletContext";
import { SocialIcon } from "./SocialLinks";

// Site footer — always visible at the end of the page (no toggle). Brand + grouped links, with a thin
// bottom bar. Static (sits at the bottom of each page's flex column), so it never overlaps content.
const PRODUCT = [
  { href: "/projects", label: "DePM" },
  { href: "/governance", label: "Governance" },
  { href: "/whitepaper", label: "Whitepaper" },
];
const COMMUNITY = [
  { href: "/forum", label: "Forum" },
  { href: "/help", label: "Help" },
];

export function Footer() {
  const pathname = usePathname();
  const { isConnected } = useWallet();
  const p = (pathname || "/").replace(/\/+$/, "") || "/";
  const isAppPage = !["/", "/help", "/forum", "/projects", "/terms", "/governance", "/whitepaper"].includes(p);

  const legal = [{ href: "/terms", label: "Terms & Privacy" }];
  if (isConnected && !isAppPage) legal.push({ href: "/dashboard", label: "Dashboard" });

  return (
    <footer className="relative mt-auto shrink-0 border-t border-slate-800/70 bg-slate-950/80 backdrop-blur">
      {/* subtle top accent line */}
      <div aria-hidden className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-indigo-500/40 to-transparent" />

      <div className="mx-auto w-full max-w-6xl px-6 py-7">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          {/* brand */}
          <div className="max-w-xs">
            <Link href={isConnected ? "/dashboard" : "/"} aria-label="TrustVault home" className="inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.svg" alt="TrustVault" className="h-8 w-auto transition-opacity hover:opacity-80" />
            </Link>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              The all-in-one encrypted workspace — free, end-to-end encrypted, and kept on-chain forever.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <a
                href="https://www.linkedin.com/company/trustvaultario"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="TrustVault on LinkedIn"
                title="LinkedIn"
                className="inline-flex text-slate-400 transition-colors hover:text-white"
              >
                <SocialIcon kind="linkedin" className="h-5 w-5" />
              </a>
              <a
                href="https://x.com/trustvaultf"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="TrustVault on X"
                title="X"
                className="inline-flex text-slate-400 transition-colors hover:text-white"
              >
                <SocialIcon kind="x" className="h-5 w-5" />
              </a>
              <a
                href="https://github.com/trustvaultfoundation"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="TrustVault on GitHub"
                title="GitHub"
                className="inline-flex text-slate-400 transition-colors hover:text-white"
              >
                <SocialIcon kind="github" className="h-5 w-5" />
              </a>
            </div>
          </div>

          {/* link groups */}
          <div className="grid grid-cols-2 gap-x-10 gap-y-6 sm:grid-cols-3 md:gap-x-14">
            <LinkGroup title="Product" links={PRODUCT} active={p} />
            <LinkGroup title="Community" links={COMMUNITY} active={p} />
            <LinkGroup title="Company" links={legal} active={p} />
          </div>
        </div>

        {/* bottom bar */}
        <div className="mt-8 flex flex-col items-center justify-between gap-2 border-t border-slate-800/60 pt-5 sm:flex-row">
          <p className="text-xs text-slate-600">© {new Date().getFullYear()} TrustVault</p>
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-600">
            <span>Free</span><Dot /><span>Encrypted</span><Dot /><span>Permanent</span>
          </p>
        </div>
      </div>
    </footer>
  );
}

function Dot() {
  return <span className="h-1 w-1 rounded-full bg-slate-700" />;
}

function LinkGroup({ title, links, active }: { title: string; links: { href: string; label: string }[]; active: string }) {
  return (
    <div>
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{title}</h3>
      <ul className="mt-2.5 space-y-2">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className={`text-xs transition-colors hover:text-white ${active === l.href ? "font-medium text-white" : "text-slate-400"}`}>{l.label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
