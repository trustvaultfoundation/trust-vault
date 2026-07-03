"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import HelpPage from "@/app/help/page";
import UnlockPage from "@/app/unlock/page";
import { BrandWordmark } from "@/components/BrandWordmark";

// On the static Arweave/ArNS host every unresolved path (e.g. a reloaded /dashboard, which
// has no trailing-slash entry in the manifest) is served this page as the manifest FALLBACK.
// So this page doubles as the app's client-side router: for a real route it renders the right
// screen (which reads the URL itself), and only shows the 404 design for genuinely unknown paths.
const APP_ROUTES = new Set(["/dashboard", "/board", "/documentation", "/chat", "/calendar", "/timesheet", "/service-desk", "/profile", "/uploads", "/vault", "/view", "/access-keys", "/settings"]);

export default function NotFound() {
  const [route, setRoute] = useState<string | null>(null);
  useEffect(() => {
    setRoute((window.location.pathname.replace(/\/+$/, "") || "/").toLowerCase());
  }, []);

  // Before we know the path (and during static prerender), show a neutral screen — never a
  // flash of "404" on what is actually a valid app route.
  if (route === null) return <div className="min-h-screen bg-slate-950" />;
  if (APP_ROUTES.has(route)) return <AppShell />;
  if (route === "/help") return <HelpPage />;
  if (route === "/unlock") return <UnlockPage />;

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-slate-950 px-6 text-center">
      {/* themed background — mirrors the landing */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-40 h-[26rem] w-[26rem] rounded-full bg-indigo-600/15 blur-3xl" />
        <div className="absolute right-0 bottom-0 h-96 w-96 rounded-full bg-violet-600/10 blur-3xl" />
        <div className="absolute inset-0 opacity-[0.04] [background-image:linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] [background-size:42px_42px]" />
      </div>

      <div className="relative z-10 flex flex-col items-center">
        {/* brand mark */}
        <Link href="/" className="mb-8" aria-label="TrustVault home">
          <BrandWordmark />
        </Link>

        <p className="bg-gradient-to-br from-white via-indigo-200 to-violet-400 bg-clip-text text-7xl font-extrabold leading-none tracking-tight text-transparent sm:text-8xl">404</p>
        <h1 className="mt-5 text-2xl font-bold text-white sm:text-3xl">This page doesn&apos;t exist</h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-slate-400">
          The link may be broken, or the page may have moved. Your vault and everything in it are safe — let&apos;s get you back.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/" className="rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-900/30 transition-colors hover:bg-indigo-500">
            Back to home
          </Link>
          <Link href="/help" className="rounded-xl border border-slate-700 bg-slate-800/60 px-6 py-3 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 hover:text-white">
            Open the help guide
          </Link>
        </div>
      </div>

      <p className="relative z-10 mt-16 text-xs text-slate-600">
        Generational Trust Vault — encrypted &amp; permanent on Arweave
      </p>
    </div>
  );
}
