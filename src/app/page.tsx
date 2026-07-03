"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/context/WalletContext";
import { LoginModal } from "@/components/LoginModal";
import { ArweaveTokenIcon } from "@/components/TokenIcon";
import { SiteHeader } from "@/components/SiteHeader";
import { Footer } from "@/components/Footer";
import { useIsMobileDevice } from "@/lib/useIsMobile";

// ── animated SVG icons (no emojis) ─────────────────────────────────────────────
// Each animates on hover of its card (the card carries `group`) AND when the card
// scrolls into view on touch devices (the card also gets `.gtv-in`) — so the icons
// feel alive on mobile where there's no hover.
const SVG = { className: "h-6 w-6", fill: "none", viewBox: "0 0 24 24", stroke: "currentColor", strokeWidth: 1.75 } as const;
const CENTER: React.CSSProperties = { transformBox: "fill-box", transformOrigin: "center" };

function PadlockIcon() {
  // A locked padlock at rest; on hover / in-view the keyhole gives way to rows of
  // masked dots inside the body — the contents become "encrypted".
  return (
    <svg {...SVG}>
      {/* body + closed shackle — always locked */}
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path strokeLinecap="round" d="M8 11V8a4 4 0 018 0v3" />
      {/* keyhole — fades out on hover */}
      <g style={CENTER} className="origin-center transition-opacity duration-200 group-hover:opacity-0 group-[.gtv-in]:opacity-0">
        <circle cx="12" cy="14.6" r="1.1" fill="currentColor" stroke="none" />
        <path strokeLinecap="round" d="M12 15.4v1.7" />
      </g>
      {/* encrypted contents — masked dots cascade in on hover */}
      <g fill="currentColor" stroke="none">
        <circle cx="8.4" cy="14.3" r="0.72" className="opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-[.gtv-in]:opacity-100" />
        <circle cx="10.8" cy="14.3" r="0.72" className="opacity-0 transition-opacity duration-200 [transition-delay:60ms] group-hover:opacity-100 group-[.gtv-in]:opacity-100" />
        <circle cx="13.2" cy="14.3" r="0.72" className="opacity-0 transition-opacity duration-200 [transition-delay:120ms] group-hover:opacity-100 group-[.gtv-in]:opacity-100" />
        <circle cx="15.6" cy="14.3" r="0.72" className="opacity-0 transition-opacity duration-200 [transition-delay:180ms] group-hover:opacity-100 group-[.gtv-in]:opacity-100" />
        <circle cx="9.6" cy="17.2" r="0.72" className="opacity-0 transition-opacity duration-200 [transition-delay:100ms] group-hover:opacity-100 group-[.gtv-in]:opacity-100" />
        <circle cx="12" cy="17.2" r="0.72" className="opacity-0 transition-opacity duration-200 [transition-delay:160ms] group-hover:opacity-100 group-[.gtv-in]:opacity-100" />
        <circle cx="14.4" cy="17.2" r="0.72" className="opacity-0 transition-opacity duration-200 [transition-delay:220ms] group-hover:opacity-100 group-[.gtv-in]:opacity-100" />
      </g>
    </svg>
  );
}

function TimeTrackIcon() {
  // A clock; on hover the hands advance exactly one hour (minute hand a full turn, hour
  // hand one mark) and rewind back when the hover ends — no infinite spin.
  const ORIG = { transformOrigin: "12px 12px", transformBox: "view-box" as const };
  return (
    <svg {...SVG}>
      <circle cx="12" cy="12" r="8.5" />
      <g style={ORIG} className="transition-transform duration-700 ease-out group-hover:rotate-[30deg] group-[.gtv-in]:rotate-[30deg]">
        <path strokeLinecap="round" d="M12 12h2.6" />
      </g>
      <g style={ORIG} className="transition-transform duration-700 ease-out group-hover:rotate-[360deg] group-[.gtv-in]:rotate-[360deg]">
        <path strokeLinecap="round" d="M12 12V6.8" />
      </g>
    </svg>
  );
}

function BoardColumnsIcon() {
  // Same three-column mark as the left sidebar's Boards icon (scaled up): the columns
  // spread apart and their corners round a touch on hover / in-view.
  return (
    <span className="flex h-6 w-6 items-center justify-center text-indigo-300">
      <span className="h-[18px] w-[7px] rounded-l-[3px] border-[1.5px] border-current transition-all duration-300 group-hover:-translate-x-0.5 group-hover:rounded-[2.5px] group-[.gtv-in]:-translate-x-0.5 group-[.gtv-in]:rounded-[2.5px]" />
      <span className="-ml-[1.5px] h-[18px] w-[7px] border-[1.5px] border-current transition-all duration-300 group-hover:rounded-[2.5px] group-[.gtv-in]:rounded-[2.5px]" />
      <span className="-ml-[1.5px] h-[18px] w-[7px] rounded-r-[3px] border-[1.5px] border-current transition-all duration-300 group-hover:translate-x-0.5 group-hover:rounded-[2.5px] group-[.gtv-in]:translate-x-0.5 group-[.gtv-in]:rounded-[2.5px]" />
    </span>
  );
}

function DocsIcon() {
  // Open book; a page turns from right to left on hover / in-view.
  return (
    <svg {...SVG}>
      <path strokeLinecap="round" d="M12 6.5v13" />
      <path strokeLinejoin="round" d="M12 6.5C10.3 5.5 7.8 5 5.5 5S3 5.3 3 5.3v11.7s1.2-.3 3.5-.3 4.8.8 5.5 1.8z" />
      <path strokeLinejoin="round" d="M12 6.5C13.7 5.5 16.2 5 18.5 5S21 5.3 21 5.3v11.7s-1.2-.3-3.5-.3-4.8.8-5.5 1.8z" />
      <path strokeLinejoin="round" style={{ transformBox: "fill-box", transformOrigin: "left center" }} className="transition-transform duration-500 ease-in-out group-hover:-scale-x-100 group-[.gtv-in]:-scale-x-100" d="M12 6.5C13.7 5.5 16.2 5 18.5 5S21 5.3 21 5.3v11.7s-1.2-.3-3.5-.3-4.8.8-5.5 1.8z" />
    </svg>
  );
}

function ChatIcon() {
  // Rounded bubble; typing dots fade in one by one on hover / in-view.
  return (
    <svg {...SVG}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 5h12a3 3 0 013 3v6a3 3 0 01-3 3H10l-4 3v-3a3 3 0 01-3-3V8a3 3 0 013-3z" />
      <g fill="currentColor" stroke="none">
        <circle cx="8.5" cy="11" r="1.05" className="opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-[.gtv-in]:opacity-100" />
        <circle cx="12" cy="11" r="1.05" className="opacity-0 transition-opacity duration-200 [transition-delay:120ms] group-hover:opacity-100 group-[.gtv-in]:opacity-100" />
        <circle cx="15.5" cy="11" r="1.05" className="opacity-0 transition-opacity duration-200 [transition-delay:240ms] group-hover:opacity-100 group-[.gtv-in]:opacity-100" />
      </g>
    </svg>
  );
}

