// Durable state ⇄ Arweave snapshots.
//
// The cache-independent source of truth for all section state — using the SAME proven
// pattern masterKey.ts already uses for the master key: encrypt → sign a data item with the
// wallet → upload via Turbo (free for small blobs) → query it back by tag on a fresh device.
// localStorage stays as the synchronous in-session cache; on connect we HYDRATE it from the
// latest snapshot, and a background driver PUSHES a fresh snapshot when state changes.
//
// AO was the original plan but its network is mid-migration (legacynet sunset, HyperBEAM
// tooling not ready), so this reuses the battle-tested Arweave path instead. The whole
// thing is gated by NEXT_PUBLIC_STATE_SYNC — unset ⇒ no-op, app behaves as before.
import { getMasterKey, wrapWithMaster, unwrapRawWithMaster } from "./masterKey";
import { gqlQuery } from "./gql";

const APP_NAME = "GTV-State-v1";
const UPLOAD_URL = "https://upload.ardrive.io/v1/tx";
const GQL_ENDPOINTS = ["https://turbo-gateway.com/graphql", "https://arweave.net/graphql"];
const GATEWAYS = ["https://turbo-gateway.com", "https://arweave.net"];

export const syncEnabled = (): boolean => !!process.env.NEXT_PUBLIC_STATE_SYNC && typeof window !== "undefined";

// ── what's in a snapshot ────────────────────────────────────────────────────────
// EVERY store that holds authoritative user-created state: the SINGLE per-wallet (plus a few
// global) keys below, and per-id state (board/chat state + board docs) for ids in this
// wallet's OWN lists (so we never capture another wallet's data sharing the same browser).
// DELIBERATELY EXCLUDED — audited 2026-06-14 — because they rebuild from Arweave or must not
// leave the device: on-chain caches (gtv_boardevents_ / gtv_chatmsgcache2_ /
// gtv_chatreactcache_ / gtv_caleventcache_ / gtv_calshared_ / gtv_calkey_from_ / gtv_aes_),
// the unpublished outbox (gtv_boardpending_), local share-time hints that self-heal from
// on-chain grants (gtv_shares_ / gtv_revokes_), the separately-recoverable master key
// (gtv_master_*), the sync marker itself (gtv_state_ts_), and per-browser UI prefs
// (gtv_sidebar_collapsed / gtv_cookie_consent_v1).
// NOTE: gtv_boardkey_ / gtv_chatkey_ ARE included (OWNED, below) — for boards/chats you OWN
// the AES key is random and has NO on-chain copy (shareBoard wraps it only to members, never
// to the owner), so the snapshot is its only durable home. Lose it and the on-chain event log
// is undecryptable. Vault docs differ — each carries its own master-wrapped key in its tags.
const SINGLE: ((a: string) => string)[] = [
  (a) => `gtv_uploads_${a}`, () => `gtv_settings`, (a) => `gtv_inheritance_${a}`, (a) => `gtv_identities_${a}`,
  (a) => `gtv_calendar_${a}`, (a) => `gtv_calmuted_${a}`, (a) => `gtv_boards_${a}`, (a) => `gtv_board_current_${a}`,
  (a) => `gtv_board_project_${a}`, (a) => `gtv_chats_${a}`, (a) => `gtv_chataliases_${a}`, (a) => `gtv_chatreads_${a}`,
  (a) => `gtv_dashboard_config_${a}`, (a) => `gtv_dashboard_layout_${a}`, (a) => `gtv_dashboard_range_${a}`, (a) => `gtv_dashboard_gran_${a}`,
  (a) => `gtv_subdomain_${a}`,                // claimed ArNS name
  (a) => `gtv_itsm_${a}`,                     // Service Desk records (incidents/requests/changes/problems)
  (a) => `gtv_itsmseen_${a}`,                 // Service Desk notification "seen" marks
  // Global (not address-scoped) authoritative stores. gtv_calkey is your calendar encryption
  // key — local-only otherwise, so a wipe would silently rotate it and break sharing continuity.
  () => `gtv_calkey`, () => `gtv_calgranted`, // calendar key + "already granted to" set
  () => `gtv_passwords`,                      // saved reusable download passwords
  () => `gtv_linked_wallets`,                 // the set of wallets/accounts the user has linked
];
const OWNED: { key: (id: string) => string; ids: (a: string) => string[] }[] = [
  { key: (id) => `gtv_boardstate_${id}`, ids: (a) => listIds(`gtv_boards_${a}`) },
  { key: (id) => `gtv_boarddocs_${id}`, ids: (a) => listIds(`gtv_boards_${a}`) },
  { key: (id) => `gtv_boardkey_${id}`, ids: (a) => listIds(`gtv_boards_${a}`) }, // owner key — snapshot is its only durable home
  { key: (id) => `gtv_chatstate_${id}`, ids: (a) => listIds(`gtv_chats_${a}`) },
  { key: (id) => `gtv_chatkey_${id}`, ids: (a) => listIds(`gtv_chats_${a}`) },   // owner key — same
];

