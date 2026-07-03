// Native crypto top-up via the Turbo SDK. Pays Turbo credits with the connected Arweave wallet
// (Wander): the SDK builds + signs an AR transfer and notifies Turbo, which credits THIS wallet.
//
// IMPORTANT — Arweave confirmation is async: the transfer is signed + posted instantly, but Turbo
// can only credit it once the tx is visible/confirmed on the gateway (minutes). So topUpWithTokens
// often posts the payment then FAILS to "submit fund transaction" because the tx isn't confirmed
// yet. We treat that as PENDING (the AR is already sent), save the tx id, and finish crediting with
// submitFundTransaction — retried automatically when the modal reopens (and manually recoverable).
//
// The SDK is imported DYNAMICALLY so it stays out of the main bundle. Extensible to other chains
// later (the SDK ships EthereumSigner / HexSolanaSigner + token maps).

const CREDIT = 1e12; // 1 credit = 1e12 winc
const PENDING_KEY = "gtv_turbo_pending_fund";

// The Turbo SDK signs the AR transfer through arbundles' ArconnectSigner, which uses Wander's
// deprecated `signature()` API — and the SDK also logs a scary "Failed to poll…" error on the
// (normal, handled) case where Arweave hasn't confirmed the tx yet. Both are third-party noise we
// already handle, so drop just those two exact lines from the console. Installed once, lazily.
let consoleFiltered = false;
function quietTurboNoise(): void {
  if (consoleFiltered || typeof window === "undefined") return;
  consoleFiltered = true;
  const noisy = (a: unknown[]) => a.some((x) => typeof x === "string" && (/signature API is deprecated/i.test(x) || /Failed to poll for transaction being available/i.test(x)));
  for (const m of ["warn", "error"] as const) {
    const orig = console[m].bind(console);
    console[m] = (...a: unknown[]) => { if (noisy(a)) return; orig(...a); };
  }
}

export type PendingFund = { txId: string; ar?: number; at: number };

function loadPending(): PendingFund[] {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || "[]") as PendingFund[]; } catch { return []; }
}
function savePending(list: PendingFund[]): void {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}
function addPending(txId: string, ar?: number): void {
  const list = loadPending();
  if (!list.some((p) => p.txId === txId)) { list.push({ txId, ar, at: Date.now() }); savePending(list); }
}
export function pendingFundTxs(): PendingFund[] { return loadPending(); }

// Pull a 43-char Arweave tx id out of the SDK's error (its message tells you to retry with it).
function txIdFromError(e: unknown): string | null {
  const withId = e as { transactionId?: string; txId?: string };
  if (typeof withId?.transactionId === "string" && withId.transactionId.length >= 43) return withId.transactionId;
  if (typeof withId?.txId === "string" && withId.txId.length >= 43) return withId.txId;
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/[a-zA-Z0-9_-]{43}/);
  return m ? m[0] : null;
}

/** Rough credits a given AR amount buys right now (no wallet, no signature). null if unavailable. */
export async function estimateArCredits(ar: number): Promise<number | null> {
  if (!(ar > 0)) return null;
  quietTurboNoise();
  try {
    const { TurboFactory, ARToTokenAmount } = await import("@ardrive/turbo-sdk/web");
    const turbo = TurboFactory.unauthenticated({ token: "arweave" });
    const { winc } = await turbo.getWincForToken({ tokenAmount: ARToTokenAmount(ar) });
    const n = Number(winc);
    return Number.isFinite(n) ? n / CREDIT : null;
  } catch {
    return null;
  }
}

export type TopUpResult = { status: "credited"; credits: number | null } | { status: "pending"; txId: string };

/**
 * Top up the connected wallet's Turbo credits by paying `ar` AR. Prompts the wallet to sign the
 * transfer (this signature IS the payment approval). Returns "credited" when Turbo confirmed it
 * immediately, or "pending" when the AR is sent but awaiting Arweave confirmation. Throws only for
 * a genuine failure (cancelled, no funds, couldn't post).
 */
export async function topUpWithAr(ar: number): Promise<TopUpResult> {
  if (!(ar > 0)) throw new Error("Enter an amount of AR to pay.");
  if (typeof window === "undefined" || !window.arweaveWallet) throw new Error("Connect a wallet first.");
  quietTurboNoise();
  const { TurboFactory, ArconnectSigner, ARToTokenAmount } = await import("@ardrive/turbo-sdk/web");
  let signer: InstanceType<typeof ArconnectSigner>;
  try {
    signer = new ArconnectSigner(window.arweaveWallet as never);
  } catch {
    throw new Error("This wallet can't sign a crypto payment. Use a card instead, or a browser-extension wallet.");
  }
  const turbo = TurboFactory.authenticated({ signer, token: "arweave" });
  try {
    const res = await turbo.topUpWithTokens({ tokenAmount: ARToTokenAmount(ar) });
    const winc = Number((res as { winc?: string })?.winc);
    return { status: "credited", credits: Number.isFinite(winc) ? winc / CREDIT : null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/reject|denied|cancel/i.test(msg)) throw new Error("Payment cancelled.");
    // The transfer was posted but not yet confirmable — save it and credit it later, and start a
    // background loop that keeps trying so the credit lands with no further action from the user.
    const txId = txIdFromError(e);
    if (txId && /submit fund|poll|available|balance|confirm/i.test(msg)) {
      addPending(txId, ar);
      startPendingRetryLoop();
      return { status: "pending", txId };
    }
    if (/insufficient|not enough|balance/i.test(msg)) throw new Error("Not enough AR in this wallet for that amount (leave a little for network fees).");
    throw new Error(`Crypto top-up failed: ${msg.slice(0, 140)}`);
  }
}

