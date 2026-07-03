"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useWallet } from "@/context/WalletContext";
import { useChatUnread } from "@/lib/useChatUnread";
import { useItsmUnread } from "@/lib/useItsmUnread";

// The app's left navigation, as a standalone component so it can also appear on the public Help / Forum
// pages when the user is signed in (it self-hides when signed out). Mirrors the sidebar inside AppShell.
//
// NOTE: kept deliberately self-contained (its own icons + NavItem) rather than imported from AppShell,
// so importing it into the Help/Forum routes doesn't pull AppShell's heavy section views into those
// bundles. If a nav item changes, update both this and AppShell.

const SVG_PROPS = { className: "w-4 h-4", fill: "none", viewBox: "0 0 24 24", stroke: "currentColor", strokeWidth: 2 } as const;
const CENTER: React.CSSProperties = { transformBox: "fill-box", transformOrigin: "center" };
// Shared with AppShell's sidebar so the collapsed/expanded state is the same on every page.
const SIDEBAR_KEY = "gtv_sidebar_collapsed";

const ITEMS: { path: string; label: string; Icon: () => React.ReactNode; badge?: "chat" | "itsm" }[] = [
  { path: "/dashboard", label: "Dashboard", Icon: DashboardIcon },
  { path: "/board", label: "Board", Icon: BoardIcon },
  { path: "/documentation", label: "Documentation", Icon: DocsIcon },
  { path: "/chat", label: "Chat", Icon: ChatIcon, badge: "chat" },
  { path: "/calendar", label: "Calendar", Icon: CalendarIcon },
  { path: "/timesheet", label: "Timesheet", Icon: TimesheetIcon },
  { path: "/service-desk", label: "Service Desk", Icon: ITSMIcon, badge: "itsm" },
  { path: "/uploads", label: "Uploads", Icon: UploadsIcon },
  { path: "/vault", label: "Vault", Icon: VaultIcon },
  { path: "/view", label: "View Document", Icon: ViewIcon },
  { path: "/profile", label: "Profile", Icon: ProfileIcon },
  { path: "/access-keys", label: "Access Keys", Icon: KeysIcon },
  { path: "/settings", label: "Settings", Icon: SettingsIcon },
];

export function AppSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { address, isConnected } = useWallet();
  const chatUnread = useChatUnread(address);
  const itsmUnread = useItsmUnread(address);
  const [collapsed, setCollapsed] = useState(false);
  const [ready, setReady] = useState(false);
  // Apply the saved collapsed state FIRST with the width transition OFF (so it doesn't animate open→
  // collapsed on a fresh page load), then enable the transition on the next frame for real toggles.
  useEffect(() => {
    let saved = false;
    try { saved = localStorage.getItem(SIDEBAR_KEY) === "1"; } catch { /* ignore */ }
    setCollapsed(saved);
    document.documentElement.classList.toggle("gtv-sb-collapsed", saved);
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const toggle = () => setCollapsed((c) => {
    const n = !c;
    try { localStorage.setItem(SIDEBAR_KEY, n ? "1" : "0"); document.documentElement.classList.toggle("gtv-sb-collapsed", n); } catch { /* ignore */ }
    return n;
  });

  if (!isConnected) return null;
  const p = (pathname || "").replace(/\/+$/, "");

  return (
    <aside className={`gtv-sidebar ${collapsed ? "w-16" : "w-56"} shrink-0 border-r border-slate-800 bg-slate-950/40 px-3 py-6 flex flex-col gap-1 ${ready ? "transition-[width] duration-300" : ""}`}>
      {ITEMS.map((it) => (
        <NavItem
          key={it.path}
          icon={<it.Icon />}
          label={it.label}
          active={p === it.path}
          onClick={() => router.push(it.path)}
          collapsed={collapsed}
          badge={it.badge === "chat" ? chatUnread.total : it.badge === "itsm" ? itsmUnread.total : undefined}
        />
      ))}

      <div className={`mt-auto flex ${collapsed ? "justify-center" : "justify-end"}`}>
        <button
          onClick={toggle}
          title={collapsed ? "Expand menu" : "Collapse menu"}
          aria-label={collapsed ? "Expand menu" : "Collapse menu"}
          className="group flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 5v14" />
            {collapsed ? (
              <g className="transition-transform duration-300 group-hover:translate-x-0.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h11M16 8l4 4-4 4" /></g>
            ) : (
              <g className="transition-transform duration-300 group-hover:-translate-x-0.5"><path strokeLinecap="round" strokeLinejoin="round" d="M20 12H9M13 8l-4 4 4 4" /></g>
            )}
          </svg>
        </button>
      </div>
    </aside>
  );
}

function NavItem({ icon, label, active = false, onClick, collapsed = false, badge }: {
  icon: React.ReactNode; label: string; active?: boolean; onClick?: () => void; collapsed?: boolean; badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`group relative flex w-full items-center ${collapsed ? "justify-center px-0" : "gap-2.5 px-3"} rounded-lg py-2 text-left text-sm transition-colors ${active ? "bg-indigo-600/20 font-medium text-indigo-300" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"}`}
    >
      <span className="relative shrink-0">
        {icon}
        {badge !== undefined && badge > 0 && collapsed && <span className="absolute -right-1.5 -top-1.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-slate-900" />}
      </span>
      {!collapsed && <span className="gtv-sb-label truncate">{label}</span>}
      {!collapsed && badge !== undefined && badge > 0 && (
        <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">{badge > 9 ? "9+" : badge}</span>
      )}
      {collapsed && (
        <span className="pointer-events-none absolute left-full z-[70] ml-2 whitespace-nowrap rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">{label}</span>
      )}
    </button>
  );
}

