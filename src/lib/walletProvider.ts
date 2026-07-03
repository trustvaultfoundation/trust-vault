// Wallet-provider detection + capability gating.
//
// The whole app talks to the standard `window.arweaveWallet` API, so ANY Arweave wallet that injects
// it works — but only if it implements the full surface the vault needs: RSA `encrypt`/`decrypt`
// (master-key wrapping + sharing), `signDataItem` (Turbo/Irys uploads), `getActivePublicKey`
// (sharing) and `getActiveAddress`. Many wallets sign but DON'T do RSA encrypt/decrypt; letting one
// of those reach the crypto layer would create an account that can never decrypt its own vault. So we
// detect what's injected and gate anything that isn't fully capable, with a clear reason.

// The methods every encrypted-vault feature relies on. Order = the order we report them missing.
const REQUIRED_METHODS = [
  "connect",
  "getActiveAddress",
  "getActivePublicKey",
  "encrypt",
  "decrypt",
  "signDataItem",
] as const;

type RequiredMethod = (typeof REQUIRED_METHODS)[number];

export interface DetectedWallet {
  /** A wallet injected `window.arweaveWallet`. */
  present: boolean;
  /** Best-effort display name ("Wander", "ArConnect", or "Arweave wallet"). */
  name: string;
  /** True when every method the vault needs is available. */
  capable: boolean;
  /** Required methods that are absent (drives the "why it's disabled" message). */
  missing: RequiredMethod[];
}

// `window.arweaveWallet` is typed as always-present in arweave.d.ts, so read it through a loose view
// that lets it be undefined (a fresh visitor with no wallet) and exposes the optional name fields.
function injected(): (Record<string, unknown> & { walletName?: string; walletVersion?: string }) | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { arweaveWallet?: Record<string, unknown> }).arweaveWallet as
    | (Record<string, unknown> & { walletName?: string; walletVersion?: string })
    | undefined;
}

function labelFor(w: Record<string, unknown> & { walletName?: string }): string {
  const raw = (w.walletName || "").toString().trim();
  if (!raw) return "Arweave wallet";
  // Wander was formerly "ArConnect" — show the current name but keep whatever the wallet reports.
  if (/arconnect/i.test(raw)) return "Wander";
  return raw;
}

/** Inspect whatever Arweave wallet is currently injected. */
export function detectWallet(): DetectedWallet {
  const w = injected();
  if (!w) return { present: false, name: "Arweave wallet", capable: false, missing: [...REQUIRED_METHODS] };
  const missing = REQUIRED_METHODS.filter((m) => typeof w[m] !== "function");
  return { present: true, name: labelFor(w), capable: missing.length === 0, missing };
}

/** Human-readable reason a present wallet can't be used (for tooltips / disabled rows). */
export function incapableReason(d: DetectedWallet): string | null {
  if (!d.present || d.capable) return null;
  const needsCrypto = d.missing.includes("encrypt") || d.missing.includes("decrypt");
  if (needsCrypto) return `${d.name} can't open encrypted vaults — it doesn't support in-wallet encryption.`;
  if (d.missing.includes("signDataItem")) return `${d.name} can't upload to the vault — it doesn't support data-item signing.`;
  return `${d.name} is missing required wallet features (${d.missing.join(", ")}).`;
}

/**
 * Throw a friendly error unless a fully-capable wallet is injected. Call this before any connect that
 * leads into the encrypted vault, so a half-supported wallet never corrupts an account.
 */
export function requireCapableWallet(): void {
  const d = detectWallet();
  if (!d.present) {
    throw new Error("No Arweave wallet found. Install Wander (wander.app) or use Arweave.app, then try again.");
  }
  if (!d.capable) {
    throw new Error(incapableReason(d) ?? "This wallet doesn't support TrustVault's encrypted vault.");
  }
}
