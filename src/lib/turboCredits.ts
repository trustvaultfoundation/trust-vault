// Turbo (ArDrive) credits — top up the CURRENT wallet address so larger uploads succeed.
//
// Uploads under Turbo's free tier (~100 KiB) cost nothing; above it they draw on "Turbo
// credits" held against a wallet address. Credits are bought with a card (Stripe) through
// Turbo's Payment Service, which credits a *destination address* — so a top-up is tied to the
// connected wallet and works from any device. No AR / self-funding and no wallet signature is
// needed for a fiat top-up (the payment is what funds it).
//
// This talks to the public Payment Service REST API directly (CORS-enabled, same service the
// Turbo SDK uses) so it works in the static, server-less build.

const PAYMENT_URL = "https://payment.ardrive.io/v1";
const GiB = 1024 * 1024 * 1024;

// Turbo's free tier: files (data items) at or under this size upload for free. Fetched from the
// upload service so it tracks any change, with a safe fallback. This is why a small file's real
// cost is $0 even though the raw byte price is non-zero.
export const FREE_UPLOAD_LIMIT = 107520; // ~105 KiB (fallback)
let cachedFreeLimit: number | null = null;
export async function getFreeUploadLimit(): Promise<number> {
  if (cachedFreeLimit != null) return cachedFreeLimit;
  try {
    const res = await fetch("https://upload.ardrive.io/");
    const n = Number((await res.json())?.freeUploadLimitBytes);
    cachedFreeLimit = n > 0 ? n : FREE_UPLOAD_LIMIT;
  } catch {
    cachedFreeLimit = FREE_UPLOAD_LIMIT;
  }
  return cachedFreeLimit;
}

// 1 credit = 1e12 winston credits ("winc").
const WINC_PER_CREDIT = 1e12;

export function creditsFromWinc(winc: string | number | null | undefined): number | null {
  if (winc == null) return null;
  const n = Number(winc);
  return Number.isFinite(n) ? n / WINC_PER_CREDIT : null;
}

/** Best-effort Turbo credit balance for an address, in credits. null if unavailable. */
export async function getTurboBalance(address: string): Promise<number | null> {
  try {
    const res = await fetch(`${PAYMENT_URL}/account/balance/arweave?address=${encodeURIComponent(address)}`);
    if (!res.ok) return null;
    const d = await res.json();
    const winc = d?.winc ?? d?.effectiveBalance ?? d?.controlledWinc;
    return creditsFromWinc(winc);
  } catch {
    return null;
  }
}

/** winc it costs to store 1 GiB right now (for a rough "how much storage" estimate). */
export async function getWincPerGiB(): Promise<number | null> {
  try {
    const res = await fetch(`${PAYMENT_URL}/price/bytes/${GiB}`);
    if (!res.ok) return null;
    const winc = Number((await res.json())?.winc);
    return winc > 0 ? winc : null;
  } catch {
    return null;
  }
}

/** winc credited for a USD amount (in cents). */
export async function getWincForUsd(usdCents: number): Promise<number | null> {
  try {
    const res = await fetch(`${PAYMENT_URL}/price/usd/${Math.round(usdCents)}`);
    if (!res.ok) return null;
    const winc = Number((await res.json())?.winc);
    return winc > 0 ? winc : null;
  } catch {
    return null;
  }
}

/** winc it costs to store `bytes` right now. */
async function getWincForBytes(bytes: number): Promise<number | null> {
  try {
    const res = await fetch(`${PAYMENT_URL}/price/bytes/${Math.max(0, Math.round(bytes))}`);
    if (!res.ok) return null;
    const winc = Number((await res.json())?.winc);
    return Number.isFinite(winc) ? winc : null;
  } catch {
    return null;
  }
}

/**
 * Rough USD cost to permanently store `bytes` — the same Turbo pricing a top-up uses, so the
 * upload estimate and the "Add credits" amounts speak the same currency. null if unavailable.
 */
export async function getUploadUsd(bytes: number): Promise<number | null> {
  const [fileWinc, wincPerDollar] = await Promise.all([getWincForBytes(bytes), getWincForUsd(100)]);
  if (!fileWinc || !wincPerDollar) return null;
  return fileWinc / wincPerDollar;
}

/** Rough GiB of permanent storage a USD top-up buys. null if the price API is unavailable. */
export async function estimateGiBForUsd(usdCents: number): Promise<number | null> {
  const [bought, perGiB] = await Promise.all([getWincForUsd(usdCents), getWincPerGiB()]);
  if (!bought || !perGiB) return null;
  return bought / perGiB;
}

/**
 * Start a hosted (Stripe) checkout that tops up `address` with credits and return the URL to
 * open. `usdCents` is the charge in cents (Turbo min is $5). Throws with a friendly message.
 */
export async function createTurboCheckout(address: string, usdCents: number): Promise<{ url: string; credits: number | null }> {
  const cents = Math.round(usdCents);
  const res = await fetch(`${PAYMENT_URL}/top-up/checkout-session/${address}/usd/${cents}?destinationAddressType=arweave`);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    if (res.status === 400 || res.status === 404) {
      throw new Error("Turbo couldn't start checkout for that amount (min is $5). Try a different amount.");
    }
    throw new Error(`Turbo checkout is unavailable right now (${res.status}). ${t.slice(0, 100)}`.trim());
  }
  const data = await res.json();
  const url: unknown = data?.paymentSession?.url ?? data?.url;
  if (typeof url !== "string" || !/^https?:\/\//.test(url)) {
    throw new Error("Turbo didn't return a checkout link. Please try again, or top up at turbo.ardrive.io.");
  }
  return { url, credits: creditsFromWinc(data?.topUpQuote?.winstonCreditAmount ?? data?.winc) };
}

export const USD_PRESETS = [5, 10, 25, 50] as const;
