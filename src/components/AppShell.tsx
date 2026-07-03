"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useWallet } from "@/context/WalletContext";
import UploadFlow from "@/components/UploadFlow";
import AccessKeysView from "@/components/AccessKeysView";
import SettingsView from "@/components/SettingsView";
import SharePopup from "@/components/SharePopup";
import PasswordDownloadPopup from "@/components/PasswordDownloadPopup";
import { walletLabel, type LinkedWallet } from "@/lib/linkedWallets";
import DashboardView from "@/components/DashboardView";
import BoardView from "@/components/BoardView";
import { lockBlobToHtml, lockPdfWithPassword, isPdf } from "@/lib/passwordLock";
import { HelpTip } from "@/components/HelpTip";
import { ArweaveTokenIcon } from "@/components/TokenIcon";
import { BrandWordmark } from "@/components/BrandWordmark";
import { AccountSwitcher, BalancePill } from "@/components/AccountSwitcher";
import DocsView from "@/components/DocsView";
import ChatView from "@/components/ChatView";
import CalendarView from "@/components/CalendarView";
import TimesheetView from "@/components/TimesheetView";
import ITSMView from "@/components/ITSMView";
import ProfileView from "@/components/ProfileView";
import { UserHovercardHost } from "@/components/UserHovercardHost";
import { Spinner, Loading } from "@/components/Spinner";
import { useIsMobileDevice } from "@/lib/useIsMobile";
import { DesktopOnlyScreen } from "@/components/DesktopOnly";
import { usePagedRows } from "@/lib/usePagedRows";
import { PaginationBar } from "@/components/PaginationBar";
import { loadBoards, canManage, fmtDuration } from "@/lib/board";
import type { ActivityNav, TimeDetail } from "@/lib/activity";
import { useChatUnread } from "@/lib/useChatUnread";
import { useItsmUnread } from "@/lib/useItsmUnread";
import { useTimesheetApprovals } from "@/lib/useTimesheetApprovals";
import { useCalendarReminders } from "@/lib/useCalendarReminders";
// Help now lives only at the public /help route (no login needed).
import {
  StoredUpload,
  loadStoredUploads,
  saveStoredUploads,
  fetchOwnedDocuments,
  fetchSharedDocuments,
  fromBase64,
  toBase64,
} from "@/lib/vault";
import { formatBytes, DOCUMENT_TYPES } from "@/lib/crypto";

type DashboardTab = "dashboard" | "board" | "docs" | "chat" | "calendar" | "timesheet" | "itsm" | "profile" | "uploads" | "vault" | "view" | "keys" | "settings" | "help";

// Each section is its own route, so every area is linkable and back/forward work.
// (Help is intentionally absent — it lives at the public /help route.)
const TAB_PATH: Record<Exclude<DashboardTab, "help">, string> = {
  dashboard: "/dashboard",
  board: "/board",
  docs: "/documentation",
  chat: "/chat",
  calendar: "/calendar",
  timesheet: "/timesheet",
  itsm: "/service-desk",
  profile: "/profile",
  uploads: "/uploads",
  vault: "/vault",
  view: "/view",
  keys: "/access-keys",
  settings: "/settings",
};
const PATH_TAB: Record<string, DashboardTab> = Object.fromEntries(
  Object.entries(TAB_PATH).map(([t, p]) => [p, t as DashboardTab])
);

// ── Toast system ─────────────────────────────────────────────────────────────

interface ToastItem { id: string; message: string; type: "error" | "info" | "warning" | "success" }

function ToastContainer({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-5 right-5 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map(t => (
        <div key={t.id} className={`flex items-start gap-3 rounded-xl px-4 py-3 shadow-xl border text-sm ${
          t.type === "error" ? "bg-red-950/90 border-red-800/50 text-red-300" :
          t.type === "warning" ? "bg-amber-950/90 border-amber-800/50 text-amber-300" :
          t.type === "success" ? "bg-emerald-950/90 border-emerald-800/50 text-emerald-300" :
          "bg-slate-900 border-slate-700 text-slate-300"
        }`}>
          <span className="flex-1 leading-relaxed text-xs">{t.message}</span>
          <button onClick={() => onDismiss(t.id)} className="shrink-0 text-current opacity-60 hover:opacity-100 transition-opacity text-base leading-none">×</button>
        </div>
      ))}
    </div>
  );
}


// Brief themed loader shown while the wallet settles its restore attempt, so a
// direct link (e.g. /board) doesn't flash blank before redirecting or loading.
function AppLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950">
      <div className="flex flex-col items-center gap-3">
        <Spinner className="h-7 w-7 text-indigo-400" />
        <p className="text-xs text-slate-500">Loading your vault…</p>
      </div>
    </div>
  );
}

// ── fromBase64 is imported from vault.ts ────────────────────────────────────

async function decryptStoredUpload(upload: StoredUpload): Promise<Blob> {
  // Documents shared WITH us: the row already carries our RSA-wrapped key + IV
  // (from the on-chain Rcpt tag). Unwrap with our wallet, then AES-GCM decrypt.
  if (upload.ownership === "shared") {
    let encryptedData: ArrayBuffer | null = null;
    for (const url of [upload.irysGatewayUrl, upload.gatewayUrl]) {
      try {
        const r = await fetch(url);
        if (r.ok) { encryptedData = await r.arrayBuffer(); break; }
      } catch { /* try next gateway */ }
    }
    if (!encryptedData) throw new Error("Could not fetch the shared document's data.");
    const iv = fromBase64(upload.ivBase64) as Uint8Array<ArrayBuffer>;
    const wrappedKey = fromBase64(upload.wrappedKeyBase64) as Uint8Array<ArrayBuffer>;
    // Our recipient keys are wrapped with WebCrypto RSA-OAEP/SHA-256, which is
    // byte-identical to Wander's own encrypt — so the wallet's { name: "RSA-OAEP" }
    // decrypt (also SHA-256, returns ArrayBuffer) unwraps it.
    let rawBuf: ArrayBuffer;
    try {
      rawBuf = await (
        window.arweaveWallet as unknown as {
          decrypt(d: Uint8Array, a: { name: string }): Promise<ArrayBuffer>;
        }
      ).decrypt(wrappedKey, { name: "RSA-OAEP" });
    } catch {
      throw new Error(
        "Your wallet couldn't unwrap this shared document's key. Make sure you're connected with the wallet it was shared to, and that DECRYPT permission is granted."
      );
    }
    const aesKey = await crypto.subtle.importKey("raw", rawBuf, { name: "AES-GCM" }, false, ["decrypt"]);
    const buf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, encryptedData);
    return new Blob([buf], { type: upload.originalType });
  }

  const res = await fetch(upload.irysGatewayUrl);
  if (!res.ok)
    throw new Error(`Failed to fetch from Irys gateway (${res.status})`);
  const encryptedData = await res.arrayBuffer();
  const iv = fromBase64(upload.ivBase64) as Uint8Array<ArrayBuffer>;
  const wrappedKey = fromBase64(upload.wrappedKeyBase64) as Uint8Array<ArrayBuffer>;

  // Resolve the raw per-file key, preferring cache-only paths.
  const cacheK = `gtv_aes_${upload.txId}`;
  let rawKey: Uint8Array | undefined;
  const cached = localStorage.getItem(cacheK) ?? upload.rawKeyBase64;
  if (cached) {
    try { rawKey = fromBase64(cached); } catch { /* corrupt — re-resolve */ }
  }

  if (!rawKey) {
    const scheme = upload.keyScheme ?? "wallet";
    if (scheme === "master" || scheme === "shared") {
      // Uploader path: unwrap with the vault master key (one unlock per browser).
      const { getMasterKey, unwrapRawWithMaster } = await import("@/lib/masterKey");
      const master = await getMasterKey(false);
      rawKey = await unwrapRawWithMaster(master, wrappedKey);
    } else {
      // Legacy RSA scheme — one wallet prompt, then cached forever below.
      const rawBuf = await (
        window.arweaveWallet as unknown as {
          decrypt(d: Uint8Array, a: { name: string }): Promise<ArrayBuffer>;
        }
      ).decrypt(wrappedKey, { name: "RSA-OAEP" });
      rawKey = new Uint8Array(rawBuf);
    }
    // Self-heal: cache the raw key so every future decrypt is prompt-free,
    // matching the popup-free experience in the Uploads tab.
    try { localStorage.setItem(cacheK, toBase64(rawKey)); } catch { /* full */ }
  }

  const aesKey = await crypto.subtle.importKey(
    "raw", rawKey as Uint8Array<ArrayBuffer>, { name: "AES-GCM" }, false, ["decrypt"]
  );
  const buf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv }, aesKey, encryptedData
  );
  return new Blob([buf], { type: upload.originalType });
}

