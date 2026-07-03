"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  addLinkedWallet,
  setActiveWallet,
  getActiveWallet,
  listLinkedWallets,
  getLinkedWallet,
  type LinkedWallet,
  type WalletType,
} from "@/lib/linkedWallets";
import { requireCapableWallet } from "@/lib/walletProvider";
import { isMobileDevice } from "@/lib/useIsMobile";
import {
  createPasskeyWallet,
  recoverPasskeyWallet,
  installEmbeddedProvider,
  uninstallEmbeddedProvider,
  loadEmbeddedSession,
  clearEmbeddedSession,
  isEmbeddedInstalled,
  savedExtensionProvider,
} from "@/lib/embeddedWallet";

const PERMISSIONS: ArConnectPermission[] = [
  "ACCESS_ADDRESS",
  "ACCESS_PUBLIC_KEY",
  // Enumerate the extension's accounts (getAllAddresses) so Settings can suggest the user's other
  // accounts to add — without it Wander logs "Missing permission ACCESS_ALL_ADDRESSES".
  "ACCESS_ALL_ADDRESSES",
  "SIGN_TRANSACTION",
  "ENCRYPT",
  "DECRYPT",
  "DISPATCH",
  // Raw byte signing — used by signDataItem() (upload) and by @irys/sdk.
  // NOTE: signDataItem() needs no dedicated permission; "SIGN_DATA_ITEM" is not
  // a valid ArConnect permission and including it makes connect() reject the
  // whole array with "Input is not a valid permission".
  "SIGNATURE",
  // Wander's sign() and dispatch() call getArweaveConfig() internally to
  // resolve the gateway URL. Without this permission the call returns undefined,
  // tripping an "expected to be not undefined" assertion inside the extension.
  "ACCESS_ARWEAVE_CONFIG",
];

const APP_INFO = { name: "Generational Trust Vault" };

// Durable-state bridge (encrypted Arweave snapshots — see lib/stateSync). Guarded so the
// sync code only loads when NEXT_PUBLIC_STATE_SYNC is set — otherwise these are no-ops and the
// app behaves exactly as on pure local storage. On an EXPLICIT connect we establish/recover the
// master key (one popup) so a brand-new user can encrypt their first snapshot. RESTORE (pulling
// existing on-chain state) is owned entirely by the background driver's initial hydrate — which
// fires on the same address change for BOTH connect and silent reconnect — so the cache-clear
// recovery (prompt + page reload) happens exactly once, with no connect-vs-driver race.
const SYNC_ON = typeof process !== "undefined" && !!process.env.NEXT_PUBLIC_STATE_SYNC;

function syncOnConnect(address: string): void {
  if (!SYNC_ON || typeof window === "undefined") return;
  void address;
  import("@/lib/stateSync")
    .then(async (m) => { await m.ensureKey(); })
    .catch(() => {});
}

// Wait for the browser-extension wallet API to be injected (the extension does this async on load).
function waitForWalletApi(timeoutMs = 4000): Promise<boolean> {
  if (typeof window !== "undefined" && window.arweaveWallet) return Promise.resolve(true);
  return new Promise((resolve) => {
    const start = Date.now();
    const id = setInterval(() => {
      if (typeof window !== "undefined" && window.arweaveWallet) {
        clearInterval(id);
        resolve(true);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(id);
        resolve(false);
      }
    }, 100);
  });
}

interface WalletState {
  address: string | null;
  balance: string | null;
  walletType: WalletType | null;
  isConnecting: boolean;
  isConnected: boolean;
  isReady: boolean;
  connect: () => Promise<void>;
  /** Passwordless, no-extension sign-in: a passkey-backed embedded Arweave wallet.
   *  `create` mints a new wallet; otherwise it recovers the wallet linked to an existing passkey. */
  connectPasskey: (create: boolean) => Promise<void>;
  /** Make a linked account active. The extension owns the active account (no setActiveAddress API),
   *  so this follows the extension if it's already switched, otherwise it asks the user to switch
   *  in the extension (the app then follows automatically). */
  switchWallet: (address: string) => Promise<void>;
  disconnect: () => Promise<void>;
  linkedWallets: LinkedWallet[];
  refreshLinkedWallets: () => void;
  addWallet: (address: string) => void;
  listAccounts: () => Promise<string[]>;
}