// ── icons (copied from AppShell so this file stays self-contained / lightweight) ──
function DashboardIcon() {
  return (
    <svg {...SVG_PROPS}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" strokeLinejoin="round" className="transition-transform duration-300 group-hover:-translate-x-px group-hover:-translate-y-px" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" strokeLinejoin="round" className="transition-transform duration-300 group-hover:translate-x-px group-hover:-translate-y-px" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" strokeLinejoin="round" className="transition-transform duration-300 group-hover:-translate-x-px group-hover:translate-y-px" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" strokeLinejoin="round" className="transition-transform duration-300 group-hover:translate-x-px group-hover:translate-y-px" />
    </svg>
  );
}
function ITSMIcon() {
  return (
    <svg {...SVG_PROPS}>
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
function BoardIcon() {
  return (
    <span className="flex h-4 w-4 items-center justify-center">
      <span className="-ml-[1.15px] h-3 w-[5px] rounded-l-[2.5px] shadow-[inset_0_0_0_1.25px_currentColor] transition-all duration-300 group-hover:-translate-x-px group-hover:rounded-[2px]" />
      <span className="-ml-[1.15px] h-3 w-[5px] shadow-[inset_0_0_0_1.25px_currentColor] transition-all duration-300 group-hover:rounded-[2px]" />
      <span className="-ml-[1.15px] h-3 w-[5px] rounded-r-[2.5px] shadow-[inset_0_0_0_1.25px_currentColor] transition-all duration-300 group-hover:translate-x-px group-hover:rounded-[2px]" />
    </span>
  );
}
function CalendarIcon() {
  return (
    <svg {...SVG_PROPS}>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path strokeLinecap="round" d="M3 9.5h18" />
      <path strokeLinecap="round" className="transition-transform duration-300 group-hover:-translate-y-0.5" d="M8 3.5v3M16 3.5v3" />
      <rect x="6.75" y="12.5" width="4" height="4" rx="1" fill="currentColor" stroke="none" style={CENTER} className="origin-center scale-0 opacity-0 transition-all duration-300 group-hover:scale-100 group-hover:opacity-100" />
      <rect x="13.25" y="12.5" width="4" height="4" rx="1" fill="currentColor" stroke="none" style={CENTER} className="origin-center scale-0 opacity-0 transition-all delay-100 duration-300 group-hover:scale-100 group-hover:opacity-100" />
    </svg>
  );
}
function TimesheetIcon() {
  // On hover the hands advance exactly one hour and rewind on leave (no infinite spin).
  const ORIG = { transformOrigin: "12px 12px", transformBox: "view-box" as const };
  return (
    <svg {...SVG_PROPS}>
      <circle cx="12" cy="12" r="8.5" />
      <g style={ORIG} className="transition-transform duration-700 ease-out group-hover:rotate-[30deg]">
        <path strokeLinecap="round" d="M12 12h2.6" />
      </g>
      <g style={ORIG} className="transition-transform duration-700 ease-out group-hover:rotate-[360deg]">
        <path strokeLinecap="round" d="M12 12V6.8" />
      </g>
    </svg>
  );
}
function ChatIcon() {
  return (
    <svg {...SVG_PROPS}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 5h12a3 3 0 013 3v6a3 3 0 01-3 3H10l-4 3v-3a3 3 0 01-3-3V8a3 3 0 013-3z" />
      <g fill="currentColor" stroke="none" style={CENTER} className="origin-center">
        <circle cx="8.5" cy="11" r="1.05" className="opacity-0 transition-all duration-200 [transition-delay:0ms] group-hover:opacity-100" />
        <circle cx="12" cy="11" r="1.05" className="opacity-0 transition-all duration-200 [transition-delay:120ms] group-hover:opacity-100" />
        <circle cx="15.5" cy="11" r="1.05" className="opacity-0 transition-all duration-200 [transition-delay:240ms] group-hover:opacity-100" />
      </g>
    </svg>
  );
}
function DocsIcon() {
  return (
    <svg {...SVG_PROPS}>
      <path strokeLinecap="round" d="M12 6.5v13" />
      <path strokeLinejoin="round" d="M12 6.5C10.3 5.5 7.8 5 5.5 5S3 5.3 3 5.3v11.7s1.2-.3 3.5-.3 4.8.8 5.5 1.8z" />
      <path strokeLinejoin="round" d="M12 6.5C13.7 5.5 16.2 5 18.5 5S21 5.3 21 5.3v11.7s-1.2-.3-3.5-.3-4.8.8-5.5 1.8z" />
      <path strokeLinejoin="round" style={{ transformBox: "fill-box", transformOrigin: "left center" }} className="transition-transform duration-500 ease-in-out group-hover:-scale-x-100" d="M12 6.5C13.7 5.5 16.2 5 18.5 5S21 5.3 21 5.3v11.7s-1.2-.3-3.5-.3-4.8.8-5.5 1.8z" />
    </svg>
  );
}
function UploadsIcon() {
  return (
    <svg {...SVG_PROPS}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1" />
      <g className="transition-transform duration-300 group-hover:-translate-y-0.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0L8 8m4-4 4 4" /></g>
    </svg>
  );
}
function VaultIcon() {
  return (
    <svg {...SVG_PROPS}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8M10 13h4" />
      <g style={CENTER} className="transition-transform duration-300 group-hover:-rotate-[8deg]"><path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v.01" /></g>
    </svg>
  );
}
function ViewIcon() {
  return (
    <svg {...SVG_PROPS}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 3v5h5" />
      <g className="transition-transform duration-300 group-hover:-translate-x-1 group-hover:-translate-y-1"><circle cx="16" cy="16" r="3.1" /><path strokeLinecap="round" d="M18.3 18.3 20.6 20.6" /></g>
    </svg>
  );
}
function ProfileIcon() {
  // A person; the head gives a tiny nod on hover.
  return (
    <svg {...SVG_PROPS}>
      <circle cx="12" cy="8" r="3.5" className="origin-center transition-transform group-hover:-translate-y-0.5" />
      <path strokeLinecap="round" d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  );
}
function KeysIcon() {
  return (
    <svg {...SVG_PROPS}>
      <g style={CENTER} className="group-hover:[animation:gtv-wiggle_0.5s_ease-in-out]">
        <circle cx="8" cy="16" r="4" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.8 13.2 20 4M16.5 7.5l2 2M14 10l2 2" />
      </g>
    </svg>
  );
}
function SettingsIcon() {
  return (
    <svg {...SVG_PROPS}>
      <g style={CENTER} className="scale-90 transition-transform duration-700 group-hover:rotate-90">
        <circle cx="12" cy="12" r="3" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
      </g>
    </svg>
  );
}