function listIds(lsKey: string): string[] {
  try {
    const raw = localStorage.getItem(lsKey);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.map((x) => (x as { id?: unknown })?.id).filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// Prefix-scanned stores: keyed by something other than a tracked id list (e.g. an owner address),
// so we sweep localStorage for them. gtv_calkey_from_<owner> is a shared calendar's key — syncing
// it (like the board/chat keys) means a fresh device restores it from the snapshot instead of a
// per-calendar wallet decrypt prompt.
const PREFIXES = ["gtv_calkey_from_"];

// One snapshot = { [localStorageKey]: value } for every store this wallet owns.
function collectState(address: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of SINGLE) {
    const k = f(address);
    const v = localStorage.getItem(k);
    if (v != null) out[k] = v;
  }
  for (const s of OWNED) {
    for (const id of s.ids(address)) {
      const k = s.key(id);
      const v = localStorage.getItem(k);
      if (v != null) out[k] = v;
    }
  }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && PREFIXES.some((p) => k.startsWith(p))) { const v = localStorage.getItem(k); if (v != null) out[k] = v; }
    }
  } catch { /* ignore */ }
  return out;
}

// ── crypto + helpers ────────────────────────────────────────────────────────────
const encoder = new TextEncoder();
const decoder = new TextDecoder();
function masterCached(address: string): boolean {
  try { return !!localStorage.getItem(`gtv_master_${address}`); } catch { return false; }
}
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + ":" + s.length;
}
const lastHash = new Map<string, string>(); // address → last-pushed snapshot hash

// The Unix-Time of the snapshot our local cache currently reflects — PERSISTED (not just
// in-memory) so it survives reloads. This is what makes restore correct on every path:
//   • after a cache wipe it's gone (→ 0), so the newest snapshot is adopted (recovery);
//   • on a normal reload it equals our last push, so we skip — never clobbering an unpushed
//     local edit, and never reload-looping (the just-restored value is already recorded);
//   • a device whose value is OLDER adopts a strictly-newer remote (genuine cross-device pull).
// It's a local-only marker (NOT in the SINGLE/OWNED registry) so it never rides in a snapshot.
const TS_KEY = (a: string) => `gtv_state_ts_${a}`;
function appliedTs(address: string): number {
  try { return Number(localStorage.getItem(TS_KEY(address))) || 0; } catch { return 0; }
}
function setAppliedTs(address: string, ts: number): void {
  try { localStorage.setItem(TS_KEY(address), String(ts)); } catch { /* ignore */ }
}

function wallet() {
  return window.arweaveWallet as unknown as {
    signDataItem?: (item: { data: Uint8Array; tags: { name: string; value: string }[] }) => Promise<ArrayBuffer | { getRaw(): Uint8Array }>;
  };
}