function CalendarIcon() {
  // Calendar; two day-squares pop in on hover / in-view.
  return (
    <svg {...SVG}>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path strokeLinecap="round" d="M3 9.5h18" />
      <path strokeLinecap="round" className="transition-transform duration-300 group-hover:-translate-y-0.5 group-[.gtv-in]:-translate-y-0.5" d="M8 3.5v3M16 3.5v3" />
      <rect x="6.75" y="12.5" width="4" height="4" rx="1" fill="currentColor" stroke="none" style={CENTER} className="scale-0 opacity-0 transition-all duration-300 group-hover:scale-100 group-hover:opacity-100 group-[.gtv-in]:scale-100 group-[.gtv-in]:opacity-100" />
      <rect x="13.25" y="12.5" width="4" height="4" rx="1" fill="currentColor" stroke="none" style={CENTER} className="scale-0 opacity-0 transition-all delay-100 duration-300 group-hover:scale-100 group-hover:opacity-100 group-[.gtv-in]:scale-100 group-[.gtv-in]:opacity-100" />
    </svg>
  );
}

function KeysIcon() {
  // Same key as the left sidebar's Access Keys icon — it jingles on hover / in-view.
  return (
    <svg {...SVG}>
      <g style={CENTER} className="group-hover:[animation:gtv-wiggle_0.5s_ease-in-out] group-[.gtv-in]:[animation:gtv-wiggle_0.5s_ease-in-out]">
        <circle cx="8" cy="16" r="4" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.8 13.2 20 4M16.5 7.5l2 2M14 10l2 2" />
      </g>
    </svg>
  );
}

function ServiceDeskIcon() {
  // Service Desk: a support headset with a boom microphone (matches the left-nav and ref chips).
  // On hover, sound waves radiate from the mic — two arcs that fade in one after the other.
  return (
    <svg {...SVG}>
      <g strokeLinecap="round">
        <path d="M12.6 20a2 2 0 0 1 0 3" className="opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        <path d="M14.4 18.8a3 3 0 0 1 0 4.6" className="opacity-0 transition-opacity duration-300 [transition-delay:120ms] group-hover:opacity-100" />
      </g>
      <path strokeLinecap="round" d="M5.5 13V11.5A6.5 6.5 0 0 1 18.5 11.5V13" />
      <rect x="3.7" y="12" width="3.5" height="5.5" rx="1.7" />
      <rect x="16.8" y="12" width="3.5" height="5.5" rx="1.7" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.45 17.5V19A2.3 2.3 0 0 0 7.75 21.3H8.2" />
      <rect x="8" y="19.8" width="3.2" height="3" rx="1.5" />
    </svg>
  );
}

function DepmIcon() {
  // DePM: a kanban board with an "eye" — public, transparent progress. The eye blinks open on hover.
  return (
    <svg {...SVG}>
      <rect x="3" y="4" width="18" height="12" rx="2.5" />
      <path strokeLinecap="round" d="M8 4v12M14 4v12" />
      <g className="transition-opacity duration-300 group-hover:opacity-100" style={{ opacity: 0.5 }}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.5 20s2.5-3 8.5-3 8.5 3 8.5 3" />
        <circle cx="12" cy="20" r="1.6" />
      </g>
    </svg>
  );
}

const FEATURES: { Icon: () => React.ReactNode; title: string; description: string }[] = [
  { Icon: PadlockIcon, title: "End-to-end encrypted", description: "Scrambled in your browser — only you hold the key." },
  { Icon: TimeTrackIcon, title: "Time tracking", description: "Log the hours you work on each board." },
  { Icon: BoardColumnsIcon, title: "Boards", description: "Multi-project Kanban with tickets and time tracking." },
  { Icon: ServiceDeskIcon, title: "Service Desk", description: "Create and solve Incidents, requests, changes & problems." },
  { Icon: DocsIcon, title: "Docs & whiteboards", description: "Rich-text pages, attachments and whiteboards." },
  { Icon: ChatIcon, title: "Encrypted chat", description: "Group chats, encrypted to each member." },
  { Icon: CalendarIcon, title: "Calendar & meetings", description: "Events, reminders and instant meeting links." },
  { Icon: KeysIcon, title: "Share by Access Keys", description: "Grant and revoke access, per person." },
  { Icon: DepmIcon, title: "DePM — public progress", description: "Publish a board so investors see real on-chain progress, not marketing." },
];

// ── "Why" band — big, layered 3D icons (depth via translateZ inside the tilt card,
// which provides the perspective + preserve-3d). They also react on hover / in-view.
function GiftIcon3D() {
  // A free gift; the lid lifts off in 3D on hover / in-view.
  return (
    <span className="relative block h-12 w-12 text-indigo-300 [transform-style:preserve-3d]">
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinejoin="round" className="absolute inset-0 h-full w-full" style={{ transform: "translateZ(8px)" }}>
        <rect x="11" y="23" width="26" height="16" rx="2.5" />
        <path strokeLinecap="round" d="M24 23v16" />
      </svg>
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinejoin="round" className="absolute inset-0 h-full w-full transition-transform duration-300 ease-out group-hover:-translate-y-[3px] group-[.gtv-in]:-translate-y-[3px]" style={{ transform: "translateZ(22px)" }}>
        <rect x="9" y="17" width="30" height="8" rx="2" />
        <path strokeLinecap="round" d="M24 17c-1.5-5.4-8.5-5.4-8.5-1.3 0 2.9 4.5 1.3 8.5 1.3zM24 17c1.5-5.4 8.5-5.4 8.5-1.3 0 2.9-4.5 1.3-8.5 1.3z" />
      </svg>
    </span>
  );
}
function StackIcon3D() {
  // Three layers floating in depth that fan apart on hover / in-view = "all in one".
  return (
    <span className="relative block h-12 w-12 text-indigo-300 [transform-style:preserve-3d]">
      <span className="absolute left-1/2 top-1/2 h-[26px] w-[38px] rounded-md border-2 border-current bg-slate-950/70 opacity-40 transition-transform duration-300 ease-out [transform:translate(-50%,-50%)_translateZ(4px)_translateY(8px)] group-hover:[transform:translate(-50%,-50%)_translateZ(4px)_translateY(13px)] group-[.gtv-in]:[transform:translate(-50%,-50%)_translateZ(4px)_translateY(13px)]" />
      <span className="absolute left-1/2 top-1/2 h-[26px] w-[38px] rounded-md border-2 border-current bg-slate-950/70 opacity-70 [transform:translate(-50%,-50%)_translateZ(15px)]" />
      <span className="absolute left-1/2 top-1/2 h-[26px] w-[38px] rounded-md border-2 border-current bg-slate-950/80 transition-transform duration-300 ease-out [transform:translate(-50%,-50%)_translateZ(26px)_translateY(-8px)] group-hover:[transform:translate(-50%,-50%)_translateZ(26px)_translateY(-13px)] group-[.gtv-in]:[transform:translate(-50%,-50%)_translateZ(26px)_translateY(-13px)]" />
    </span>
  );
}
function PersonGlyph({ big }: { big?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={big ? "h-9 w-9" : "h-7 w-7"} fill="none" stroke="currentColor" strokeWidth={2.1}>
      <circle cx="12" cy="8" r="3.3" />
      <path strokeLinecap="round" d="M5.5 19.5c0-3.7 2.9-6.2 6.5-6.2s6.5 2.5 6.5 6.2" />
    </svg>
  );
}
function TeamIcon3D() {
  // A team: two members flank a raised one; they spread out in 3D on hover / in-view.
  return (
    <span className="relative block h-12 w-12 text-indigo-300 [transform-style:preserve-3d]">
      <span className="absolute left-1/2 top-1/2 opacity-70 transition-transform duration-300 ease-out [transform:translate(-50%,-50%)_translateZ(5px)_translateX(-12px)] group-hover:[transform:translate(-50%,-50%)_translateZ(5px)_translateX(-16px)] group-[.gtv-in]:[transform:translate(-50%,-50%)_translateZ(5px)_translateX(-16px)]"><PersonGlyph /></span>
      <span className="absolute left-1/2 top-1/2 opacity-70 transition-transform duration-300 ease-out [transform:translate(-50%,-50%)_translateZ(5px)_translateX(12px)] group-hover:[transform:translate(-50%,-50%)_translateZ(5px)_translateX(16px)] group-[.gtv-in]:[transform:translate(-50%,-50%)_translateZ(5px)_translateX(16px)]"><PersonGlyph /></span>
      <span className="absolute left-1/2 top-1/2 text-indigo-200 transition-transform duration-300 ease-out [transform:translate(-50%,-50%)_translateZ(24px)] group-hover:[transform:translate(-50%,-50%)_translateZ(24px)_translateY(-3px)] group-[.gtv-in]:[transform:translate(-50%,-50%)_translateZ(24px)_translateY(-3px)]"><PersonGlyph big /></span>
    </span>
  );
}

