// Vault master key.
//
// One AES-256-GCM key per wallet, established with a single wallet
// authorization and reused to wrap every document's per-file key. This is what
// makes the vault "fluid": after one unlock, all encrypt/decrypt is popup-free.
//
// Durability: the master key is wrapped with the wallet's RSA key
// (window.arweaveWallet.encrypt) — so only the owner can recover it — and the
// wrapped blob is persisted on Arweave via ardrive Turbo, whose free tier
// (<~105 KB) makes tiny uploads cost nothing. Because the wrapped key lives
// on-chain, the SAME master key is recoverable on any browser, forever, with
// one wallet authorization — never a per-file prompt.
//
// Key hierarchy:
//   wallet RSA key  →(wraps)→  vault master key  →(wraps)→  per-file AES keys
//   The plaintext document is only ever encrypted with its per-file key.

import { toBase64, fromBase64 } from "./vault";
import { gqlQuery } from "./gql";

const MASTER_TAG = "GTV-MasterKey-v1";
const cacheKey = (addr: string) => `gtv_master_${addr}`;
const txKey = (addr: string) => `gtv_master_tx_${addr}`;
const wrappedKey = (addr: string) => `gtv_master_wrapped_${addr}`;

// Concurrent decrypts (e.g. bulk download) must not each trigger establishment.
let inflight: Promise<CryptoKey> | null = null;

function walletAny() {
  // The installed arconnect package's encrypt/decrypt types are stricter than
  // Wander's actual WebCrypto-compatible API, so access through a local shape.
  return window.arweaveWallet as unknown as {
    getActiveAddress(): Promise<string>;
    encrypt(data: Uint8Array, algo: { name: string }): Promise<Uint8Array>;
    decrypt(data: Uint8Array, algo: { name: string }): Promise<ArrayBuffer>;
    signDataItem?: (item: {
      data: Uint8Array;
      tags: { name: string; value: string }[];
    }) => Promise<ArrayBuffer | { getRaw(): Uint8Array }>;
  };
}

function importMaster(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    raw as Uint8Array<ArrayBuffer>,
    { name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"]
  );
}

// Find this wallet's existing master-key transaction. The wrapped master is
// Turbo-origin, so query turbo-gateway.com (indexes within minutes) first, then
// arweave.net (slower permanent fallback). Both go via the /api/gql proxy so
// turbo-gateway.com's missing-CORS 502s don't break the browser.
async function queryMasterTx(addr: string): Promise<string | null> {
  const query = `query($o:[String!]!){transactions(owners:$o,tags:[{name:"App-Name",values:["${MASTER_TAG}"]}],first:1){edges{node{id}}}}`;
  for (const endpoint of ["https://turbo-gateway.com/graphql", "https://arweave.net/graphql"]) {
    const json = await gqlQuery<{ id: string }>(endpoint, query, { o: [addr] });
    const id = json?.data?.transactions?.edges?.[0]?.node?.id;
    if (typeof id === "string" && id) return id;
  }
  return null;
}

async function fetchWrapped(txId: string): Promise<Uint8Array | null> {
  for (const url of [`https://turbo-gateway.com/${txId}`, `https://arweave.net/${txId}`]) {
    try {
      const res = await fetch(url);
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
    } catch {
      /* try next gateway */
    }
  }
  return null;
}

// Persist the RSA-wrapped master key on Arweave (free, <100 KB). Returns txId.
async function uploadWrapped(wrapped: Uint8Array): Promise<string | null> {
  const w = walletAny();
  if (typeof w.signDataItem !== "function") return null;
  const tags = [
    { name: "App-Name", value: MASTER_TAG },
    { name: "Content-Type", value: "application/octet-stream" },
    { name: "Unix-Time", value: Date.now().toString() },
  ];
  try {
    const signed = await w.signDataItem({ data: wrapped, tags });
    let body: ArrayBuffer;
    if (signed && typeof (signed as { getRaw?: unknown }).getRaw === "function") {
      const raw = (signed as { getRaw(): Uint8Array }).getRaw();
      body = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
    } else {
      body = signed as ArrayBuffer;
    }
    // Publish via Turbo — free for tiny records (node2.irys.xyz has no AR free
    // tier and 402s every upload). Turbo bundles to Arweave, indexed normally.
    const res = await fetch("https://upload.ardrive.io/v1/tx", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body,
    });
    if (!res.ok) return null;
    const text = await res.text();
    try {
      const j = JSON.parse(text) as { id?: string };
      return (j.id ?? "").trim() || null;
    } catch {
      return text.trim() || null;
    }
  } catch {
    return null;
  }
}