// Sign + Turbo-upload an encrypted snapshot. `signDataItem` is the SILENT upload path (no
// wallet popup — same as document uploads); `dispatch()` shows a transfer confirmation, so we
// must NOT use it here. Combined with pushing only on tab-hide/leave (see startStateSync), the
// user is never asked to approve a snapshot while they're working.
async function upload(body: Uint8Array, ts: number): Promise<string | null> {
  const w = wallet();
  if (typeof w.signDataItem !== "function") return null;
  const tags = [
    { name: "App-Name", value: APP_NAME },
    { name: "Content-Type", value: "application/octet-stream" },
    { name: "Unix-Time", value: String(ts) },
  ];
  try {
    const signed = await w.signDataItem({ data: body, tags });
    let buf: ArrayBuffer;
    if (signed && typeof (signed as { getRaw?: unknown }).getRaw === "function") {
      const raw = (signed as { getRaw(): Uint8Array }).getRaw();
      buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
    } else {
      buf = signed as ArrayBuffer;
    }
    const res = await fetch(UPLOAD_URL, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: buf });
    if (!res.ok) return null;
    const text = await res.text();
    try { return (JSON.parse(text) as { id?: string }).id?.trim() || null; } catch { return text.trim() || null; }
  } catch {
    return null;
  }
}

async function newestSnapshot(address: string): Promise<{ txId: string; ts: number } | null> {
  // Fetch the most recent few and pick the highest Unix-Time — more robust than HEIGHT_DESC
  // alone when a just-uploaded bundle isn't mined into a block yet.
  const query = `query($o:[String!]!){transactions(owners:$o,tags:[{name:"App-Name",values:["${APP_NAME}"]}],first:5,sort:HEIGHT_DESC){edges{node{id tags{name value}}}}}`;
  for (const ep of GQL_ENDPOINTS) {
    const json = await gqlQuery<{ id: string; tags: { name: string; value: string }[] }>(ep, query, { o: [address] });
    const edges = json?.data?.transactions?.edges;
    if (edges && edges.length) {
      let best: { txId: string; ts: number } | null = null;
      for (const e of edges) {
        const ts = Number(e.node.tags?.find((t) => t.name === "Unix-Time")?.value || 0);
        if (!best || ts > best.ts) best = { txId: e.node.id, ts };
      }
      if (best) return best;
    }
  }
  return null;
}

async function fetchBytes(txId: string): Promise<Uint8Array | null> {
  for (const gw of GATEWAYS) {
    try {
      const r = await fetch(`${gw}/${txId}`);
      if (r.ok) return new Uint8Array(await r.arrayBuffer());
    } catch {
      /* try next */
    }
  }
  return null;
}

// ── public API ──────────────────────────────────────────────────────────────────
/** Upload a fresh encrypted snapshot if state changed (best-effort; needs a cached key). */
export async function pushSnapshot(address: string | null): Promise<void> {
  if (!syncEnabled() || !address || !masterCached(address)) return;
  const json = JSON.stringify(collectState(address));
  const h = hash(json);
  if (lastHash.get(address) === h) return; // unchanged since last push
  try {
    const master = await getMasterKey(false);
    const body = await wrapWithMaster(master, encoder.encode(json));
    const ts = Date.now();
    if (await upload(body, ts)) {
      lastHash.set(address, h);
      setAppliedTs(address, ts); // our local cache now reflects this snapshot's time
    }
  } catch {
    /* best-effort */
  }
}

/** Immediate snapshot push (used by hot paths like a finished upload). */
export function mirror(address: string | null): void {
  if (syncEnabled() && address) void pushSnapshot(address);
}

/**
 * Restore localStorage from the newest Arweave snapshot (the cache-clear recovery path).
 * `allowPrompt` permits a one-popup master-key recovery (needed on a fresh device / after a
 * cache wipe, where the key isn't cached) — gated below so it only fires once a snapshot
 * actually exists to restore (new users with nothing on-chain never get prompted). `reload`
 * reloads the page once after a restore so the already-mounted UI re-reads the repopulated
 * cache. Seeds the push-hash so we don't re-upload what we just pulled.
 */