const VALUES: { Icon: () => React.ReactNode; title: string; body: string }[] = [
  { Icon: GiftIcon3D, title: "Free, no subscription", body: "Free to use — no monthly fee. You only pay to keep files in the vault." },
  { Icon: StackIcon3D, title: "All-in-one", body: "Boards, timesheet, a service desk, docs, chat, calendar and a vault." },
  { Icon: TeamIcon3D, title: "For every company", body: "From a family to a startup — invite your team and share what matters." },
];

// ── How it works ───────────────────────────────────────────────────────────────
// Bold, filled white glyphs (on a gradient tile) — deliberately a different, more
// modern style from the thin line-art feature icons above.
function StepConnect() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none">
      <rect x="3" y="6" width="18" height="13" rx="3" fill="#fff" />
      <path d="M3 9.5h18" stroke="#4f46e5" strokeWidth="1.3" opacity="0.25" />
      <rect x="14.3" y="10.8" width="5.4" height="4.4" rx="1.3" fill="#4f46e5" opacity="0.9" />
      <circle cx="17" cy="13" r="0.95" fill="#fff" />
    </svg>
  );
}
function StepEncrypt() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none">
      <path d="M7 10V8a5 5 0 0 1 10 0v2" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <rect x="4.5" y="10" width="15" height="10.5" rx="3" fill="#fff" />
      <circle cx="12" cy="14.4" r="1.5" fill="#4f46e5" />
      <rect x="11.1" y="15" width="1.8" height="3.3" rx="0.9" fill="#4f46e5" />
    </svg>
  );
}
function StepShare() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none">
      <path d="M7.6 11l8.8-4.4M7.6 13l8.8 4.4" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="6" cy="12" r="3.2" fill="#fff" />
      <circle cx="18" cy="6" r="3.2" fill="#fff" />
      <circle cx="18" cy="18" r="3.2" fill="#fff" />
    </svg>
  );
}

const STEPS: { Icon: () => React.ReactNode; title: string; description: string }[] = [
  { Icon: StepConnect, title: "Create an account", description: "Face ID, Touch ID — no extension, no password. Or connect a wallet." },
  { Icon: StepEncrypt, title: "Create — it's all free", description: "Build boards, docs, chat and more — free, and encrypted to you." },
  { Icon: StepShare, title: "Share & keep it safe", description: "Invite your team and share securely. Only the vault costs a little, once." },
];