// Recover the cached or on-chain master key without ever creating a new one.
// Returns null if this wallet has no master key yet (a brand-new user).
async function recover(addr: string): Promise<CryptoKey | null> {
  const w = walletAny();

  // 1. Fast path — raw master cached in this browser. No wallet, no network.
  const cached = localStorage.getItem(cacheKey(addr));
  if (cached) {
    try {
      return await importMaster(fromBase64(cached));
    } catch {
      /* corrupt cache — fall through to recover */
    }
  }

  // 2. Recover — the wrapped master exists on Arweave; unwrap it once.
  const txId = localStorage.getItem(txKey(addr)) ?? (await queryMasterTx(addr));
  if (txId) {
    const wrapped = await fetchWrapped(txId);
    if (wrapped) {
      const rawBuf = await w.decrypt(wrapped, { name: "RSA-OAEP" }); // 1 popup
      const raw = new Uint8Array(rawBuf);
      localStorage.setItem(cacheKey(addr), toBase64(raw));
      localStorage.setItem(txKey(addr), txId);
      localStorage.setItem(wrappedKey(addr), toBase64(wrapped));
      return importMaster(raw);
    }
  }

  return null;
}

async function establish(addr: string, create: boolean): Promise<CryptoKey> {
  const existing = await recover(addr);
  if (existing) return existing;

  if (!create) {
    throw new Error("Vault is locked — no master key found for this wallet.");
  }

  // First time ever — generate, wrap with the wallet, persist on Arweave.
  const w = walletAny();
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  const wrapped = new Uint8Array(await w.encrypt(raw, { name: "RSA-OAEP" })); // 1 popup
  localStorage.setItem(cacheKey(addr), toBase64(raw));
  localStorage.setItem(wrappedKey(addr), toBase64(wrapped)); // enables self-heal
  const newTx = await uploadWrapped(wrapped); // 1 signature
  if (newTx) localStorage.setItem(txKey(addr), newTx);
  return key;
}

/**
 * Returns the vault master key for the connected wallet.
 * @param create when true (default) a key is generated if none exists (upload
 *   path); when false it only recovers an existing key and throws otherwise
 *   (decrypt path — never create a mismatched key for a browse-only user).
 * Cached for the session and across reloads.
 */
export async function getMasterKey(create = true): Promise<CryptoKey> {
  if (inflight) return inflight;
  inflight = (async () => {
    const addr = await walletAny().getActiveAddress();
    return establish(addr, create);
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/**
 * Proactively unlock the vault: recover the master key (one wallet prompt) if
 * one exists on-chain, so later view/download actions are prompt-free. Does
 * nothing for brand-new wallets. Never creates a key. Resolves to true if the
 * vault is unlocked (now cached), false otherwise. Never throws.
 */
export async function prepareMasterKey(): Promise<boolean> {
  try {
    const addr = await walletAny().getActiveAddress();
    // Already cached → unlocked, no prompt. (We intentionally do NOT retry the
    // on-chain persistence here — re-uploading on every vault open spams 402s
    // when there's no Irys balance, and the cached key already works.)
    if (localStorage.getItem(cacheKey(addr))) return true;
    const key = await recover(addr);
    return key !== null;
  } catch {
    return false;
  }
}

/**
 * Wrap a raw per-file AES key with the master key.
 * Output layout: iv(12 bytes) || AES-GCM ciphertext.
 */
export async function wrapWithMaster(
  master: CryptoKey,
  rawFileKey: Uint8Array
): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      master,
      rawFileKey as Uint8Array<ArrayBuffer>
    )
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return out;
}

/** Unwrap a master-wrapped per-file key (iv(12) || ciphertext) → raw bytes. */
export async function unwrapRawWithMaster(
  master: CryptoKey,
  wrapped: Uint8Array
): Promise<Uint8Array> {
  const iv = wrapped.slice(0, 12) as Uint8Array<ArrayBuffer>;
  const ct = wrapped.slice(12) as Uint8Array<ArrayBuffer>;
  const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, master, ct);
  return new Uint8Array(raw);
}

/** Unwrap a master-wrapped per-file key (iv(12) || ciphertext) → CryptoKey. */
export async function unwrapWithMaster(
  master: CryptoKey,
  wrapped: Uint8Array
): Promise<CryptoKey> {
  const raw = await unwrapRawWithMaster(master, wrapped);
  return crypto.subtle.importKey("raw", raw as Uint8Array<ArrayBuffer>, { name: "AES-GCM" }, false, ["decrypt"]);
}
