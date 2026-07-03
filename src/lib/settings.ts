// Application-wide settings, persisted in localStorage.

export type NetworkEnv = "mainnet" | "devnet";

export interface VaultSettings {
  /** Active Arweave / ar.io gateway provider URL. */
  gatewayUrl: string;
  /** Irys network the uploads are funded/sent on. */
  network: NetworkEnv;
  /** When true, decrypted keys are cached for the session; when false, keys are
   *  never written to storage (zero-trace) and wiped on tab close. */
  decryptionCaching: boolean;
}

export const IRYS_NODES: Record<NetworkEnv, string> = {
  mainnet: "https://node2.irys.xyz",
  devnet: "https://devnet.irys.xyz",
};

export const DEFAULT_SETTINGS: VaultSettings = {
  // arweave.net is the most reliably-resolving gateway; ar-io.net can be blocked by some
  // networks/DNS/adblockers (ERR_NAME_NOT_RESOLVED), which would break reads app-wide.
  gatewayUrl: "https://arweave.net",
  network: "mainnet",
  decryptionCaching: true,
};

const KEY = "gtv_settings";

export function loadSettings(): VaultSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: VaultSettings): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable — non-critical */
  }
}

/** Remove every cached decryption key (per-file + master) from this browser. */
export function clearCachedKeys(): number {
  if (typeof window === "undefined") return 0;
  let removed = 0;
  for (const store of [localStorage, sessionStorage]) {
    const toRemove: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && (k.startsWith("gtv_aes_") || k.startsWith("gtv_master_"))) toRemove.push(k);
    }
    for (const k of toRemove) {
      store.removeItem(k);
      removed++;
    }
  }
  return removed;
}