export async function hydrate(
  address: string | null,
  opts?: { allowPrompt?: boolean; reload?: boolean }
): Promise<void> {
  if (!syncEnabled() || !address) return;
  if (!opts?.allowPrompt && !masterCached(address)) return;

  const snap = await newestSnapshot(address);
  if (!snap) return;
  // Only adopt a snapshot strictly newer than what our cache already reflects — so we never
  // clobber a fresh local edit with a stale remote, while another device's newer state flows
  // in. Persisted, so a normal reload (snap == our last push) is a no-op (no clobber, no loop).
  if (snap.ts && snap.ts <= appliedTs(address)) return;
  const bytes = await fetchBytes(snap.txId);
  if (!bytes) return;

  let obj: Record<string, string>;
  try {
    const master = await getMasterKey(false);
    obj = JSON.parse(decoder.decode(await unwrapRawWithMaster(master, bytes)));
  } catch {
    return; // can't decrypt (no key) or bad blob
  }

  let changed = false;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && localStorage.getItem(k) !== v) {
      localStorage.setItem(k, v);
      changed = true;
    }
  }
  setAppliedTs(address, snap.ts || Date.now()); // record BEFORE any reload → no reload loop
  lastHash.set(address, hash(JSON.stringify(collectState(address))));
  if (!changed) return;
  // The app already rendered from the empty/stale cache, and components read localStorage once
  // on mount — so a fresh restore won't appear until they re-read. On the initial connect/
  // reconnect hydrate we reload once so everything re-reads the now-populated cache; periodic
  // cross-device ticks just signal via the event (no disruptive mid-session reload).
  if (opts?.reload) { window.location.reload(); return; }
  window.dispatchEvent(new Event("gtv-state-synced"));
}

/** Establish a master key (one popup if brand-new) so state can be encrypted. */
export async function ensureKey(): Promise<void> {
  try { await getMasterKey(true); } catch { /* dismissed — retry later */ }
}

// The initial snapshot restore for the active wallet. Feature key-unwraps (board/chat/calendar)
// await this before prompting the wallet to decrypt a per-item key — so the key that's already in
// the encrypted snapshot (unlocked once by the master key) is used instead of a per-item popup.
let initialHydrate: Promise<void> | null = null;

/**
 * Resolve once the initial snapshot restore for the active wallet has settled (or immediately if
 * sync is off, or no restore has started). Feature key-unwraps await this before prompting the
 * wallet, so the snapshot's copy of the key is used instead of a per-item decrypt popup. If the
 * restore reloads the page (fresh device), this simply never resolves and the reload takes over.
 */
export function whenHydrated(): Promise<void> {
  if (!syncEnabled()) return Promise.resolve();
  return initialHydrate ?? Promise.resolve();
}

/** Start the background sync for this wallet (silent hydrate + periodic push). Cleanup fn. */
export function startStateSync(address: string | null): () => void {
  if (!syncEnabled() || !address) return () => {};
  // Initial restore: allow the one-tap master-key recovery (cache-clear / fresh device) and
  // reload once so the UI shows the restored data. Only prompts/reloads if a newer snapshot
  // exists — a normal reload (cache intact, key cached) is silent and no-op.
  initialHydrate = hydrate(address, { allowPrompt: true, reload: true }).catch(() => {});
  // PULL (hydrate) is silent — it just reads + decrypts with the cached key — so we do it on a
  // timer to pick up other devices' changes. PUSH (which signs a snapshot) is what shows a
  // wallet prompt, so we only do it when the tab is hidden or the page is leaving — never while
  // the user is actively editing. That's the fix for "it keeps asking me to approve."
  const pull = () => { void hydrate(address); };
  const flush = () => { void pushSnapshot(address); };
  const interval = setInterval(pull, 30000);
  const onHide = () => { if (document.visibilityState === "hidden") flush(); };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", flush);
  return () => {
    clearInterval(interval);
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", flush);
  };
}
