// Wallets the user has linked to this account/browser. Each Arweave wallet — whether an embedded
// social wallet (Wander Connect: email/passkey/Google/Apple…) or a browser-extension wallet — is
// its OWN account: its vault, boards, chat, calendar etc. are encrypted under THAT wallet's master
// key and keyed by its address. This store just remembers the set so the user can switch between
// them; it never merges data. The list rides in the encrypted snapshot (registered in stateSync)
// so it survives a cache wipe; the "active" pointer is a per-device preference (local only).

export type WalletType = "embedded" | "extension";
export interface LinkedWallet { address: string; type: WalletType; label?: string; addedAt: number }

const KEY = "gtv_linked_wallets";
const ACTIVE = "gtv_active_wallet";

export function listLinkedWallets(): LinkedWallet[] {
  if (typeof window === "undefined") return [];
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]") as LinkedWallet[];
    return Array.isArray(list) ? list.filter((w) => w && typeof w.address === "string") : [];
  } catch {
    return [];
  }
}

function save(list: LinkedWallet[]): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* quota */ }
}

/** Add (or refresh the type/label of) a linked wallet. Returns the new list. */
export function addLinkedWallet(w: { address: string; type: WalletType; label?: string }): LinkedWallet[] {
  if (!w.address) return listLinkedWallets();
  const list = listLinkedWallets();
  const i = list.findIndex((x) => x.address === w.address);
  if (i >= 0) list[i] = { ...list[i], type: w.type, label: w.label ?? list[i].label };
  else list.push({ address: w.address, type: w.type, label: w.label, addedAt: Date.now() });
  save(list);
  return list;
}

export function removeLinkedWallet(address: string): LinkedWallet[] {
  const list = listLinkedWallets().filter((x) => x.address !== address);
  save(list);
  if (getActiveWallet() === address) setActiveWallet(list[0]?.address ?? null);
  return list;
}

export function renameLinkedWallet(address: string, label: string): LinkedWallet[] {
  const list = listLinkedWallets();
  const i = list.findIndex((x) => x.address === address);
  if (i >= 0) { list[i] = { ...list[i], label }; save(list); }
  return list;
}

export function getLinkedWallet(address: string | null): LinkedWallet | null {
  if (!address) return null;
  return listLinkedWallets().find((w) => w.address === address) ?? null;
}

export function getActiveWallet(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE);
}

export function setActiveWallet(address: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (address) localStorage.setItem(ACTIVE, address);
    else localStorage.removeItem(ACTIVE);
  } catch { /* ignore */ }
}

const short = (a: string) => (a && a.length > 10 ? `${a.slice(0, 5)}…${a.slice(-4)}` : a || "?");
/** A human label for a linked wallet (custom label, else a shortened address). */
export function walletLabel(w: LinkedWallet | null): string {
  if (!w) return "";
  return w.label?.trim() || short(w.address);
}