export default function AppShell() {
  const { address, balance, isConnected, isReady, disconnect } = useWallet();
  const isMobile = useIsMobileDevice(); // phones/tablets are desktop-gated for now
  const router = useRouter();
  // The active section is derived from the URL — each section is its own route, and
  // the nav navigates by URL, so sections are linkable and back/forward work.
  const pathname = usePathname();
  const tab: DashboardTab = PATH_TAB[pathname] ?? "dashboard";
  // Switch section by SHALLOW-updating the URL. Per Next's docs, window.history.pushState
  // integrates with usePathname, so the section changes INSTANTLY with no route transition
  // or RSC fetch (the old SPA speed) — while each section stays a real, deep-linkable URL on
  // direct load. (Help is a separate public page, so it's a normal navigation.)
  const goTab = (t: DashboardTab) => {
    if (t === "help") { router.push("/help"); return; }
    const path = TAB_PATH[t as Exclude<DashboardTab, "help">] ?? "/dashboard";
    if (window.location.pathname !== path) window.history.pushState(null, "", path);
  };
  // A time entry / "no access" notice shown over the Profile when an activity row is opened.
  const [activityModal, setActivityModal] = useState<{ kind: "noaccess" } | { kind: "time"; detail: TimeDetail; who: string } | null>(null);

  // Open a profile activity row at its source — navigating, opening the file actions, or a popup.
  const openActivity = (nav: ActivityNav, rect: DOMRect) => {
    switch (nav.kind) {
      case "ticket": setOpenTicket({ boardId: nav.boardId, ticketId: nav.ticketId }); goTab("board"); break;
      case "event": setOpenEvent(nav.eventId); goTab("calendar"); break;
      case "itsm": setOpenItsm(nav.recordId); goTab("itsm"); break;
      case "docs": setOpenDoc({ boardId: nav.boardId, pageId: nav.pageId }); goTab("docs"); break;
      case "timesheet": {
        // You can see a time entry if it's your own or you manage that board.
        const board = loadBoards(address).find((b) => b.id === nav.boardId);
        const access = nav.who === address || (!!board && canManage(board.role));
        setActivityModal(access ? { kind: "time", detail: nav.detail, who: nav.who } : { kind: "noaccess" });
        break;
      }
      case "upload": {
        // Owner or a file shared with you → the same vault action menu; otherwise no access.
        const file = [...uploads, ...sharedDocs].find((u) => u.txId === nav.txId);
        if (file) setActionDropdown({ type: "single", txIds: [nav.txId], pos: { top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) } });
        else setActivityModal({ kind: "noaccess" });
        break;
      }
    }
  };
  // A ticket the Board should open — set when a chat message's ticket key is clicked.
  const [openTicket, setOpenTicket] = useState<{ boardId: string; ticketId: string } | null>(null);
  // A calendar event the Calendar should open — set when a chat message's event chip is clicked.
  const [openEvent, setOpenEvent] = useState<string | null>(null);
  // A Service Desk record the ITSM section should open — set when a chip elsewhere is clicked.
  const [openItsm, setOpenItsm] = useState<string | null>(null);
  // The wallet whose profile is shown (defaults to me) — set by a @mention's "See profile".
  const [profileSubject, setProfileSubject] = useState<string | null>(null);
  // A documentation page the Docs section should open — set from a profile activity row.
  const [openDoc, setOpenDoc] = useState<{ boardId: string; pageId: string } | null>(null);
  // A wallet to start/open a chat with — set by a @mention's "Call".
  const [chatWith, setChatWith] = useState<{ address: string; label?: string } | null>(null);
  const chatUnread = useChatUnread(address);
  const itsmUnread = useItsmUnread(address);
  const timesheetApprovals = useTimesheetApprovals(address);
  const [uploads, setUploads] = useState<StoredUpload[]>([]);
  const [sharedDocs, setSharedDocs] = useState<StoredUpload[]>([]);
  const [loadingShared, setLoadingShared] = useState(false);
  const [ownershipFilter, setOwnershipFilter] = useState<"all" | "owned" | "shared">("all");
  const [search, setSearch] = useState("");
  // Documents being shared via the SharePopup (null = closed).
  const [sharePopupDocs, setSharePopupDocs] = useState<StoredUpload[] | null>(null);
  // Documents being downloaded password-protected via PasswordDownloadPopup.
  const [passwordDownloadDocs, setPasswordDownloadDocs] = useState<StoredUpload[] | null>(null);

  // Collapsible sidebar (icons-only) — persisted.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarReady, setSidebarReady] = useState(false);
  // Apply the saved collapsed state with the width transition OFF first, then enable it next frame —
  // otherwise the sidebar animates open→collapsed on a fresh page load (e.g. arriving from /help).
  useEffect(() => {
    let saved = false;
    try { saved = localStorage.getItem("gtv_sidebar_collapsed") === "1"; } catch {}
    setSidebarCollapsed(saved);
    document.documentElement.classList.toggle("gtv-sb-collapsed", saved);
    const id = requestAnimationFrame(() => setSidebarReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const toggleSidebar = () =>
    setSidebarCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem("gtv_sidebar_collapsed", next ? "1" : "0"); document.documentElement.classList.toggle("gtv-sb-collapsed", next); } catch {}
      return next;
    });

  // Live AR balance shown in the header (refreshed from the wallet/chain).
  const [arBalance, setArBalance] = useState<string | null>(balance);

  const [decryptBlobs, setDecryptBlobs] = useState<Record<string, string>>({});
  const [decryptLoading, setDecryptLoading] = useState<Set<string>>(new Set());
  const [decryptErrors, setDecryptErrors] = useState<Record<string, string>>({});

  // Feature 2: multi-select
  const [selectedTxIds, setSelectedTxIds] = useState<Set<string>>(new Set());

  // Feature 4: filter by document type
  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set());
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const filterDropdownRef = useRef<HTMLDivElement>(null);

  // Date order toggle. Default (false) = most recent first; true = oldest first.
  const [oldestFirst, setOldestFirst] = useState(false);

  // Phase 5: view-by-id state
  const [viewTxId, setViewTxId] = useState("");
  const [viewLoading, setViewLoading] = useState(false);
  const [viewDoc, setViewDoc] = useState<{ url: string; name: string; mime: string } | null>(null);

  // Toast state
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const [actionDropdown, setActionDropdown] = useState<{
    type: "single" | "bulk";
    txIds: string[];
    pos: { top: number; right: number };
  } | null>(null);

  const closeActionDropdown = useCallback(() => setActionDropdown(null), []);

  useEffect(() => {
    if (!actionDropdown) return;
    document.addEventListener("click", closeActionDropdown);
    return () => document.removeEventListener("click", closeActionDropdown);
  }, [actionDropdown, closeActionDropdown]);

  const addToast = useCallback((message: string, type: ToastItem["type"] = "error") => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    setToasts(prev => [...prev.slice(-4), { id, message, type }]); // keep max 5
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 6000);
  }, []);
  const dismissToast = useCallback((id: string) => setToasts(prev => prev.filter(t => t.id !== id)), []);
  useCalendarReminders(address, addToast); // meeting reminders (browser + in-app), app-wide

  // When the active wallet changes (account switch in Wander, or sign-in), drop every
  // cross-reference to the PREVIOUS account's data. Without this the Profile stays pinned to
  // whoever you last clicked (profileSubject), and other "open X" hand-offs point at stale ids.
  useEffect(() => {
    setProfileSubject(null);
    setChatWith(null);
    setOpenTicket(null);
    setOpenEvent(null);
    setOpenItsm(null);
    setOpenDoc(null);
    setActivityModal(null);
  }, [address]);

  // A @mention anywhere can ask to open a profile or start a chat (see lib/profileNav).
  useEffect(() => {
    const nav = (path: string) => { if (window.location.pathname !== path) window.history.pushState(null, "", path); };
    const onProfile = (e: Event) => { const d = (e as CustomEvent<{ address: string }>).detail; if (d?.address) { setProfileSubject(d.address); nav("/profile"); } };
    const onCall = (e: Event) => { const d = (e as CustomEvent<{ address: string; label?: string }>).detail; if (d?.address) { setChatWith(d); nav("/chat"); } };
    window.addEventListener("gtv:open-profile", onProfile);
    window.addEventListener("gtv:call-user", onCall);
    return () => { window.removeEventListener("gtv:open-profile", onProfile); window.removeEventListener("gtv:call-user", onCall); };
  }, []);

  // Once the wallet has settled its restore attempt, bounce un-connected visitors to
  // the landing page — so a direct link like /board doesn't dead-end on a blank screen.
  useEffect(() => {
    if (isReady && !isConnected) {
      router.replace("/");
    }
  }, [isReady, isConnected, router]);

  // Keep the AR balance fresh in the header.
  useEffect(() => {
    if (!address) return;
    let active = true;
    const load = async () => {
      try {
        const res = await fetch(`https://arweave.net/wallet/${address}/balance`);
        const winston = await res.text();
        if (active) setArBalance((parseFloat(winston) / 1e12).toFixed(4));
      } catch { /* keep last value */ }
    };
    load();
    const id = setInterval(load, 45_000);
    return () => { active = false; clearInterval(id); };
  }, [address]);

  // Load vault entries when on vault tab or when address changes.
  // Local index renders instantly; then we self-heal from Arweave — discovering the wallet's
  // OWN uploads on-chain and merging them in — so your files reappear after a cache wipe even
  // if no state snapshot has them. The merged list is re-persisted (and re-mirrored) so it's
  // durable going forward. Local rows win on conflict (they carry the popup-free raw key).
  useEffect(() => {
    if (!address) return;
    const local = loadStoredUploads(address);
    setUploads(local);
    let active = true;
    fetchOwnedDocuments(address)
      .then((owned) => {
        if (!active || owned.length === 0) return;
        const byId = new Map<string, StoredUpload>();
        for (const u of owned) byId.set(u.txId, u);            // on-chain baseline (incl. Document-Tags)
        for (const u of local) {
          const chain = byId.get(u.txId);
          // Local wins (it carries the popup-free raw key + any post-upload edits), but keep
          // whichever side actually has tags so a doc's on-chain Document-Tags are never dropped.
          byId.set(u.txId, { ...chain, ...u, tags: (u.tags?.length ? u.tags : chain?.tags) ?? [] });
        }
        const merged = Array.from(byId.values()).sort((a, b) => b.uploadedAt - a.uploadedAt);
        setUploads(merged);
        if (merged.length !== local.length) saveStoredUploads(address, merged);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [address, tab]);

  // Discover documents shared with this wallet (on-chain). Renders results
  // progressively (as each gateway answers) so a slow endpoint can't stall it.
  const refreshShared = useCallback(async () => {
    if (!address) return;
    setLoadingShared(true);
    try {
      const docs = await fetchSharedDocuments(address, (partial) => setSharedDocs(partial));
      setSharedDocs(docs);
    } finally {
      setLoadingShared(false);
    }
  }, [address]);

  useEffect(() => {
    // The Vault lists shared docs; the Dashboard counts them (Owned vs Shared).
    if ((tab !== "vault" && tab !== "dashboard") || !address) return;
    refreshShared();
  }, [tab, address, refreshShared]);

  // Proactively unlock the vault when it opens. If the master key is already
  // cached this is instant and silent; otherwise it prompts ONCE to recover it,
  // so every subsequent view/download is prompt-free. Never creates a key.
  useEffect(() => {
    if (tab !== "vault" || !address) return;
    (async () => {
      try {
        const { prepareMasterKey } = await import("@/lib/masterKey");
        await prepareMasterKey();
      } catch {
        /* ignore — falls back to lazy prompt on first decrypt */
      }
    })();
  }, [tab, address]);

  // Feature 4: close filter dropdown on outside click
  useEffect(() => {
    if (!showFilterDropdown) return;
    const handler = (e: MouseEvent) => {
      if (
        filterDropdownRef.current &&
        !filterDropdownRef.current.contains(e.target as Node)
      ) {
        setShowFilterDropdown(false);
      }
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [showFilterDropdown]);

  // Owned (localStorage) + shared (on-chain), de-duped by txId (owned wins).
  const ownedIds = new Set(uploads.map((u) => u.txId));
  const allDocs = [...uploads, ...sharedDocs.filter((s) => !ownedIds.has(s.txId))];

  // Tags already used across the vault (on-chain Document-Tags) — offered as suggestions when
  // tagging new uploads, so they persist across browsers/devices and the user never loses them.
  const vaultTags = useMemo(() => {
    const s = new Set<string>();
    for (const d of [...uploads, ...sharedDocs]) for (const t of d.tags ?? []) { const v = t.trim(); if (v) s.add(v); }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [uploads, sharedDocs]);

  // Filters: ownership + document type + search.
  const filteredUploads = allDocs.filter((u) => {
    const own = u.ownership ?? "owned";
    if (ownershipFilter !== "all" && own !== ownershipFilter) return false;
    if (filterTypes.size > 0 && !filterTypes.has(u.documentType)) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      u.originalName.toLowerCase().includes(q) ||
      u.tags.some((t) => t.toLowerCase().includes(q)) ||
      u.documentType.toLowerCase().includes(q)
    );
  });

  // Newest-first by default; only re-sort when oldest-first.
  const sortedUploads = oldestFirst
    ? [...filteredUploads].sort((a, b) => a.uploadedAt - b.uploadedAt)
    : [...filteredUploads].sort((a, b) => b.uploadedAt - a.uploadedAt);

  // Vault table: fit rows to the height available + page the overflow (shared with Profile / Service Desk).
  const vaultRows = usePagedRows(sortedUploads, 57, `${search}|${ownershipFilter}|${[...filterTypes].sort().join()}|${oldestFirst}`);
  const visibleUploads = vaultRows.pageItems;

  if (!isReady) return <AppLoading />;
  if (isMobile) return <DesktopOnlyScreen />; // no app access on phones/tablets yet
  if (!isConnected || !address) return null;

  // Feature 1: get or decrypt blob (cached)
  const getOrDecryptBlob = async (upload: StoredUpload): Promise<string> => {
    const txId = upload.txId;
    if (decryptBlobs[txId]) return decryptBlobs[txId];

    setDecryptLoading((prev) => new Set(prev).add(txId));
    setDecryptErrors((prev) => ({ ...prev, [txId]: "" }));
    try {
      const blob = await decryptStoredUpload(upload);
      const url = URL.createObjectURL(blob);
      setDecryptBlobs((prev) => ({ ...prev, [txId]: url }));
      setDecryptLoading((prev) => {
        const next = new Set(prev);
        next.delete(txId);
        return next;
      });
      return url;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Decryption failed.";
      setDecryptErrors((prev) => ({ ...prev, [txId]: msg }));
      setDecryptLoading((prev) => {
        const next = new Set(prev);
        next.delete(txId);
        return next;
      });
      addToast(msg);
      throw err;
    }
  };

  const handleDecryptAndView = async (upload: StoredUpload) => {
    try {
      const url = await getOrDecryptBlob(upload);
      window.open(url, "_blank");
    } catch {
      // error already stored in decryptErrors and shown via toast
    }
  };

  const handleDecryptAndDownload = async (upload: StoredUpload) => {
    try {
      const url = await getOrDecryptBlob(upload);
      const a = document.createElement("a");
      a.href = url;
      a.download = upload.originalName;
      a.click();
    } catch {
      // error already stored in decryptErrors and shown via toast
    }
  };

  // Decrypt each selected doc, re-encrypt it with the chosen password, and
  // download the portable .gtvlock.json package (openable at /unlock, no wallet).
  const handlePasswordDownload = async (password: string) => {
    const docs = passwordDownloadDocs ?? [];
    if (docs.length === 0) return;
    try {
      const { prepareMasterKey } = await import("@/lib/masterKey");
      await prepareMasterKey(); // unlock once so the loop never prompts per file
    } catch { /* falls back to per-file resolution */ }
    let ok = 0;
    for (const doc of docs) {
      const blob = await decryptStoredUpload(doc); // throws → surfaced by the popup
      let locked: Blob;
      let filename: string;
      if (isPdf(doc.originalName, doc.originalType)) {
        // Real password-protected PDF — the password lives in the file itself.
        try {
          locked = await lockPdfWithPassword(await blob.arrayBuffer(), password);
          filename = doc.originalName.toLowerCase().endsWith(".pdf") ? doc.originalName : `${doc.originalName}.pdf`;
        } catch {
          // Unusual PDF that can't be re-encrypted → fall back to the HTML wrapper.
          ({ blob: locked, filename } = await lockBlobToHtml(blob, password, doc.originalName, doc.originalType));
        }
      } else {
        // Non-PDF → self-decrypting HTML the recipient opens in any browser.
        ({ blob: locked, filename } = await lockBlobToHtml(blob, password, doc.originalName, doc.originalType));
      }
      const url = URL.createObjectURL(locked);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      ok++;
    }
    addToast(`Downloaded ${ok} password-protected file${ok !== 1 ? "s" : ""}. Send the password separately.`, "info");
  };

  // Feature 2: select/deselect helpers
  const toggleSelect = (txId: string) => {
    setSelectedTxIds((prev) => {
      const next = new Set(prev);
      if (next.has(txId)) next.delete(txId);
      else next.add(txId);
      return next;
    });
  };

  const allFilteredSelected =
    sortedUploads.length > 0 &&
    sortedUploads.every((u) => selectedTxIds.has(u.txId));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedTxIds(new Set());
    } else {
      setSelectedTxIds(new Set(sortedUploads.map((u) => u.txId)));
    }
  };

  const handleBulkDownload = async () => {
    // Unlock the vault master key once up front so the loop never prompts per file.
    try {
      const { prepareMasterKey } = await import("@/lib/masterKey");
      await prepareMasterKey();
    } catch { /* falls back to per-file resolution */ }
    const ids = Array.from(selectedTxIds);
    for (const txId of ids) {
      const upload = uploads.find((u) => u.txId === txId);
      if (!upload) continue;
      try {
        const url = await getOrDecryptBlob(upload);
        const a = document.createElement("a");
        a.href = url;
        a.download = upload.originalName;
        a.click();
        await new Promise((r) => setTimeout(r, 400));
      } catch {
        // continue with next file, error shown via toast
      }
    }
    setSelectedTxIds(new Set());
  };

  const handleBulkDecryptAndView = async () => {
    // Unlock the vault master key once up front so the loop never prompts per file.
    try {
      const { prepareMasterKey } = await import("@/lib/masterKey");
      await prepareMasterKey();
    } catch { /* falls back to per-file resolution */ }
    const ids = Array.from(selectedTxIds);
    for (const txId of ids) {
      const upload = uploads.find((u) => u.txId === txId);
      if (!upload) continue;
      try {
        const url = await getOrDecryptBlob(upload);
        window.open(url, "_blank");
        await new Promise((r) => setTimeout(r, 300));
      } catch {
        // continue with next file, error shown via toast
      }
    }
  };

  // Phase 5: fetch + decrypt a document by Arweave txId, render inline.
  const handleView = async () => {
    const txId = viewTxId.trim();
    if (!txId) return;
    setViewLoading(true);
    if (viewDoc) {
      URL.revokeObjectURL(viewDoc.url);
      setViewDoc(null);
    }
    try {
      // If it's one of our own documents, hand over the cached raw key so it
      // decrypts with no wallet/master prompt at all.
      const own = uploads.find((u) => u.txId === txId);
      const rawKeyB64 =
        localStorage.getItem(`gtv_aes_${txId}`) ?? own?.rawKeyBase64 ?? undefined;

      const { fetchAndDecryptByTxId } = await import("@/lib/viewer");
      const doc = await fetchAndDecryptByTxId(txId, { rawKeyB64 });
      setViewDoc({ url: URL.createObjectURL(doc.blob), name: doc.name, mime: doc.mime });
    } catch (e) {
      addToast(e instanceof Error ? e.message : "Failed to open document.");
    } finally {
      setViewLoading(false);
    }
  };

  // Feature 4: toggle filter type
  const toggleFilterType = (type: string) => {
    setFilterTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      <UserHovercardHost viewer={address} onToast={addToast} />
      {activityModal && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4" onMouseDown={() => setActivityModal(null)}>
          <div className="absolute inset-0 bg-black/60" />
          <div onMouseDown={(e) => e.stopPropagation()} className="relative w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            {activityModal.kind === "noaccess" ? (
              <div className="text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/15 text-rose-300"><svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="4" y="11" width="16" height="9" rx="2" /><path strokeLinecap="round" d="M8 11V7a4 4 0 018 0" /></svg></div>
                <h3 className="text-sm font-semibold text-white">No access</h3>
                <p className="mt-1 text-xs text-slate-400">You don’t have access to this item.</p>
                <button onClick={() => setActivityModal(null)} className="mt-4 rounded-lg bg-slate-800 px-4 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700">Close</button>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white">{activityModal.detail.kind === "holiday" ? "Time off" : activityModal.detail.kind === "worklog" ? "Logged time" : "Time entry"}</h3>
                  <button onClick={() => setActivityModal(null)} className="text-slate-500 hover:text-slate-200"><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg></button>
                </div>
                <p className="mt-2 text-sm text-slate-100">{activityModal.detail.title}</p>
                <dl className="mt-3 space-y-1.5 text-xs">
                  {activityModal.detail.hours > 0 && <Row label="Time" value={fmtDuration(activityModal.detail.hours)} />}
                  {activityModal.detail.from && activityModal.detail.to && <Row label="Hours" value={`${activityModal.detail.from} – ${activityModal.detail.to}`} />}
                  <Row label="Date" value={activityModal.detail.date} />
                  <Row label="Board" value={activityModal.detail.board} />
                  {activityModal.detail.context && <Row label="Ticket" value={activityModal.detail.context} />}
                </dl>
              </div>
            )}
          </div>
        </div>
      )}

      {sharePopupDocs && (
        <SharePopup
          owner={address}
          docs={sharePopupDocs}
          onClose={() => { setSharePopupDocs(null); setSelectedTxIds(new Set()); }}
          onToast={addToast}
        />
      )}

      {passwordDownloadDocs && (
        <PasswordDownloadPopup
          docs={passwordDownloadDocs}
          onClose={() => { setPasswordDownloadDocs(null); setSelectedTxIds(new Set()); }}
          onConfirm={handlePasswordDownload}
          onToast={addToast}
        />
      )}

      {actionDropdown && (
        <div
          style={{ top: actionDropdown.pos.top, right: actionDropdown.pos.right }}
          className="fixed z-50 w-52 rounded-xl border border-slate-700 bg-slate-900 shadow-2xl py-1 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {actionDropdown.txIds.some((id) => decryptLoading.has(id)) ? (
            <div className="flex items-center justify-center gap-2 px-4 py-4 text-xs text-slate-400">
              <span className="w-3.5 h-3.5 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" />
              Decrypting…
            </div>
          ) : actionDropdown.type === "bulk" ? (
            <>
              <div className="px-4 py-2 border-b border-slate-800">
                <span className="text-xs font-semibold text-slate-300">
                  {actionDropdown.txIds.length} files selected
                </span>
              </div>
              <button
                onClick={() => { closeActionDropdown(); handleBulkDownload(); }}
                className="flex items-center gap-2 w-full text-left px-4 py-2.5 text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
              >
                <ActionIcon name="download" />Download All
              </button>
            </>
          ) : (() => {
            const u = allDocs.find((u) => u.txId === actionDropdown.txIds[0]);
            if (!u) return null;
            const canShare = (u.ownership ?? "owned") === "owned" && !!u.rawKeyBase64;
            return (
              <>
                <button
                  onClick={() => { closeActionDropdown(); handleDecryptAndView(u); }}
                  className="flex items-center gap-2 w-full text-left px-4 py-2.5 text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
                >
                  <ActionIcon name="view" />Decrypt &amp; View
                </button>
                <button
                  onClick={() => { closeActionDropdown(); handleDecryptAndDownload(u); }}
                  className="flex items-center gap-2 w-full text-left px-4 py-2.5 text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
                >
                  <ActionIcon name="download" />Download
                </button>
                <button
                  onClick={() => { closeActionDropdown(); setPasswordDownloadDocs([u]); }}
                  className="flex items-center gap-2 w-full text-left px-4 py-2.5 text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
                >
                  <ActionIcon name="lock" />Download with password…
                </button>
                {canShare && (
                  <button
                    onClick={() => { closeActionDropdown(); setSharePopupDocs([u]); }}
                    className="flex items-center gap-2 w-full text-left px-4 py-2.5 text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
                  >
                    <ActionIcon name="share" />Share…
                  </button>
                )}
                <hr className="border-slate-800 my-1" />
                <button
                  onClick={() => { closeActionDropdown(); navigator.clipboard.writeText(u.txId); }}
                  className="flex items-center gap-2 w-full text-left px-4 py-2.5 text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
                >
                  <ActionIcon name="copy" />Copy Transaction ID
                </button>
                <a href={u.irysGatewayUrl} target="_blank" rel="noopener noreferrer" onClick={closeActionDropdown}
                  className="flex items-center gap-2 w-full text-left px-4 py-2.5 text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-colors">
                  <ActionIcon name="file" />Encrypted File
                </a>
                <a href={`https://viewblock.io/arweave/tx/${u.txId}`} target="_blank" rel="noopener noreferrer" onClick={closeActionDropdown}
                  className="flex items-center gap-2 w-full text-left px-4 py-2.5 text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-colors">
                  <ActionIcon name="block" />ViewBlock
                </a>
                <a href={u.gatewayUrl} target="_blank" rel="noopener noreferrer" onClick={closeActionDropdown}
                  className="flex items-center gap-2 w-full text-left px-4 py-2.5 text-xs text-slate-600 hover:bg-slate-800 hover:text-slate-400 transition-colors">
                  <ActionIcon name="external" />Arweave (permanent)
                </a>
              </>
            );
          })()}
        </div>
      )}

      {/* Top bar */}
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <button onClick={() => router.push("/")} aria-label="TrustVault home">
          <BrandWordmark />
        </button>

        <div className="flex items-center gap-2.5">
          <BalancePill
            icon={<ArweaveTokenIcon />}
            value={`${arBalance ?? balance ?? "…"} AR`}
          />

          {/* Account switcher — active wallet, switch between linked wallets, copy, add. */}
          <AccountSwitcher onToast={addToast} />

          <button
            onClick={async () => {
              await disconnect();
              router.replace("/");
            }}
            title="Disconnect"
            aria-label="Disconnect"
            className="group flex items-center justify-center h-8 w-8 rounded-lg border border-slate-700 text-slate-500 hover:text-red-400 hover:border-red-800/60 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 21H6a2 2 0 01-2-2V5a2 2 0 012-2h3" />
              <g className="transition-transform duration-300 group-hover:translate-x-0.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 17l5-5-5-5M21 12H9" />
              </g>
            </svg>
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside
          className={`gtv-sidebar ${sidebarCollapsed ? "w-16" : "w-56"} border-r border-slate-800 px-3 py-6 flex flex-col gap-1 shrink-0 ${sidebarReady ? "transition-[width] duration-300" : ""}`}
        >
          <NavItem
            icon={<DashboardIcon />}
            label="Dashboard"
            active={tab === "dashboard"}
            onClick={() => goTab("dashboard")}
            collapsed={sidebarCollapsed}
          />
          <NavItem
            icon={<BoardIcon />}
            label="Board"
            active={tab === "board"}
            onClick={() => goTab("board")}
            collapsed={sidebarCollapsed}
          />
          <NavItem
            icon={<DocsIcon />}
            label="Documentation"
            active={tab === "docs"}
            onClick={() => goTab("docs")}
            collapsed={sidebarCollapsed}
          />
          <NavItem
            icon={<ChatIcon />}
            label="Chat"
            active={tab === "chat"}
            onClick={() => goTab("chat")}
            collapsed={sidebarCollapsed}
            badge={chatUnread.total}
          />
          <NavItem
            icon={<CalendarIcon />}
            label="Calendar"
            active={tab === "calendar"}
            onClick={() => goTab("calendar")}
            collapsed={sidebarCollapsed}
          />
          <NavItem
            icon={<TimesheetIcon />}
            label="Timesheet"
            active={tab === "timesheet"}
            onClick={() => goTab("timesheet")}
            collapsed={sidebarCollapsed}
            badge={timesheetApprovals.total}
          />
          <NavItem
            icon={<ITSMIcon />}
            label="Service Desk"
            active={tab === "itsm"}
            onClick={() => goTab("itsm")}
            collapsed={sidebarCollapsed}
            badge={itsmUnread.total}
          />
          <NavItem
            icon={<UploadsIcon />}
            label="Uploads"
            active={tab === "uploads"}
            onClick={() => goTab("uploads")}
            collapsed={sidebarCollapsed}
          />
          <NavItem
            icon={<VaultIcon />}
            label="Vault"
            active={tab === "vault"}
            onClick={() => goTab("vault")}
            collapsed={sidebarCollapsed}
          />
          <NavItem
            icon={<ViewIcon />}
            label="View Document"
            active={tab === "view"}
            onClick={() => goTab("view")}
            collapsed={sidebarCollapsed}
          />
          <NavItem
            icon={<ProfileIcon />}
            label="Profile"
            active={tab === "profile"}
            onClick={() => { setProfileSubject(null); goTab("profile"); }}
            collapsed={sidebarCollapsed}
          />
          <NavItem
            icon={<KeysIcon />}
            label="Access Keys"
            active={tab === "keys"}
            onClick={() => goTab("keys")}
            collapsed={sidebarCollapsed}
          />
          <NavItem
            icon={<SettingsIcon />}
            label="Settings"
            active={tab === "settings"}
            onClick={() => goTab("settings")}
            collapsed={sidebarCollapsed}
          />

          {/* Collapse / expand toggle — icon-only, bottom-right, animated arrow */}
          <div className={`mt-auto flex ${sidebarCollapsed ? "justify-center" : "justify-end"}`}>
            <button
              onClick={toggleSidebar}
              title={sidebarCollapsed ? "Expand menu" : "Collapse menu"}
              aria-label={sidebarCollapsed ? "Expand menu" : "Collapse menu"}
              className="group flex items-center justify-center h-8 w-8 rounded-lg border border-slate-700 text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 5v14" />
                {sidebarCollapsed ? (
                  <g className="transition-transform duration-300 group-hover:translate-x-0.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h11M16 8l4 4-4 4" />
                  </g>
                ) : (
                  <g className="transition-transform duration-300 group-hover:-translate-x-0.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H9M13 8l-4 4 4 4" />
                  </g>
                )}
              </svg>
            </button>
          </div>
        </aside>

        {/* Main content — the single scroll container; footer lives at its end (pushed to the bottom) */}
        <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-8 py-8">
          {tab === "dashboard" && (
            <DashboardView
              uploads={uploads}
              shared={sharedDocs}
              address={address}
              onToast={addToast}
              refreshing={loadingShared}
              onRefresh={() => { setUploads(loadStoredUploads(address)); refreshShared(); }}
            />
          )}

          {tab === "board" && (
            <BoardView address={address} onToast={addToast} openTicket={openTicket} onTicketOpened={() => setOpenTicket(null)} onOpenEvent={(eventId) => { setOpenEvent(eventId); goTab("calendar"); }} onOpenItsm={(id) => { setOpenItsm(id); goTab("itsm"); }} onOpenTicketCross={(boardId, ticketId) => { setOpenTicket({ boardId, ticketId }); goTab("board"); }} />
          )}

          {tab === "docs" && <DocsView address={address} onToast={addToast} onOpenTicket={(boardId, ticketId) => { setOpenTicket({ boardId, ticketId }); goTab("board"); }} onOpenEvent={(eventId) => { setOpenEvent(eventId); goTab("calendar"); }} onOpenItsm={(id) => { setOpenItsm(id); goTab("itsm"); }} openDoc={openDoc} onDocOpened={() => setOpenDoc(null)} />}
          {tab === "chat" && <ChatView address={address} onToast={addToast} onOpenTicket={(boardId, ticketId) => { setOpenTicket({ boardId, ticketId }); goTab("board"); }} onOpenEvent={(eventId) => { setOpenEvent(eventId); goTab("calendar"); }} onOpenItsm={(id) => { setOpenItsm(id); goTab("itsm"); }} unread={chatUnread.unread} onMarkRead={chatUnread.markRead} onMarkUnread={chatUnread.markUnread} startWith={chatWith} onStartWithHandled={() => setChatWith(null)} />}
          {tab === "calendar" && <CalendarView address={address} onToast={addToast} onOpenTicket={(boardId, ticketId) => { setOpenTicket({ boardId, ticketId }); goTab("board"); }} onOpenItsm={(id) => { setOpenItsm(id); goTab("itsm"); }} openEvent={openEvent} onEventOpened={() => setOpenEvent(null)} />}
          {tab === "timesheet" && <TimesheetView address={address} onToast={addToast} />}
          {tab === "itsm" && <ITSMView address={address} onToast={addToast} onOpenTicket={(boardId, ticketId) => { setOpenTicket({ boardId, ticketId }); goTab("board"); }} onOpenEvent={(eventId) => { setOpenEvent(eventId); goTab("calendar"); }} openRecord={openItsm} onRecordOpened={() => setOpenItsm(null)} />}
          {tab === "profile" && <ProfileView address={address} subject={profileSubject || address} onChangeSubject={(addr) => setProfileSubject(addr)} onOpenActivity={openActivity} onToast={addToast} />}

          {tab === "uploads" && (
            <div className="mb-8">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">
                    Encrypt a Document
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Files are encrypted in-browser — plaintext never leaves your device
                  </p>
                </div>
              </div>
              <UploadFlow knownTags={vaultTags} />
            </div>
          )}

          {tab === "vault" && (
            <div className="flex flex-col h-[calc(100vh-9rem)]">
              <div className="flex items-center justify-between mb-4 shrink-0">
                <div>
                  <h2 className="text-lg font-semibold text-white">My Vault</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Your encrypted documents, stored permanently on Arweave — decrypt, download, or share them anytime
                  </p>
                </div>

                {/* Search + Sort + Filter bar — all h-9 for equal height */}
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Search by name or tag…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-9 text-sm bg-slate-800 border border-slate-700 rounded-lg px-3 text-slate-300 placeholder-slate-600 focus:outline-none focus:border-indigo-500 w-64"
                  />

                  {/* Refresh documents shared with you (spins while loading) */}
                  <button
                    onClick={refreshShared}
                    disabled={loadingShared}
                    title="Refresh documents shared with you"
                    aria-label="Refresh shared documents"
                    className="flex items-center justify-center h-9 w-9 rounded-lg border border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200 disabled:opacity-60 transition-colors"
                  >
                    <svg className={`w-4 h-4 ${loadingShared ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M5.5 14a7 7 0 0011.9 2.5M18.5 10A7 7 0 006.6 7.5" />
                    </svg>
                  </button>

                  {/* Date order toggle — arrow flips between newest-first and oldest-first */}
                  <button
                    onClick={() => setOldestFirst((v) => !v)}
                    title={oldestFirst ? "Oldest first (click for newest first)" : "Newest first (click for oldest first)"}
                    className={`flex items-center justify-center h-9 w-9 rounded-lg border transition-colors ${
                      oldestFirst
                        ? "border-indigo-600 bg-indigo-600/20 text-indigo-300"
                        : "border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700"
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      {oldestFirst ? (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 11l7-7 7 7M12 4v16" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 13l-7 7-7-7M12 20V4" />
                      )}
                    </svg>
                  </button>

                  {/* Filter by type */}
                  <div className="relative" ref={filterDropdownRef}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowFilterDropdown((v) => !v);
                      }}
                      className={`flex items-center justify-center h-9 w-9 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 transition-colors ${
                        filterTypes.size > 0 || ownershipFilter !== "all" ? "text-indigo-400" : "text-slate-400"
                      }`}
                      title="Filter documents"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 20 20" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" d="M2 5h16M5 10h10M8 15h4" />
                      </svg>
                    </button>

                    {showFilterDropdown && (
                      <div className="absolute right-0 z-50 mt-1 w-52 rounded-xl border border-slate-700 bg-slate-900 shadow-xl py-1">
                        <p className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-slate-500">
                          Ownership
                        </p>
                        {(["all", "owned", "shared"] as const).map((opt) => (
                          <label
                            key={opt}
                            className="flex items-center gap-2 w-full px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer capitalize"
                          >
                            <input
                              type="radio"
                              name="ownership-filter"
                              checked={ownershipFilter === opt}
                              onChange={() => setOwnershipFilter(opt)}
                              className="accent-indigo-500"
                            />
                            {opt === "all" ? "All" : opt}
                          </label>
                        ))}
                        <hr className="border-slate-800 my-1" />
                        <p className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-slate-500">
                          Filter by type
                        </p>
                        {DOCUMENT_TYPES.map((type) => (
                          <label
                            key={type}
                            className="flex items-center gap-2 w-full px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={filterTypes.has(type)}
                              onChange={() => toggleFilterType(type)}
                              className="accent-indigo-500"
                            />
                            {type}
                          </label>
                        ))}
                        {filterTypes.size > 0 && (
                          <>
                            <hr className="border-slate-800 my-1" />
                            <button
                              onClick={() => {
                                setFilterTypes(new Set());
                                setShowFilterDropdown(false);
                              }}
                              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                            >
                              Clear all filters
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Feature 4: active filter pills */}
              {filterTypes.size > 0 && (
                <div className="flex flex-wrap items-center gap-2 mb-4 shrink-0">
                  {Array.from(filterTypes).map((type) => (
                    <span
                      key={type}
                      className="flex items-center gap-1 text-xs bg-indigo-900/40 border border-indigo-700/50 text-indigo-300 px-2 py-0.5 rounded-full"
                    >
                      {type}
                      <button
                        onClick={() => toggleFilterType(type)}
                        className="ml-0.5 text-indigo-400 hover:text-white transition-colors"
                        aria-label={`Remove ${type} filter`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <button
                    onClick={() => setFilterTypes(new Set())}
                    className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    Clear all
                  </button>
                </div>
              )}

              {/* Bulk action bar — inline buttons */}
              {selectedTxIds.size > 0 && (
                <div className="flex items-center gap-3 rounded-xl border border-indigo-800/40 bg-indigo-950/20 px-4 py-2.5 mb-4 shrink-0">
                  <span className="text-xs text-slate-300 flex-1">
                    {selectedTxIds.size} file{selectedTxIds.size !== 1 ? "s" : ""} selected
                  </span>
                  <button
                    onClick={handleBulkDecryptAndView}
                    className="flex items-center gap-1.5 text-xs text-emerald-300 border border-emerald-800/50 bg-emerald-500/10 hover:bg-emerald-500/20 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <ActionIcon name="view" />Decrypt &amp; View
                  </button>
                  <button
                    onClick={handleBulkDownload}
                    className="flex items-center gap-1.5 text-xs text-indigo-300 border border-indigo-800/50 bg-indigo-500/10 hover:bg-indigo-500/20 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <ActionIcon name="download" />Download
                  </button>
                  <button
                    onClick={() => {
                      const docs = allDocs.filter((d) => selectedTxIds.has(d.txId));
                      if (docs.length === 0) return;
                      setPasswordDownloadDocs(docs);
                    }}
                    className="flex items-center gap-1.5 text-xs text-amber-300 border border-amber-800/50 bg-amber-500/10 hover:bg-amber-500/20 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <ActionIcon name="lock" />Password
                  </button>
                  <button
                    onClick={() => {
                      const docs = allDocs.filter(
                        (d) => selectedTxIds.has(d.txId) && (d.ownership ?? "owned") === "owned" && d.rawKeyBase64
                      );
                      if (docs.length === 0) {
                        addToast("Only documents you own (uploaded on this browser) can be shared.", "warning");
                        return;
                      }
                      setSharePopupDocs(docs);
                    }}
                    className="flex items-center gap-1.5 text-xs text-slate-300 border border-slate-700 hover:border-slate-500 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <ActionIcon name="share" />Share
                  </button>
                  <button
                    onClick={() => setSelectedTxIds(new Set())}
                    className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    <ActionIcon name="clear" />Clear
                  </button>
                </div>
              )}

              {loadingShared && sortedUploads.length === 0 ? (
                <div className="flex-1 min-h-0 flex flex-col items-center justify-center rounded-xl border border-slate-800 bg-slate-900/40">
                  <Loading label="Loading your documents…" spinner="h-6 w-6 text-indigo-400" />
                </div>
              ) : sortedUploads.length === 0 ? (
                <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-8 py-16 text-center shrink-0">
                  <p className="text-slate-500 text-sm">
                    {ownershipFilter === "shared"
                      ? "No documents shared with this wallet yet. A new share takes a few minutes to confirm on-chain before it appears — tap Refresh to re-check."
                      : uploads.length === 0 && sharedDocs.length === 0
                      ? "No documents yet — head to Uploads to store your first document."
                      : "No documents match your filters."}
                  </p>
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-800">
                <div ref={vaultRows.containerRef} className="min-h-0 flex-1 overflow-hidden">
                  <table className="table-auto w-full text-sm">
                    <thead ref={vaultRows.headerRef} className="bg-slate-900 text-slate-400 text-xs uppercase tracking-wide">
                      <tr>
                        {/* Feature 2: select-all checkbox */}
                        <th className="w-10 px-3 py-3">
                          <input
                            type="checkbox"
                            checked={allFilteredSelected}
                            onChange={toggleSelectAll}
                            className="accent-indigo-500"
                            aria-label="Select all"
                          />
                        </th>
                        <th className="text-left px-5 py-3">Document</th>
                        <th className="text-left px-5 py-3">Access</th>
                        <th className="text-left px-5 py-3">Tags</th>
                        <th className="text-left px-5 py-3">Uploaded</th>
                        <th className="text-left px-5 py-3">Transaction ID</th>
                        <th className="text-left px-5 py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleUploads.map((u) => {
                        const d = new Date(u.uploadedAt);
                        const date = d.toLocaleDateString(undefined, {
                          year: "numeric", month: "short", day: "numeric",
                        });
                        const time = d.toLocaleTimeString(undefined, {
                          hour: "2-digit", minute: "2-digit", second: "2-digit",
                        });
                        const shortTxId = `${u.txId.slice(0, 10)}…${u.txId.slice(-6)}`;

                        return (
                          <tr
                            key={u.txId}
                            data-row
                            className="border-t border-slate-800 hover:bg-slate-800/30 transition-colors"
                          >
                            {/* Feature 2: per-row checkbox */}
                            <td className="w-10 px-3 py-3">
                              <input
                                type="checkbox"
                                checked={selectedTxIds.has(u.txId)}
                                onChange={() => toggleSelect(u.txId)}
                                className="accent-indigo-500"
                                aria-label={`Select ${u.originalName}`}
                              />
                            </td>

                            {/* Document */}
                            <td className="px-5 py-3">
                              <p className="text-slate-200 font-medium truncate max-w-[180px]">
                                {u.originalName}
                              </p>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <DocTypeBadge type={u.documentType} />
                                <span className="text-[10px] text-slate-600">
                                  {formatBytes(u.originalSize)}
                                </span>
                              </div>
                            </td>

                            {/* Access — owned vs shared */}
                            <td className="px-5 py-3">
                              {(u.ownership ?? "owned") === "shared" ? (
                                <span className="text-[10px] text-emerald-300 border border-emerald-800/50 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                                  Shared
                                </span>
                              ) : (
                                <span className="text-[10px] text-indigo-300 border border-indigo-800/50 bg-indigo-500/10 px-1.5 py-0.5 rounded">
                                  Owned
                                </span>
                              )}
                            </td>

                            {/* Tags — click to filter by that tag */}
                            <td className="px-5 py-3">
                              <div className="flex flex-wrap gap-1">
                                {u.tags && u.tags.length > 0 ? (
                                  u.tags.map((tag) => (
                                    <button
                                      key={tag}
                                      onClick={() => setSearch(tag)}
                                      title={`Filter by "${tag}"`}
                                      className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 border border-slate-600 hover:bg-indigo-600/30 hover:border-indigo-500 hover:text-indigo-200 transition-colors cursor-pointer"
                                    >
                                      {tag}
                                    </button>
                                  ))
                                ) : (
                                  <span className="text-[10px] text-slate-600">—</span>
                                )}
                              </div>
                            </td>

                            {/* Uploaded */}
                            <td className="px-5 py-3 whitespace-nowrap">
                              <span className="text-xs text-slate-300">{date}</span>
                              <span className="block text-[10px] text-slate-500 font-mono mt-0.5">{time}</span>
                            </td>

                            {/* Transaction ID */}
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-mono text-slate-400">
                                  {shortTxId}
                                </span>
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(u.txId);
                                    addToast("Transaction ID copied", "info");
                                  }}
                                  title="Copy transaction ID"
                                  aria-label="Copy transaction ID"
                                  className="text-slate-500 hover:text-slate-200 border border-slate-700 hover:border-slate-500 p-1 rounded transition-colors"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="9" y="9" width="11" height="11" rx="2" />
                                    <path d="M5 15V5a2 2 0 012-2h10" />
                                  </svg>
                                </button>
                              </div>
                            </td>

                            {/* Actions: ··· opens dropdown */}
                            <td className="px-5 py-3">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                                  setActionDropdown({
                                    type: "single",
                                    txIds: [u.txId],
                                    pos: { top: rect.bottom + 4, right: window.innerWidth - rect.right },
                                  });
                                }}
                                className="text-slate-400 hover:text-white transition-colors px-1 py-1 text-base leading-none tracking-widest"
                                aria-label="Actions"
                              >
                                ···
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <PaginationBar page={vaultRows.page} totalPages={vaultRows.totalPages} onPage={vaultRows.setPage} />
                </div>
              )}
            </div>
          )}

          {tab === "view" && (
            <div className="flex flex-col h-[calc(100vh-9rem)]">
              <div className="mb-4 shrink-0">
                <h2 className="text-lg font-semibold text-white">View a Document</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Open any Trust Vault document by its Arweave transaction ID. It is fetched,
                  decrypted in your browser, and rendered below — only an authorized wallet can decrypt it.
                </p>
              </div>

              {/* Help a recipient get access: they send their access key (public key)
                  or address to the owner. The public key works even for new wallets. */}
              <div className="flex flex-wrap items-center gap-2 mb-4 shrink-0 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-2.5">
                <span className="text-xs text-slate-500 shrink-0 inline-flex items-center gap-1">
                  Need access? Send your key to the owner
                  <HelpTip text="Give the document's owner your access key (public key) — it works even on a brand-new wallet with no transactions. They paste it into Access Keys to share documents with you. Your address also works if your wallet has made at least one transaction." />
                </span>
                <span className="text-xs font-mono text-slate-300 truncate">{address}</span>
                <button
                  onClick={async () => {
                    try {
                      const pk = await window.arweaveWallet.getActivePublicKey();
                      await navigator.clipboard.writeText(pk);
                      addToast("Your access key (public key) copied — send it to the document owner.", "info");
                    } catch {
                      addToast("Could not read your public key from the wallet.");
                    }
                  }}
                  className="shrink-0 text-[10px] text-indigo-300 border border-indigo-800/50 bg-indigo-500/10 hover:bg-indigo-500/20 px-2 py-0.5 rounded transition-colors"
                >
                  Copy access key
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(address);
                    addToast("Your wallet address copied.", "info");
                  }}
                  className="shrink-0 text-[10px] text-slate-400 border border-slate-700 hover:border-slate-500 hover:text-slate-200 px-2 py-0.5 rounded transition-colors"
                >
                  Copy address
                </button>
              </div>

              <div className="flex items-center gap-2 mb-4 shrink-0">
                <input
                  type="text"
                  placeholder="Arweave transaction ID (43 characters)"
                  value={viewTxId}
                  onChange={(e) => setViewTxId(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleView(); }}
                  className="h-9 flex-1 text-sm bg-slate-800 border border-slate-700 rounded-lg px-3 text-slate-300 placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
                />
                <button
                  onClick={handleView}
                  disabled={viewLoading || !viewTxId.trim()}
                  className="h-9 flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 rounded-lg transition-colors"
                >
                  {viewLoading ? (
                    <>
                      <span className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin shrink-0" />
                      Decrypting…
                    </>
                  ) : (
                    "Open"
                  )}
                </button>
              </div>

              <div className="flex-1 min-h-0 rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
                {viewDoc ? (
                  <div className="flex flex-col h-full">
                    <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 shrink-0">
                      <span className="text-xs text-slate-300 truncate">{viewDoc.name}</span>
                      <a
                        href={viewDoc.url}
                        download={viewDoc.name}
                        className="text-xs text-indigo-300 border border-indigo-800/50 bg-indigo-500/10 hover:bg-indigo-500/20 px-2.5 py-1 rounded-lg transition-colors shrink-0"
                      >
                        Download
                      </a>
                    </div>
                    {viewDoc.mime.startsWith("image/") ? (
                      <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center p-4">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={viewDoc.url} alt={viewDoc.name} className="max-w-full max-h-full object-contain" />
                      </div>
                    ) : (
                      <iframe src={viewDoc.url} title={viewDoc.name} className="flex-1 min-h-0 w-full bg-white" />
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-center px-8">
                    <p className="text-slate-600 text-sm">
                      {viewLoading
                        ? "Fetching and decrypting…"
                        : "Enter a transaction ID above to view a document."}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "keys" && (
            <AccessKeysView address={address} uploads={uploads} onToast={addToast} />
          )}

          {tab === "settings" && (
            <SettingsView address={address} onToast={addToast} />
          )}
        </main>
      </div>
    </div>
  );
}

// ── NavItem ──────────────────────────────────────────────────────────────────

function NavItem({
  icon,
  label,
  active = false,
  disabled = false,
  onClick,
  collapsed = false,
  badge = 0,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  collapsed?: boolean;
  badge?: number;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`group relative flex items-center ${collapsed ? "justify-center px-0" : "gap-2.5 px-3"} w-full py-2 rounded-lg text-sm transition-colors text-left ${
        disabled
          ? "text-slate-600 cursor-not-allowed"
          : active
          ? "bg-indigo-600/20 text-indigo-300 font-medium"
          : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
      }`}
    >
      <span className="relative shrink-0">
        {icon}
        {badge > 0 && collapsed && <span className="absolute -right-1.5 -top-1.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-slate-900" />}
      </span>
      {!collapsed && <span className="gtv-sb-label truncate">{label}</span>}
      {!collapsed && badge > 0 && (
        <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">{badge > 9 ? "9+" : badge}</span>
      )}
      {!collapsed && disabled && (
        <span className="ml-auto text-[10px] text-slate-700">soon</span>
      )}
      {collapsed && (
        <span className="pointer-events-none absolute left-full ml-2 px-2 py-1 rounded-md bg-slate-800 border border-slate-700 text-xs text-slate-200 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-[70] shadow-lg">
          {label}{disabled ? " (soon)" : ""}
        </span>
      )}
    </button>
  );
}

// ── Animated sidebar icons (animate on NavItem hover via `group`) ─────────────

const SVG_PROPS = {
  className: "w-4 h-4",
  fill: "none",
  viewBox: "0 0 24 24",
  stroke: "currentColor",
  strokeWidth: 2,
} as const;

// Centre-based transforms need fill-box origin so they pivot on themselves.
const CENTER: React.CSSProperties = { transformBox: "fill-box", transformOrigin: "center" };

// Small leading icons for the vault action menu / bulk bar. They inherit the
// button's text color via currentColor, so each row reads at a glance.
function ActionIcon({ name }: { name: "view" | "download" | "share" | "copy" | "file" | "external" | "block" | "lock" | "clear" }) {
  const p = {
    className: "w-3.5 h-3.5 shrink-0",
    fill: "none",
    viewBox: "0 0 24 24",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "view":
      return (<svg {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>);
    case "download":
      return (<svg {...p}><path d="M12 3v12m0 0l-4-4m4 4l4-4" /><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></svg>);
    case "share":
      return (<svg {...p}><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></svg>);
    case "copy":
      return (<svg {...p}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 012-2h10" /></svg>);
    case "file":
      return (<svg {...p}><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" /><path d="M14 3v5h5" /></svg>);
    case "external":
      return (<svg {...p}><path d="M14 5h5v5M19 5l-8 8" /><path d="M19 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h6" /></svg>);
    case "block": // 3D blockchain block — rounded corners like the other icons
      return (<svg {...p}><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></svg>);
    case "lock":
      return (<svg {...p}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>);
    case "clear":
      return (<svg {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>);
  }
}

function DashboardIcon() {
  // Four tiles that drift apart very slightly on hover (movement, not zoom).
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
  // Service Desk: a support headset with a boom microphone. On hover, sound waves radiate from the
  // mic (two arcs that fade in one after the other).
  return (
    <svg {...SVG_PROPS}>
      <g strokeLinecap="round">
        <path d="M12.6 20a2 2 0 0 1 0 3" className="opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-[.gtv-in]:opacity-100" />
        <path d="M14.4 18.8a3 3 0 0 1 0 4.6" className="opacity-0 transition-opacity duration-300 [transition-delay:120ms] group-hover:opacity-100 group-[.gtv-in]:opacity-100" />
      </g>
      <path strokeLinecap="round" d="M5.5 13V11.5A6.5 6.5 0 0 1 18.5 11.5V13" />
      <rect x="3.7" y="12" width="3.5" height="5.5" rx="1.7" />
      <rect x="16.8" y="12" width="3.5" height="5.5" rx="1.7" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.45 17.5V19A2.3 2.3 0 0 0 7.75 21.3H8.2" />
      <rect x="8" y="19.8" width="3.2" height="3" rx="1.5" />
    </svg>
  );
}

function ForumIcon() {
  // Forum: two conversation bubbles (top-left + bottom-right, like the chat icon's bubble). On hover,
  // text lines fade in inside them, one after another.
  return (
    <svg {...SVG_PROPS} strokeLinecap="round" strokeLinejoin="round">
      {/* top-left bubble, tail bottom-left */}
      <path d="M4.5 3.5H10.5a2 2 0 0 1 2 2V8a2 2 0 0 1-2 2H6l-2.5 2v-2a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2z" />
      {/* bottom-right bubble, tail bottom-right */}
      <path d="M19.5 13.5H13.5a2 2 0 0 0-2 2V18a2 2 0 0 0 2 2H18l2.5 2v-2a2 2 0 0 0 2-2v-2.5a2 2 0 0 0-2-2z" />
      {/* text lines that fade in on hover / in-view */}
      <g strokeWidth={1.6}>
        <path d="M4.4 6.2H10" className="opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-[.gtv-in]:opacity-100" />
        <path d="M4.4 8H8" className="opacity-0 transition-opacity duration-300 [transition-delay:90ms] group-hover:opacity-100 group-[.gtv-in]:opacity-100" />
        <path d="M14 16h6" className="opacity-0 transition-opacity duration-300 [transition-delay:180ms] group-hover:opacity-100 group-[.gtv-in]:opacity-100" />
        <path d="M14 17.8h3.5" className="opacity-0 transition-opacity duration-300 [transition-delay:270ms] group-hover:opacity-100 group-[.gtv-in]:opacity-100" />
      </g>
    </svg>
  );
}

function BoardIcon() {
  // Three columns flush into one block (only the OUTER corners rounded, the inner
  // seams are single shared lines) that spread apart 1px on hover where every
  // corner rounds. Sized (~12×13px ink), rounded (1px) and animated (1px) to match
  // the dashboard tiles. Built from bordered divs so the radius can animate.
  return (
    <span className="flex h-4 w-4 items-center justify-center">
      <span className="-ml-[1.15px] h-3 w-[5px] rounded-l-[2.5px] shadow-[inset_0_0_0_1.25px_currentColor] transition-all duration-300 group-hover:-translate-x-px group-hover:rounded-[2px]" />
      <span className="-ml-[1.15px] h-3 w-[5px] shadow-[inset_0_0_0_1.25px_currentColor] transition-all duration-300 group-hover:rounded-[2px]" />
      <span className="-ml-[1.15px] h-3 w-[5px] rounded-r-[2.5px] shadow-[inset_0_0_0_1.25px_currentColor] transition-all duration-300 group-hover:translate-x-px group-hover:rounded-[2px]" />
    </span>
  );
}

function CalendarIcon() {
  // Empty calendar at rest (binder rings + header). On hover two little day-squares
  // pop in inside the grid, one just after the other.
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
  // A clock; on hover the hands advance exactly one hour and rewind on leave (no spin).
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
  // Rounded speech bubble. The typing dots are hidden at rest and fade/pop in on
  // hover, one after another (a little "typing…" animation).
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
  // The same open book in both states; on hover a single page turns from the right
  // side over to the left (a right→left page turn). The turning page is the right
  // page flipped across the spine, so resting and hovered both read as a clean book.
  return (
    <svg {...SVG_PROPS}>
      <path strokeLinecap="round" d="M12 6.5v13" />
      <path strokeLinejoin="round" d="M12 6.5C10.3 5.5 7.8 5 5.5 5S3 5.3 3 5.3v11.7s1.2-.3 3.5-.3 4.8.8 5.5 1.8z" />
      <path strokeLinejoin="round" d="M12 6.5C13.7 5.5 16.2 5 18.5 5S21 5.3 21 5.3v11.7s-1.2-.3-3.5-.3-4.8.8-5.5 1.8z" />
      <path strokeLinejoin="round" style={{ transformBox: "fill-box", transformOrigin: "left center" }} className="transition-transform duration-500 ease-in-out group-hover:-scale-x-100" d="M12 6.5C13.7 5.5 16.2 5 18.5 5S21 5.3 21 5.3v11.7s-1.2-.3-3.5-.3-4.8.8-5.5 1.8z" />
    </svg>
  );
}

function HelpIcon() {
  // Question mark in a circle that gently grows on hover.
  return (
    <svg {...SVG_PROPS}>
      <circle cx="12" cy="12" r="9" />
      <g style={CENTER} className="transition-transform duration-300 group-hover:scale-110">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 9.2a2.5 2.5 0 114 2c-.8.6-1.5 1.2-1.5 2.3" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 17h.01" />
      </g>
    </svg>
  );
}

function UploadsIcon() {
  // Arrow nudges up slightly on hover (same subtle amount as the vault lid).
  return (
    <svg {...SVG_PROPS}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1" />
      <g className="transition-transform duration-300 group-hover:-translate-y-0.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0L8 8m4-4 4 4" />
      </g>
    </svg>
  );
}

function VaultIcon() {
  // Archive-box; the lid cracks open slightly from the centre on hover.
  return (
    <svg {...SVG_PROPS}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8M10 13h4" />
      <g
        style={CENTER}
        className="transition-transform duration-300 group-hover:-rotate-[8deg]"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v.01" />
      </g>
    </svg>
  );
}

function ViewIcon() {
  // Full-size document; the magnifying glass sits on top at the bottom-right
  // and glides toward the centre on hover.
  return (
    <svg {...SVG_PROPS}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 3v5h5" />
      <g className="transition-transform duration-300 group-hover:-translate-x-1 group-hover:-translate-y-1">
        <circle cx="16" cy="16" r="3.1" />
        <path strokeLinecap="round" d="M18.3 18.3 20.6 20.6" />
      </g>
    </svg>
  );
}

function KeysIcon() {
  // Previous key shape, jingles/wiggles on hover.
  return (
    <svg {...SVG_PROPS}>
      <g style={CENTER} className="group-hover:[animation:gtv-wiggle_0.5s_ease-in-out]">
        <circle cx="8" cy="16" r="4" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.8 13.2 20 4M16.5 7.5l2 2M14 10l2 2" />
      </g>
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 truncate text-right text-slate-200">{value}</dd>
    </div>
  );
}

function SettingsIcon() {
  // The original cog, scaled down to match the other icons, rotates on hover.
  return (
    <svg {...SVG_PROPS}>
      <g
        style={CENTER}
        className="scale-90 transition-transform duration-700 group-hover:rotate-90"
      >
        <circle cx="12" cy="12" r="3" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
      </g>
    </svg>
  );
}

// ── Header pieces ─────────────────────────────────────────────────────────────

// BalancePill + AccountSwitcher were moved to components/AccountSwitcher.tsx (shared with SiteHeader).

// ── DocTypeBadge ─────────────────────────────────────────────────────────────

function DocTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    Will: "bg-amber-500/15 text-amber-300 border-amber-800/40",
    Deed: "bg-sky-500/15 text-sky-300 border-sky-800/40",
    Trust: "bg-violet-500/15 text-violet-300 border-violet-800/40",
    "Power of Attorney": "bg-rose-500/15 text-rose-300 border-rose-800/40",
    Other: "bg-slate-700 text-slate-300 border-slate-600",
  };
  const cls = colors[type] ?? colors["Other"];
  return (
    <span
      className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full border ${cls}`}
    >
      {type}
    </span>
  );
}