// Tx ids we've successfully had Turbo credit — so we can show which on-chain payments are already
// applied (and total up what's still pending) across reloads.
const CREDITED_KEY = "gtv_turbo_credited";
function loadCredited(): string[] { try { return JSON.parse(localStorage.getItem(CREDITED_KEY) || "[]") as string[]; } catch { return []; } }
export function creditedTxIds(): Set<string> { return new Set(loadCredited()); }
function markCredited(txId: string): void {
  const s = new Set(loadCredited()); s.add(txId);
  try { localStorage.setItem(CREDITED_KEY, JSON.stringify([...s])); } catch { /* ignore */ }
}

/** Ask Turbo to credit an already-posted fund tx. true once accepted; false if it's still
 *  unconfirmed / unknown. On success, remember it and drop it from the local pending list. */
export async function submitFundTx(txId: string): Promise<boolean> {
  const id = txId.trim();
  if (id.length < 43) return false;
  try {
    const { TurboFactory } = await import("@ardrive/turbo-sdk/web");
    const turbo = TurboFactory.unauthenticated({ token: "arweave" });
    await turbo.submitFundTransaction({ txId: id });
    markCredited(id);
    savePending(loadPending().filter((p) => p.txId !== id)); // credited → drop from pending
    return true;
  } catch {
    return false;
  }
}

/** Record a tx id as pending so the background loop keeps trying to credit it. */
export function trackPending(txId: string, ar?: number): void {
  if (txId.trim().length >= 43) { addPending(txId.trim(), ar); startPendingRetryLoop(); }
}

// ── Find past AR payments on-chain (so untracked / earlier top-ups are recoverable) ──────────────

export type TurboPayment = { txId: string; ar: number; confirmed: boolean; at: number | null };

let turboArAddr: string | null = null;
async function getTurboArAddress(): Promise<string> {
  const fallback = "JNC6vBhjHY1EPwV3pEeNmrsgFMxH5d38_LHsZ7jful8";
  if (turboArAddr) return turboArAddr;
  try {
    const a = (await (await fetch("https://upload.ardrive.io/")).json())?.addresses?.arweave;
    turboArAddr = typeof a === "string" && a.length === 43 ? a : fallback;
  } catch {
    turboArAddr = fallback;
  }
  return turboArAddr;
}

export type PaymentsSnapshot = { payments: TurboPayment[]; credited: Set<string>; creditedNow: number };

/**
 * Scan the chain for this wallet's Turbo payments and AUTOMATICALLY credit any that are confirmed
 * but not yet applied — no button, no user action. Returns the payments, the set of applied tx ids,
 * and how many were just credited (so callers can refresh the balance / notify).
 */
export async function scanAndAutoCredit(address: string): Promise<PaymentsSnapshot> {
  let payments = await findTurboPayments(address);
  let credited = creditedTxIds();
  let creditedNow = 0;
  for (const p of payments) {
    if (p.confirmed && !credited.has(p.txId)) { if (await submitFundTx(p.txId)) creditedNow++; }
  }
  if (creditedNow > 0) {
    credited = creditedTxIds();
    payments = await findTurboPayments(address);
  }
  return { payments, credited, creditedNow };
}

/**
 * All AR transfers this wallet has sent to Turbo's address, newest first — a complete, on-chain
 * record of your crypto top-ups (even ones this browser never tracked). `confirmed` = mined.
 */
export async function findTurboPayments(address: string): Promise<TurboPayment[]> {
  if (!address) return [];
  const target = await getTurboArAddress();
  const query = `query{transactions(owners:["${address}"],recipients:["${target}"],first:100,sort:HEIGHT_DESC){edges{node{id quantity{ar} block{timestamp}}}}}`;
  for (const gw of ["https://arweave.net/graphql", "https://turbo-gateway.com/graphql"]) {
    try {
      const res = await fetch(gw, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
      if (!res.ok) continue;
      const edges = (await res.json())?.data?.transactions?.edges ?? [];
      return edges.map((e: { node: { id: string; quantity?: { ar?: string }; block?: { timestamp?: number } } }) => ({
        txId: e.node.id,
        ar: Number(e.node.quantity?.ar) || 0,
        confirmed: !!e.node.block,
        at: e.node.block?.timestamp ? e.node.block.timestamp * 1000 : null,
      }));
    } catch { /* try next gateway */ }
  }
  return [];
}

/** Retry every pending fund tx (call when the modal opens). Returns how many just credited. */
export async function retryPendingFundTxs(): Promise<number> {
  let credited = 0;
  for (const p of loadPending()) { if (await submitFundTx(p.txId)) credited++; }
  return credited;
}

// Keep crediting pending payments in the background until Arweave confirms them — so the user never
// has to babysit it. Self-stops once there's nothing pending. Emits "gtv:turbo-credited" on success
// (the modal listens to refresh the balance). Survives closing the modal; a page reload restarts it
// on the next open (the pending list lives in localStorage).
let retryTimer: ReturnType<typeof setInterval> | null = null;
export function startPendingRetryLoop(): void {
  if (retryTimer || typeof window === "undefined") return;
  const stop = () => { if (retryTimer) { clearInterval(retryTimer); retryTimer = null; } };
  const tick = async () => {
    if (loadPending().length === 0) { stop(); return; }
    const credited = await retryPendingFundTxs();
    if (credited > 0) window.dispatchEvent(new CustomEvent("gtv:turbo-credited", { detail: credited }));
    if (loadPending().length === 0) stop();
  };
  retryTimer = setInterval(() => { void tick(); }, 60_000); // Arweave confirmation ≈ a few minutes
}