// ── Marquee assurances (each with its own little icon) ─────────────────────────
const mi = "h-4 w-4 shrink-0 text-indigo-300";
function IcLock() { return <svg className={mi} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><rect x="5" y="11" width="14" height="9" rx="2" /><path strokeLinecap="round" d="M8 11V8a4 4 0 018 0v3" /></svg>; }
function IcServerOff() { return <svg className={mi} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><rect x="4" y="4.5" width="16" height="6" rx="1.5" /><rect x="4" y="13.5" width="16" height="6" rx="1.5" /><path strokeLinecap="round" d="M4 4l16 16" /></svg>; }
function IcWallet() { return <svg className={mi} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M3 9.5h18" opacity="0.45" /><rect x="14.3" y="10.8" width="5.4" height="4.4" rx="1.3" fill="currentColor" stroke="none" /></svg>; }
function IcInfinity() { return <svg className={mi} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M5 12c0-2 1.5-3.5 3.5-3.5S12 12 12 12s1.5 3.5 3.5 3.5S19 14 19 12s-1.5-3.5-3.5-3.5S12 12 12 12s-1.5 3.5-3.5 3.5S5 14 5 12z" /></svg>; }
function IcTag() { return <svg className={mi} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinejoin="round" d="M3.6 3.6h7.2l9.6 9.6-7.2 7.2-9.6-9.6z" /><circle cx="7.6" cy="7.6" r="1.2" /></svg>; }
function IcLayers() { return <svg className={mi} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round"><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /></svg>; }
function IcKey() { return <svg className={mi} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><circle cx="8" cy="15" r="4" /><path strokeLinecap="round" strokeLinejoin="round" d="M10.8 12.2 20 3M16.5 6.5l2 2M14 9l2 2" /></svg>; }
function IcShield() { return <svg className={mi} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinejoin="round" d="M12 3l7 2.5v5.5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V5.5L12 3z" /><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4" /></svg>; }

// Phrases that complete "TrustVault is ___" — shown one at a time in the vertical word-flipper.
const FLIPS: { Icon: () => React.ReactNode; text: string }[] = [
  { Icon: IcTag, text: "free, no subscription" },
  { Icon: IcLayers, text: "an all-in-one workspace" },
  { Icon: IcLock, text: "end-to-end encrypted" },
  { Icon: IcInfinity, text: "kept on Arweave, forever" },
  { Icon: IcServerOff, text: "serverless — no middleman" },
  { Icon: IcKey, text: "shared by Access Keys" },
  { Icon: IcWallet, text: "owned by your wallet" },
  { Icon: IcShield, text: "no accounts, no passwords" },
];

// Vertical "slot-machine" flipper: the phrase + its icon roll up every couple of seconds. A duplicate
// of the first item is appended so the loop from last→first is seamless (snap back with no transition).
function BeyondCard({ icon, title, children, cta, onClick, delay }: { icon: React.ReactNode; title: string; children: React.ReactNode; cta: string; onClick: () => void; delay: number }) {
  return (
    <div className="gtv-reveal gtv-3d group flex flex-col rounded-2xl border border-slate-800 bg-slate-900/50 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-indigo-500/40 hover:bg-slate-900/70" style={{ transitionDelay: `${delay}ms` }}>
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-violet-900/40 ring-1 ring-white/10 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:rotate-3">
        {icon}
      </span>
      <h3 className="mt-5 text-xl font-bold tracking-tight text-white">{title}</h3>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-400">{children}</p>
      <button onClick={onClick} className="group/btn mt-5 inline-flex items-center gap-1.5 self-start text-sm font-semibold text-indigo-300 hover:text-indigo-200">
        {cta}
        <svg className="h-4 w-4 transition-transform group-hover/btn:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" /></svg>
      </button>
    </div>
  );
}

// "Decrypting" letter animation: each letter scrambles through RANDOM letters (so it reads like
// ciphertext), then locks onto the target — one by one, since each letter scrambles for a different,
// random number of ticks. Non-letters resolve instantly; respects prefers-reduced-motion.
function useRoulette(target: string): string {
  const [display, setDisplay] = useState(target);
  useEffect(() => {
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setDisplay(target); return; }
    const isUpper = (c: string) => c >= "A" && c <= "Z";
    const isLower = (c: string) => c >= "a" && c <= "z";
    const rand = (upper?: boolean) => String.fromCharCode((upper ? 65 : 97) + Math.floor(Math.random() * 26));
    type Cell = { fixed?: string; upper: boolean; tgt: string; scramble: number; cur: string; done: boolean };
    const cells: Cell[] = [...target].map((c) => {
      if (!isUpper(c) && !isLower(c)) return { fixed: c, upper: false, tgt: c, scramble: 0, cur: c, done: true };
      const upper = isUpper(c);
      const scramble = 4 + Math.floor(Math.random() * 16); // staggered settle → letters lock one by one
      return { upper, tgt: c, scramble, cur: rand(upper), done: false };
    });
    const render = () => setDisplay(cells.map((s) => s.cur).join(""));
    render();
    let raf = 0, last = 0;
    const tick = (ts: number) => {
      if (ts - last >= 45) {
        last = ts;
        let all = true;
        for (const s of cells) {
          if (s.done) continue;
          all = false;
          if (s.scramble > 0) { s.scramble--; s.cur = rand(s.upper); }
          else { s.cur = s.tgt; s.done = true; }
        }
        render();
        if (all) return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return display;
}

function WordFlipper() {
  const [idx, setIdx] = useState(0);
  const cur = FLIPS[idx];
  const text = useRoulette(cur.text);
  useEffect(() => {
    const t = setInterval(() => setIdx((v) => (v + 1) % FLIPS.length), 3400);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex flex-col items-center justify-center gap-x-2.5 gap-y-1.5 px-6 text-center text-lg font-semibold tracking-tight text-white sm:flex-row sm:flex-wrap sm:text-2xl">
      <span className="text-slate-400">TrustVault is</span>
      <span className="inline-flex items-center gap-2 text-indigo-300">
        <span className="grid place-items-center">{cur.Icon()}</span>
        <span>{text}</span>
      </span>
    </div>
  );
}

// Features on the faces of a slowly-rotating 3D prism (one feature per side). It auto-rotates, pauses on
// hover, and you can drag to spin it (with momentum). All animation is driven directly on the DOM via a
// single rAF loop — no per-frame React re-renders — so it stays smooth. Mobile gets a simple list.
const FEAT_LIST = FEATURES.filter((f) => f.title !== "DePM — public progress");

// Short node captions shown under each feature icon (the long titles live in the mobile list).
const NODE_LABELS: Record<string, string> = {
  "End-to-end encrypted": "Encrypted",
  "Time tracking": "Timesheet",
  "Boards": "Boards",
  "Service Desk": "Service Desk",
  "Docs & whiteboards": "Documentation",
  "Encrypted chat": "Chat",
  "Calendar & meetings": "Calendar",
  "Share by Access Keys": "Access Keys",
};

// The TrustVault brand mark (shield + keyhole) — no wordmark — used as the network hub.
function HubMark() {
  return (
    <svg viewBox="0 0 64 64" className="h-12 w-12" aria-hidden>
      <path d="M32 11 L49 17.5 V31 C49 41.4 41.6 49.4 32 53 C22.4 49.4 15 41.4 15 31 V17.5 Z" fill="#fff" />
      <circle cx="32" cy="29" r="5.2" fill="#4338ca" />
      <path d="M30 30.5 H34 L35.6 43 H28.4 Z" fill="#4338ca" />
    </svg>
  );
}

// Hub-and-spoke network: every feature node is wired to the central brand mark by a flowing
// dashed link; hovering a node lights it (and its link) in the logo's indigo.
function FeatureNetwork() {
  const feats = FEAT_LIST; // 8 nodes
  const N = feats.length;
  const [hover, setHover] = useState<number | null>(null);
  const RX = 40, RY = 37; // ellipse radii (% of the box) the nodes sit on
  const pos = feats.map((_, i) => {
    const a = (i / N) * Math.PI * 2 - Math.PI / 2; // start at the top, go clockwise
    return { x: 50 + RX * Math.cos(a), y: 50 + RY * Math.sin(a) };
  });

  return (
    <>
      {/* desktop: the radial network */}
      <div className="relative mx-auto hidden h-[560px] w-full max-w-3xl select-none sm:block">
        {/* links — drawn behind the hub/nodes; dashes flow toward the centre like data */}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
          {pos.map((p, i) => {
            const on = hover === i;
            return (
              <line
                key={i}
                x1="50" y1="50" x2={p.x} y2={p.y}
                stroke={on ? "#818cf8" : "#3b4253"}
                strokeWidth={on ? 2 : 1.3}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                className={`gtv-netline ${on ? "gtv-netline-on" : ""}`}
                style={{ opacity: hover === null || on ? 1 : 0.3, transition: "stroke .2s ease, stroke-width .2s ease, opacity .2s ease" }}
              />
            );
          })}
        </svg>

        {/* hub — the brand mark, glowing, with no wordmark */}
        <div className="absolute left-1/2 top-1/2 z-10 flex h-24 w-24 -translate-x-1/2 -translate-y-1/2 items-center justify-center">
          <span aria-hidden className="gtv-halo absolute inset-0 rounded-full bg-indigo-500/30 blur-xl" />
          <span className="relative flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-indigo-500 to-indigo-700 shadow-[0_0_44px_6px_rgba(79,70,229,0.45)] ring-1 ring-inset ring-white/20">
            <HubMark />
          </span>
        </div>

        {/* nodes — icon + caption, lit on hover */}
        {feats.map((f, i) => {
          const on = hover === i;
          return (
            <div
              key={f.title}
              className="group absolute z-10 flex -translate-x-1/2 -translate-y-1/2 cursor-default flex-col items-center gap-2"
              style={{ left: `${pos[i].x}%`, top: `${pos[i].y}%` }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {/* boxed icon — the glyph carries its own sidebar-style animation (fires via `group-hover:`);
                  the box lights up indigo on hover to match the lit link. */}
              <span className={`flex h-16 w-16 items-center justify-center rounded-2xl border bg-slate-950/80 ring-1 ring-inset ring-white/5 transition-all duration-200 ${on ? "border-indigo-400 text-indigo-200 shadow-[0_0_26px_3px_rgba(129,140,248,0.4)]" : "border-indigo-500/25 text-indigo-300"}`}>
                <span className="scale-[1.5]"><f.Icon /></span>
              </span>
              <span className={`text-xs font-semibold tracking-tight transition-colors duration-200 ${on ? "text-white" : "text-slate-400"}`}>
                {NODE_LABELS[f.title] ?? f.title}
              </span>
            </div>
          );
        })}
      </div>

      {/* mobile: a clean list */}
      <div className="space-y-3 sm:hidden">
        {feats.map((f) => (
          <div key={f.title} className="flex items-center gap-4 rounded-xl border border-indigo-500/20 bg-slate-900/50 p-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/25 to-violet-500/10 text-indigo-300 ring-1 ring-inset ring-indigo-500/25"><span className="scale-[1.45]"><f.Icon /></span></span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-white">{f.title}</h3>
              <p className="mt-0.5 text-sm leading-relaxed text-slate-400">{f.description}</p>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export default function LandingPage() {
  const { isConnected, isConnecting, isReady } = useWallet();
  const router = useRouter();
  const isMobile = useIsMobileDevice();
  const progressRef = useRef<HTMLDivElement>(null);
  const [loginOpen, setLoginOpen] = useState(false);

  // The landing page is viewable whether or not you're signed in, so a connected user can
  // come back to the home page (e.g. to reach the footer). Connected visitors just get an
  // "Open dashboard" CTA instead of "Get started".
  const showContent = isReady;

  // Set up once the landing is actually rendered:
  //  • reveal sections as they enter the viewport (all devices),
  //  • on touch devices, play a card's icon animation only when the user TAPS it
  //    (briefly add `.gtv-in`) — never from merely scrolling past,
  //  • drive the top progress bar.
  useEffect(() => {
    if (!showContent) return;
    const supported = typeof IntersectionObserver !== "undefined";
    const reveals = Array.from(document.querySelectorAll<HTMLElement>(".gtv-reveal"));
    let io: IntersectionObserver | null = null;
    if (supported) {
      io = new IntersectionObserver(
        (entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io?.unobserve(e.target); } }),
        { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
      );
      reveals.forEach((el) => io!.observe(el));
    } else {
      reveals.forEach((el) => el.classList.add("in"));
    }

    // Touch: animate a card's icon on tap only (it reverts shortly after), so nothing
    // looks "stuck hovering" while scrolling.
    const touch = typeof window !== "undefined" && window.matchMedia?.("(hover: none)").matches;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const onTap = (e: Event) => {
      const card = (e.target as HTMLElement | null)?.closest?.(".gtv-activate");
      if (!card) return;
      card.classList.add("gtv-in");
      const t = setTimeout(() => { card.classList.remove("gtv-in"); timers.delete(t); }, 1100);
      timers.add(t);
    };
    if (touch) document.addEventListener("pointerdown", onTap, { passive: true });

    const onScroll = () => {
      const bar = progressRef.current;
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      if (bar) bar.style.width = max > 0 ? `${(h.scrollTop / max) * 100}%` : "0%";
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      io?.disconnect();
      if (touch) document.removeEventListener("pointerdown", onTap);
      timers.forEach(clearTimeout);
      window.removeEventListener("scroll", onScroll);
    };
  }, [showContent]);

  // Only send the user into the app when they actively ask to enter (CTA / sign-in) — not just
  // for being connected, so returning here stays on the landing page.
  const enteringApp = useRef(false);
  useEffect(() => {
    if (isReady && isConnected && enteringApp.current) { enteringApp.current = false; router.replace("/dashboard"); }
  }, [isReady, isConnected, router]);

  const handleCTA = () => {
    if (isConnected) { router.push("/dashboard"); return; }
    enteringApp.current = true;
    setLoginOpen(true); // once sign-in completes, the effect above navigates into the app
  };

  // While the wallet restore is still settling, show a neutral screen.
  if (!showContent) return <div className="min-h-screen bg-slate-950" />;

  return (
    <div
      onPointerMove={(e) => {
        // Cheap cursor-follow lighting: write the pointer position to CSS vars (no re-render).
        const el = e.currentTarget;
        el.style.setProperty("--gx", `${e.clientX}px`);
        el.style.setProperty("--gy", `${e.clientY}px`);
        el.style.setProperty("--px", `${(e.clientX / window.innerWidth - 0.5) * 2}`);
        el.style.setProperty("--py", `${(e.clientY / window.innerHeight - 0.5) * 2}`);
      }}
      className="relative flex min-h-screen flex-col overflow-hidden bg-slate-950 [--px:0] [--py:0]"
    >
      {loginOpen && <LoginModal onClose={() => setLoginOpen(false)} />}
      {/* top scroll-progress bar */}
      <div ref={progressRef} aria-hidden className="fixed left-0 top-0 z-[60] h-0.5 w-0 bg-gradient-to-r from-indigo-500 via-violet-400 to-sky-400 transition-[width] duration-150 ease-out" />

      <style>{`
        @keyframes gtv-float { 0%,100%{transform:translate(0,0)} 50%{transform:translate(0,-22px)} }
        @keyframes gtv-up { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
        @keyframes gtv-shimmer { from{background-position:0% 50%} to{background-position:200% 50%} }
        @keyframes gtv-marquee { from{transform:translateX(0)} to{transform:translateX(-50%)} }
        /* infinity icon: path is normalized to pathLength=100, so a 25/75 dash loops
           perfectly seamlessly; gtv-idraw "writes" the whole stroke (offset 100→0). */
        @keyframes gtv-itravel { from { stroke-dashoffset:0 } to { stroke-dashoffset:-100 } }
        @keyframes gtv-idraw { from { stroke-dashoffset:100 } to { stroke-dashoffset:0 } }
        @keyframes gtv-flow { to { stroke-dashoffset:-11 } }
        .gtv-flowline{stroke-dasharray:1.5 4;animation:gtv-flow .9s linear infinite}
        .gtv-up{opacity:0;animation:gtv-up .6s cubic-bezier(.2,.7,.2,1) forwards}
        .gtv-grad{background-image:linear-gradient(90deg,#818cf8,#a78bfa,#38bdf8,#a78bfa,#818cf8);background-size:200% auto;-webkit-background-clip:text;background-clip:text;color:transparent;animation:gtv-shimmer 7s linear infinite}
        .gtv-tilt{transform:perspective(900px) rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg)) translateZ(0);transform-style:preserve-3d;transition:transform .18s ease-out}
        .gtv-reveal{opacity:0;transform:translateY(26px);transition:opacity .7s cubic-bezier(.2,.7,.2,1),transform .7s cubic-bezier(.2,.7,.2,1)}
        .gtv-reveal.in{opacity:1;transform:none}
        /* 3D variant: cards swing up with a rotateX flip (origin at the bottom) as they enter view */
        .gtv-reveal.gtv-3d{transform:perspective(1100px) rotateX(18deg) translateY(34px);transform-origin:50% 100%}
        .gtv-reveal.gtv-3d.in{transform:perspective(1100px) rotateX(0) translateY(0)}
        /* feature node-network: links flow like data; nodes bob; popover fades in */
        @keyframes gtv-netflow{to{stroke-dashoffset:-20}}
        @keyframes gtv-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
        @keyframes gtv-pop{from{opacity:0}to{opacity:1}}
        @keyframes gtv-halo{0%,100%{opacity:.45;transform:scale(1)}50%{opacity:.85;transform:scale(1.14)}}
        .gtv-netline{stroke-dasharray:2 4;animation:gtv-netflow 1.6s linear infinite}
        .gtv-netline-on{animation-duration:.7s}
        .gtv-bob{animation:gtv-bob 4s ease-in-out infinite}
        .gtv-pop{animation:gtv-pop .18s ease-out}
        .gtv-halo{animation:gtv-halo 3.5s ease-in-out infinite}
        .gtv-marquee-track{animation:gtv-marquee 30s linear infinite}
        .gtv-marquee-track:hover{animation-play-state:paused}
        @media (prefers-reduced-motion: reduce){
          .gtv-grad,.gtv-marquee-track,.gtv-flowline{animation:none}
          .gtv-tilt{transition:none}
          .gtv-reveal,.gtv-reveal.gtv-3d,.gtv-reveal.gtv-3d.in{opacity:1;transform:none}
          .gtv-netline,.gtv-bob,.gtv-halo{animation:none}
        }
      `}</style>

      {/* animated background glow + grid — FIXED to the viewport so the cursor-follow
          spotlight (which reads viewport clientX/clientY) stays correct while scrolling. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -left-32 -top-40 h-[28rem] w-[28rem] rounded-full bg-indigo-600/20 blur-3xl" style={{ animation: "gtv-float 9s ease-in-out infinite", transform: "translate(calc(var(--px) * 24px), calc(var(--py) * 24px))" }} />
        <div className="absolute right-0 top-24 h-[26rem] w-[26rem] rounded-full bg-violet-600/15 blur-3xl" style={{ animation: "gtv-float 12s ease-in-out infinite reverse", transform: "translate(calc(var(--px) * -30px), calc(var(--py) * -18px))" }} />
        <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-sky-600/10 blur-3xl" style={{ animation: "gtv-float 10s ease-in-out infinite", transform: "translate(calc(var(--px) * 18px), calc(var(--py) * -22px))" }} />
        <div className="absolute inset-0 opacity-[0.04] [background-image:linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] [background-size:42px_42px]" style={{ transform: "translate(calc(var(--px) * -10px), calc(var(--py) * -10px))" }} />
        <div className="absolute inset-0 opacity-80" style={{ background: "radial-gradient(400px circle at var(--gx, 50%) var(--gy, 30%), rgba(99,102,241,0.13), transparent 62%)" }} />
      </div>

      {/* Nav — shared header (Sign in when logged out; balance + account switcher when logged in) */}
      <SiteHeader />

      <main className="relative z-10 flex-1">
        {/* Hero */}
        <section className="mx-auto max-w-4xl px-6 pb-16 pt-24 text-center sm:pt-28">
          <span className="gtv-up inline-block rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-indigo-300" style={{ animationDelay: "0ms" }}>
            Free · Encrypted · Permanent
          </span>
          <h1 className="gtv-up mt-5 text-4xl font-extrabold leading-[1.1] tracking-tight text-white sm:text-6xl" style={{ animationDelay: "80ms" }}>
            Your private workspace,
            <br />
            <span className="gtv-grad">kept forever.</span>
          </h1>
          <p className="gtv-up mx-auto mt-6 max-w-xl text-base leading-relaxed text-slate-400 sm:text-lg" style={{ animationDelay: "160ms" }}>
            The all-in-one encrypted workspace for any team — private, free to use, and saved on-chain for life.
          </p>
          <div className="gtv-up mt-9 flex flex-col items-center gap-4" style={{ animationDelay: "240ms" }}>
            {isMobile ? (
              <MobileComingSoon onHelp={() => router.push("/help")} />
            ) : (
              <>
                <div className="flex flex-col items-center gap-3 sm:flex-row">
                  <button
                    onClick={handleCTA}
                    disabled={isConnecting}
                    className="group inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-indigo-900/40 transition-all hover:-translate-y-0.5 hover:bg-indigo-500 disabled:translate-y-0 disabled:opacity-60"
                  >
                    {isConnecting ? (<><Spinner /> Connecting…</>) : isConnected ? "Open dashboard" : "Get started"}
                    {!isConnecting && <svg className="h-4 w-4 transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" /></svg>}
                  </button>
                  <button onClick={() => router.push("/help")} className="rounded-xl border border-slate-700 px-6 py-3.5 text-base font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-white">
                    Documentation
                  </button>
                </div>
                <p className="text-xs text-slate-600">
                  Requires a{" "}
                  <a href="https://www.wander.app" target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-400">Wander</a>{" "}
                  (Arweave) wallet — connect once, no account or password.
                </p>
              </>
            )}
          </div>
        </section>

        {/* Why TrustVault — free, all-in-one, for any company. Big 3D-animated icons. */}
        <section className="border-y border-slate-800/70 bg-slate-900/30">
          <div className="mx-auto max-w-5xl px-6 py-20">
            <div className="gtv-reveal mx-auto max-w-2xl text-center">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.6}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                Free · No subscription
              </span>
              <h2 className="mt-4 text-2xl font-bold tracking-tight text-white sm:text-3xl">One workspace for your whole company — free</h2>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-slate-400 sm:text-base">No crypto know-how, no monthly bill. TrustVault replaces a stack of paid apps with one private, all-in-one workspace any team can use — saved on-chain.</p>
            </div>
            <div className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-3">
              {VALUES.map((v, i) => (
                <div key={v.title} className="gtv-reveal" style={{ transitionDelay: `${i * 90}ms` }}>
                  <TiltCard className="group gtv-activate relative flex h-full flex-col items-center rounded-2xl border border-slate-800 bg-slate-950/40 p-7 text-center transition-colors hover:border-indigo-500/40 hover:bg-slate-950/70">
                    <span aria-hidden className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100" style={{ background: "radial-gradient(220px circle at var(--mx,50%) var(--my,50%), rgba(99,102,241,0.14), transparent 60%)" }} />
                    <span className="flex h-20 w-20 items-center justify-center rounded-2xl bg-indigo-500/10 ring-1 ring-inset ring-indigo-500/20 [transform-style:preserve-3d]" style={{ transform: "translateZ(34px)" }}>
                      <v.Icon />
                    </span>
                    <h3 className="relative mt-5 text-base font-semibold text-white" style={{ transform: "translateZ(20px)" }}>{v.title}</h3>
                    <p className="relative mt-2 text-sm leading-relaxed text-slate-400" style={{ transform: "translateZ(10px)" }}>{v.body}</p>
                  </TiltCard>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features — each card tilts in 3D toward the cursor with a pointer spotlight */}
        {/* Everything in one vault — feature grid: big animated icons + a border that draws itself
            (an SVG stroke) as each card scrolls into view. */}
        <section className="mx-auto max-w-6xl px-6 pb-20 pt-16">
          <div className="gtv-reveal mx-auto mb-12 max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Everything in one private vault</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-slate-400 sm:text-base">A full workspace — not just file storage — encrypted to you, backed up on-chain, and shared only by your choice.</p>
          </div>
          <FeatureNetwork />
        </section>

        {/* Value strip — a vertical word-flipper */}
        <section className="pb-20">
          <div className="border-y border-slate-800/70 bg-slate-900/30 py-9">
            <WordFlipper />
          </div>
        </section>

        {/* How it works */}
        <section className="mx-auto max-w-5xl px-6 pb-24">
          <div className="gtv-reveal text-center">
            <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">How it works</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-slate-400 sm:text-base">No accounts, no servers, no lock-in — three steps, entirely from your browser.</p>
          </div>
          {/* A connected step-by-step flow — deliberately bolder & different from the
              feature grid: gradient tiles, numbers, and an animated link line between them. */}
          <div className="mt-14 flex flex-col items-stretch gap-8 sm:flex-row sm:items-start sm:gap-2">
            {STEPS.map((s, i) => (
              <Fragment key={s.title}>
                <div className="gtv-reveal group flex flex-1 flex-col items-center text-center" style={{ transitionDelay: `${i * 130}ms` }}>
                  <div className="relative transition-transform duration-300 ease-out group-hover:-translate-y-1 group-hover:scale-105">
                    <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-violet-900/40">
                      <s.Icon />
                    </span>
                    <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-slate-950 text-[11px] font-bold text-indigo-300 ring-2 ring-slate-800">{i + 1}</span>
                  </div>
                  <h3 className="mt-5 text-base font-semibold text-white">{s.title}</h3>
                  <p className="mt-2 max-w-xs text-sm leading-relaxed text-slate-400">{s.description}</p>
                </div>
                {i < STEPS.length - 1 && (
                  <div aria-hidden className="hidden shrink-0 items-center justify-center pt-7 sm:flex">
                    <svg className="h-4 w-12 text-indigo-500/70" viewBox="0 0 48 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path className="gtv-flowline" d="M2 8h40" />
                      <path d="M38 3l6 5-6 5" />
                    </svg>
                  </div>
                )}
              </Fragment>
            ))}
          </div>
          <div className="gtv-reveal mt-12 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            {!isMobile && (
              <button onClick={handleCTA} disabled={isConnecting} className="group inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-7 py-3 text-base font-semibold text-white shadow-lg shadow-indigo-900/40 transition-all hover:-translate-y-0.5 hover:bg-indigo-500 disabled:opacity-60">
                {isConnecting ? (<><Spinner /> Connecting…</>) : "Get started"}
              </button>
            )}
            <button onClick={() => router.push("/help")} className="rounded-xl border border-slate-700 px-6 py-3 text-base font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-white">
              Read the full guide
            </button>
          </div>
        </section>

        {/* Beyond the workspace — DePM, governance, forum */}
        <section className="relative overflow-hidden px-6 pb-28">
          {/* decorative background — soft colour glows + faint grid (kills the dull flat look) */}
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute left-[15%] top-0 h-80 w-80 -translate-x-1/2 rounded-full bg-indigo-600/20 blur-[110px]" />
            <div className="absolute right-[12%] bottom-4 h-80 w-80 translate-x-1/2 rounded-full bg-violet-600/15 blur-[110px]" />
          </div>

          <div className="relative mx-auto max-w-6xl">
            <div className="gtv-reveal gtv-3d mx-auto mb-12 max-w-2xl text-center">
              <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-indigo-300">Open &amp; on-chain</span>
              <h2 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">More than a workspace</h2>
              <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-slate-400">TrustVault is transparent and community-run — prove your real progress, help steer the project, and shape it with your feedback.</p>
            </div>

            {/* DePM spotlight */}
            <div className="gtv-reveal gtv-3d group relative overflow-hidden rounded-3xl border border-indigo-500/25 bg-gradient-to-br from-indigo-600/15 via-slate-900/70 to-slate-900/70 p-8 shadow-2xl shadow-indigo-950/40 sm:p-10" style={{ transitionDelay: "80ms" }}>
              <div aria-hidden className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-indigo-500/20 blur-3xl transition-opacity duration-500 group-hover:opacity-150" />
              <div className="relative flex flex-col items-start gap-7 md:flex-row md:items-center">
                <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-xl shadow-indigo-900/50 ring-1 ring-white/15 transition-transform duration-300 group-hover:-translate-y-1 group-hover:rotate-3">
                  <svg className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                    <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
                    <path strokeLinecap="round" d="M9 4.5v15M15 4.5v15" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 9h2M5 12.5h2M11 9h2M16.4 10.2l1.3 1.3 2.3-2.6" />
                  </svg>
                </span>
                <div className="min-w-0 flex-1">
                  <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-indigo-300">DePM · Decentralized Project Management</span>
                  <h3 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl">Prove your progress — don&apos;t just promise it</h3>
                  <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-300">Crypto roadmaps are usually marketing. With DePM you publish a board&apos;s real progress — columns, ticket titles and how much is actually done — so investors and users see the true state of a project, updated live and tamper-evident on Arweave.</p>
                  <button onClick={() => router.push("/projects")} className="group/btn mt-5 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-indigo-900/40 transition-all hover:-translate-y-0.5 hover:bg-indigo-500">
                    Explore public projects
                    <svg className="h-4 w-4 transition-transform group-hover/btn:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" /></svg>
                  </button>
                </div>
              </div>
            </div>

            {/* Governance + Forum */}
            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <BeyondCard
                delay={160}
                title="Community governance"
                onClick={() => router.push("/governance")}
                cta="Open governance"
                icon={<svg className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}><path strokeLinejoin="round" d="M5 4.5h14a1 1 0 011 1V19a1 1 0 01-1 1H5a1 1 0 01-1-1V5.5a1 1 0 011-1z" /><path strokeLinecap="round" strokeLinejoin="round" d="M8.5 12.3l2.4 2.4 4.8-5.4" /></svg>}
              >
                Free, <strong className="text-slate-200">one wallet, one vote</strong>. Help decide what gets built next — no token, no gas, no cost.
              </BeyondCard>
              <BeyondCard
                delay={240}
                title="Forum & feedback"
                onClick={() => router.push("/forum")}
                cta="Join the forum"
                icon={<svg className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6.5A2.5 2.5 0 016.5 4h7A2.5 2.5 0 0116 6.5v3A2.5 2.5 0 0113.5 12H9l-3.5 2.5V12A2.5 2.5 0 014 9.5v-3z" /><path strokeLinecap="round" strokeLinejoin="round" d="M9 14.8v.2a3 3 0 003 3h3.5L19 20.5V18a3 3 0 002-2.8V13" /></svg>}
              >
                Tell us what to build, report issues and shape the roadmap with the community — public and on-chain.
              </BeyondCard>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

// A card that tilts in 3D toward the cursor and exposes the pointer position as CSS
// vars (--mx/--my) for a follow-the-mouse spotlight. Reset on leave.
function TiltCard({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    el.style.setProperty("--ry", `${(px - 0.5) * 12}deg`);
    el.style.setProperty("--rx", `${(0.5 - py) * 10}deg`);
    el.style.setProperty("--mx", `${px * 100}%`);
    el.style.setProperty("--my", `${py * 100}%`);
  };
  const reset = () => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
  };
  return (
    <div ref={ref} onPointerMove={onMove} onPointerLeave={reset} className={`gtv-tilt ${className ?? ""}`}>
      {children}
    </div>
  );
}

function HeaderActions({ mobile }: { mobile?: boolean }) {
  const { address, balance, isConnected, isConnecting, disconnect } = useWallet();
  const router = useRouter();
  const [loginOpen, setLoginOpen] = useState(false);

  return (
    <div className="flex items-center gap-2.5">
      {loginOpen && <LoginModal onClose={() => setLoginOpen(false)} />}
      {isConnected && address ? (
        <>
          <span className="hidden items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-300 md:flex">
            <ArweaveTokenIcon /> {balance ?? "…"} AR
          </span>
          <button onClick={() => navigator.clipboard?.writeText(address)} title="Copy wallet address" className="group hidden items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 transition-colors hover:border-slate-500 md:flex">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="font-mono text-xs text-slate-300 transition-colors group-hover:text-white">{address.slice(0, 6)}…{address.slice(-4)}</span>
            <svg className="h-3.5 w-3.5 text-slate-500 transition-colors group-hover:text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 012-2h10" /></svg>
          </button>
          <button onClick={() => router.push("/dashboard")} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500">Open dashboard</button>
          <button onClick={() => disconnect()} title="Disconnect" aria-label="Disconnect" className="group flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 text-slate-500 transition-colors hover:border-red-800/60 hover:text-red-400">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 21H6a2 2 0 01-2-2V5a2 2 0 012-2h3" /><g className="transition-transform duration-300 group-hover:translate-x-0.5"><path strokeLinecap="round" strokeLinejoin="round" d="M16 17l5-5-5-5M21 12H9" /></g></svg>
          </button>
        </>
      ) : mobile ? null : (
        <button onClick={() => setLoginOpen(true)} disabled={isConnecting} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50">
          {isConnecting ? "Connecting…" : "Sign in"}
        </button>
      )}
    </div>
  );
}

// Mobile/tablet hero CTA: a wallet connect needs a desktop browser extension, so we
// surface a single "coming soon" line + the real App Store / Google Play badges.
function MobileComingSoon({ onHelp }: { onHelp: () => void }) {
  return (
    <div className="flex w-full flex-col items-center gap-4">
      <span className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-indigo-300">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path strokeLinecap="round" d="M11 18.5h2" /></svg>
        Mobile apps coming soon
      </span>
      <p className="max-w-xs text-sm leading-relaxed text-slate-400">
        TrustVault connects through a desktop-browser wallet today. Native iOS &amp; Android apps are on the way.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2.5 opacity-90">
        <AppStoreBadge />
        <GooglePlayBadge />
      </div>
      <button onClick={onHelp} className="mt-1 rounded-xl border border-slate-700 px-6 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-white">
        Documentation
      </button>
    </div>
  );
}

// The official "Download on the App Store" badge (Apple logo + text), as inline SVG.
function AppStoreBadge() {
  return (
    <svg viewBox="0 0 120 40" className="h-10 w-auto select-none" role="img" aria-label="Download on the App Store">
      <rect x="0.5" y="0.5" width="119" height="39" rx="6.5" fill="#000" stroke="#A6A6A6" strokeOpacity="0.5" />
      <path fill="#fff" d="M24.77 20.3c-.02-2.3 1.88-3.42 1.96-3.48-1.07-1.56-2.73-1.78-3.32-1.8-1.4-.14-2.76.83-3.48.83-.72 0-1.83-.81-3.01-.79-1.55.02-2.98.9-3.77 2.29-1.61 2.79-.41 6.91 1.15 9.18.76 1.11 1.67 2.35 2.86 2.31 1.15-.05 1.58-.74 2.97-.74 1.38 0 1.77.74 2.98.72 1.23-.02 2.01-1.12 2.76-2.24.87-1.28 1.23-2.54 1.25-2.6-.03-.01-2.39-.92-2.41-3.64z" />
      <path fill="#fff" d="M22.46 13.7c.64-.77 1.07-1.84.95-2.92-.92.04-2.03.61-2.69 1.38-.59.68-1.11 1.77-.97 2.81 1.03.08 2.07-.52 2.71-1.27z" />
      <text x="38" y="16.5" fill="#fff" fontFamily="Helvetica, Arial, sans-serif" fontSize="7">Download on the</text>
      <text x="37.5" y="30" fill="#fff" fontFamily="Helvetica, Arial, sans-serif" fontSize="15" fontWeight="600" letterSpacing="-0.3">App Store</text>
    </svg>
  );
}

// The official "Get it on Google Play" badge (4-colour play triangle + text).
function GooglePlayBadge() {
  return (
    <svg viewBox="0 0 135 40" className="h-10 w-auto select-none" role="img" aria-label="Get it on Google Play">
      <rect x="0.5" y="0.5" width="134" height="39" rx="6.5" fill="#000" stroke="#A6A6A6" strokeOpacity="0.5" />
      <g transform="translate(11.5 10.4)">
        <path fill="#00D3FF" d="M.46.65C.23.9.1 1.27.1 1.76v15.5c0 .49.13.86.37 1.1l.05.05 8.69-8.68v-.2L.5.6.46.65z" />
        <path fill="#FFD400" d="M12.1 12.63 9.21 9.74v-.2l2.89-2.89.07.04 3.43 1.95c.98.55.98 1.46 0 2.02l-3.43 1.95-.07.05z" />
        <path fill="#FF3B30" d="M12.17 12.59 9.21 9.64.46 18.4c.32.34.86.39 1.46.04l10.25-5.85" />
        <path fill="#00E676" d="M12.17 6.69 1.92.85C1.32.5.78.55.46.89L9.21 9.64l2.96-2.95z" />
      </g>
      <text x="34" y="15.5" fill="#fff" fontFamily="Helvetica, Arial, sans-serif" fontSize="6.5" letterSpacing="0.6">GET IT ON</text>
      <text x="33.5" y="30" fill="#fff" fontFamily="Helvetica, Arial, sans-serif" fontSize="14.5" fontWeight="600" letterSpacing="-0.3">Google Play</text>
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}