const WalletContext = createContext<WalletState | null>(null);

async function fetchBalance(address: string): Promise<string> {
  const res = await fetch(`https://arweave.net/wallet/${address}/balance`);
  const winstons = await res.text();
  const ar = (parseFloat(winstons) / 1e12).toFixed(4);
  return ar;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [walletType, setWalletType] = useState<WalletType | null>(null);
  const [linkedWallets, setLinkedWallets] = useState<LinkedWallet[]>(() => listLinkedWallets());
  const [isConnecting, setIsConnecting] = useState(false);
  // false until the first restore attempt settles — lets route guards wait instead of
  // bouncing a returning (soon-to-be-connected) user who deep-links into a section.
  const [isReady, setIsReady] = useState(false);

  const refreshLinkedWallets = useCallback(() => setLinkedWallets(listLinkedWallets()), []);
  // Mirror of `address` readable inside stable callbacks/listeners without re-subscribing.
  const addressRef = useRef<string | null>(null);
  useEffect(() => { addressRef.current = address; }, [address]);
  // Mirror of walletType so listeners can tell an embedded (passkey) session from an extension one.
  const walletTypeRef = useRef<WalletType | null>(null);

  // Mark a wallet active: show it, kick off the encrypted-snapshot sync, load its balance. Does
  // NOT add it to the saved list — following the extension's active account must never auto-grow the
  // list (the user only wants accounts they explicitly add). Saving is explicit (rememberWallet).
  const applyActive = useCallback(async (addr: string, type: WalletType = "extension") => {
    if (addr === addressRef.current) return; // already active — don't churn state/effects
    setAddress(addr);
    setWalletType(type);
    walletTypeRef.current = type;
    setActiveWallet(addr);
    // NOTE: do NOT setLinkedWallets here — applyActive doesn't change the saved list, and
    // recreating the array on every focus "follow" re-triggered downstream effects.
    syncOnConnect(addr); // establish/recover the master key + hydrate
    try { setBalance(await fetchBalance(addr)); } catch { setBalance(null); }
  }, []);

  // Explicitly save a wallet to the user's list (on a deliberate connect, or "Add" in Settings).
  const rememberWallet = useCallback((addr: string, type: WalletType = "extension") => {
    addLinkedWallet({ address: addr, type });
    setLinkedWallets(listLinkedWallets());
  }, []);
  const addWallet = useCallback((addr: string) => rememberWallet(addr), [rememberWallet]);

  // The extension's OTHER accounts — used to SUGGEST wallets to add in Settings. Needs the
  // ACCESS_ALL_ADDRESSES permission we request; returns [] if unsupported / locked.
  const listAccounts = useCallback(async (): Promise<string[]> => {
    try {
      // During a passkey (embedded) session the shim owns window.arweaveWallet and only knows the one
      // embedded address — enumerate the REAL extension it replaced, so Settings can still suggest the
      // user's Wander accounts to add.
      const provider = (isEmbeddedInstalled() ? savedExtensionProvider() : window.arweaveWallet) as
        | { getAllAddresses?: () => Promise<string[]> }
        | undefined;
      if (provider?.getAllAddresses) return (await provider.getAllAddresses()) || [];
    } catch { /* locked / unsupported */ }
    return [];
  }, []);

  // Re-read the extension's active address and follow it if it changed — this is what makes
  // switching accounts IN the Wander extension take effect in the app. getActiveAddress is
  // transiently empty ("No active address") while the extension switches, so retry briefly.
  // Returns the resolved active address (or the current one if nothing settled).
  const syncActiveAddress = useCallback(async (): Promise<string | null> => {
    if (typeof window === "undefined" || !window.arweaveWallet) return addressRef.current;
    let addr = "";
    for (let i = 0; i < 5; i++) {
      try { addr = (await window.arweaveWallet.getActiveAddress()) || ""; } catch { addr = ""; }
      if (addr) break;
      await new Promise((r) => setTimeout(r, 350));
    }
    if (!addr) return addressRef.current;
    if (addr !== addressRef.current) await applyActive(addr);
    return addr;
  }, [applyActive]);

  // Follow active-account changes from the extension:
  //  • the standard ArConnect `walletSwitch` event (use its address directly when present), and
  //  • the tab regaining focus (covers switching the account in the extension in another window).
  useEffect(() => {
    if (isMobileDevice()) return; // desktop-only: don't poll the wallet on phones/tablets
    // An embedded (passkey) session owns window.arweaveWallet itself — extension account-switch
    // events don't apply, so don't follow them (they'd mislabel the session as an extension).
    const follow = () => { if (walletTypeRef.current === "embedded") return; void syncActiveAddress(); };
    const onSwitch = (e: Event) => {
      if (walletTypeRef.current === "embedded") return;
      const a = (e as CustomEvent).detail?.address as string | undefined;
      if (a && a !== addressRef.current) void applyActive(a);
      else follow();
    };
    window.addEventListener("walletSwitch", onSwitch as EventListener);
    window.addEventListener("focus", follow);
    return () => {
      window.removeEventListener("walletSwitch", onSwitch as EventListener);
      window.removeEventListener("focus", follow);
    };
  }, [syncActiveAddress, applyActive]);

  // Connect whatever Arweave wallet is injected (Wander or any other that implements the full API).
  const connect = useCallback(async () => {
    try {
      setIsConnecting(true);
      // Gate an absent wallet, or one that can't do the encrypt/decrypt/signDataItem the vault needs,
      // with a clear reason — so a half-supported wallet never reaches the crypto layer.
      requireCapableWallet();
      await window.arweaveWallet.connect(PERMISSIONS as any, APP_INFO);
      const addr = await window.arweaveWallet.getActiveAddress();
      await applyActive(addr);
      rememberWallet(addr); // explicit sign-in → save this account
    } finally {
      setIsConnecting(false);
    }
  }, [applyActive, rememberWallet]);

  // Passwordless, no-extension sign-in via a passkey-backed embedded Arweave wallet. `create` mints a
  // new wallet (registers a passkey + stores its encrypted keystore on Arweave); otherwise it recovers
  // the wallet linked to an existing passkey. The embedded provider is installed as window.arweaveWallet
  // so the rest of the app (master key, sharing, snapshots) works exactly as with an extension.
  const connectPasskey = useCallback(async (create: boolean) => {
    try {
      setIsConnecting(true);
      const session = create ? await createPasskeyWallet() : await recoverPasskeyWallet();
      installEmbeddedProvider(session);
      await applyActive(session.address, "embedded");
      rememberWallet(session.address, "embedded");
    } finally {
      setIsConnecting(false);
    }
  }, [applyActive, rememberWallet]);

  // Make a linked account active. A website CANNOT silently set the extension's active account
  // (there's no setActiveAddress API — the wallet owns it for security). The closest we can do from
  // the website is RE-OPEN Wander's connect dialog, where the user picks the account to connect;
  // then we follow whatever they made active. (They can also just switch in the extension — the
  // focus / walletSwitch listeners follow that too.)
  const switchWallet = useCallback(async (target: string) => {
    if (target === addressRef.current) return;
    const targetType = getLinkedWallet(target)?.type ?? "extension";

    // Switching TO the passkey wallet: re-derive it with the passkey (one biometric prompt), which
    // re-installs the embedded provider.
    if (targetType === "embedded") {
      await connectPasskey(false);
      return;
    }

    // Switching TO an extension account: if we're currently on the passkey wallet, the shim owns
    // window.arweaveWallet — hand it back to the real extension first, or disconnect/connect would
    // just talk to the shim (the bug where switching/enumeration stopped working).
    if (walletTypeRef.current === "embedded") {
      clearEmbeddedSession();
      uninstallEmbeddedProvider();
      walletTypeRef.current = null;
    }
    if (typeof window === "undefined" || !window.arweaveWallet) {
      throw new Error("Connect the Wander extension first.");
    }
    const short = `${target.slice(0, 5)}…${target.slice(-4)}`;
    const wallet = window.arweaveWallet;
    try {
      setIsConnecting(true);
      // connect() resolves SILENTLY when the site already holds every requested permission, so it
      // won't show Wander's account picker. disconnect() first to force the picker to appear. (A site
      // can't pre-select WHICH account it shows — connect() takes no address, there's no
      // setActiveAddress — so the picker defaults to the wallet's own active account; the user
      // chooses the target there.)
      try { await wallet.disconnect(); } catch { /* ignore */ }
      try {
        await wallet.connect(PERMISSIONS as any, APP_INFO);
      } catch {
        // User dismissed the picker. We already disconnected to show it, so they ARE signed out —
        // clear the session so the route guard sends them to the landing to sign in again. This is
        // honest (they really are disconnected) and avoids a broken half-connected state.
        setAddress(null);
        setBalance(null);
        setWalletType(null);
        setActiveWallet(null);
        return;
      }
      const active = await syncActiveAddress();
      if (target !== active) {
        throw new Error(`Pick ${short} in Wander's account list to switch to it — TrustVault follows the active account.`);
      }
    } finally {
      setIsConnecting(false);
    }
  }, [syncActiveAddress, connectPasskey]);

  const disconnect = useCallback(async () => {
    if (walletTypeRef.current === "embedded") {
      // Embedded session: clear the cached keystore and hand window.arweaveWallet back to whatever
      // owned it before (an extension, or nothing).
      clearEmbeddedSession();
      uninstallEmbeddedProvider();
    } else {
      try {
        await window.arweaveWallet?.disconnect();
      } catch {
        /* already gone */
      }
    }
    setAddress(null);
    setBalance(null);
    setWalletType(null);
    walletTypeRef.current = null;
    setActiveWallet(null);
  }, []);

  // On load, silently reconnect the extension if it already granted access — but NEVER let it block
  // isReady (a brand-new visitor with no wallet must still reach the landing instantly).
  useEffect(() => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const tryRestore = async () => {
      try {
        if (typeof window === "undefined") return;
        // Desktop-only for now: never touch window.arweaveWallet on phones/tablets — we can't sign in
        // there anyway, and probing some wallet extensions in a mobile context trips their own bugs.
        if (isMobileDevice()) return;
        // An embedded (passkey) session cached in THIS tab (sessionStorage) — re-install the provider
        // and restore it with no biometric prompt. Closing the tab drops the cache → user re-auths.
        const embedded = loadEmbeddedSession();
        if (embedded) {
          installEmbeddedProvider(embedded);
          await applyActive(embedded.address, "embedded");
          return;
        }
        // Only wait for injection when we actually expect a wallet — otherwise a brand-new visitor
        // with no extension would stare at a blank landing while we wait for nothing.
        const expectExtension = !!window.arweaveWallet || getLinkedWallet(getActiveWallet())?.type === "extension";
        if (expectExtension && !window.arweaveWallet) await waitForWalletApi();
        if (window.arweaveWallet) {
          const permissions = await window.arweaveWallet.getPermissions();
          if (!permissions.includes("ACCESS_ADDRESS")) return;
          let addr = "";
          for (let i = 0; i < 5; i++) {
            try { addr = (await window.arweaveWallet.getActiveAddress()) || ""; } catch { addr = ""; }
            if (addr) break;
            await sleep(300);
          }
          if (addr) await applyActive(addr);
        }
      } catch {
        // wallet not unlocked yet / user cancelled — silent fail
      } finally {
        setIsReady(true);
      }
    };
    tryRestore();
  }, [applyActive]);

  // Background durable-state sync: silent hydrate + periodic encrypted snapshot pushes for the
  // connected wallet. No-op unless NEXT_PUBLIC_STATE_SYNC is set; torn down on disconnect.
  useEffect(() => {
    if (!SYNC_ON || !address) return;
    let cleanup: (() => void) | null = null;
    let dead = false;
    import("@/lib/stateSync").then((m) => { if (!dead) cleanup = m.startStateSync(address); }).catch(() => {});
    return () => { dead = true; cleanup?.(); };
  }, [address]);

  return (
    <WalletContext.Provider
      value={{
        address,
        balance,
        walletType,
        isConnecting,
        isConnected: !!address,
        isReady,
        connect,
        connectPasskey,
        switchWallet,
        disconnect,
        linkedWallets,
        refreshLinkedWallets,
        addWallet,
        listAccounts,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
