// Passkey-backed embedded Arweave wallet — free, unlimited, backendless sign-in (Phase 2).
//
// "Create an account" with a passkey (Face ID / Touch ID / Windows Hello / security key): no browser
// extension, no password, no hosted custody service. How it stays end-to-end and recoverable:
//
//   1. A WebAuthn passkey is registered with the PRF extension. PRF gives a stable 32-byte secret per
//      credential that NEVER leaves the authenticator and SYNCS across the user's devices (iCloud /
//      Google Password Manager). That secret is the only thing that can unwrap the wallet.
//   2. A real Arweave RSA-4096 keypair (JWK) is generated in the browser (crypto.subtle).
//   3. The JWK is AES-GCM-encrypted with a key derived from the PRF secret and uploaded to Arweave
//      (tiny → Turbo free tier), tagged `Cred: sha256(credentialId)` (credentialId is public). So the
//      keystore is recoverable on any device the passkey syncs to — with NO backend and NO per-user cost.
//   4. An object implementing the standard `window.arweaveWallet` API is built from the in-memory JWK
//      (getActiveAddress / getActivePublicKey / RSA-OAEP encrypt+decrypt / signDataItem). Installing it
//      as `window.arweaveWallet` makes the ENTIRE existing app work unchanged — same as an extension.
//
// Crypto must be byte-compatible with the rest of the app: RSA-OAEP **SHA-256** (matches recipients.ts
// `wrapForRecipient` + masterKey wrapping) and address = base64url(SHA-256(modulus)) (addressFromPublicKey).
//
// SECURITY TRADEOFF: to keep the session across reloads without a biometric prompt on every load, the
// in-memory JWK is cached in **sessionStorage** (survives reload, cleared when the tab closes) — the
// same "secrecy-at-rest for convenience" tradeoff the vault already makes with the master key. Closing
// the tab requires re-deriving via the passkey. Disconnect clears it.

import { addressFromPublicKey } from "./recipients";
import { gqlQuery } from "./gql";

const KEYSTORE_TAG = "GTV-Passkey-Keystore-v1";
const PRF_SALT = new TextEncoder().encode("trustvault-prf-wallet-v1");
const HKDF_INFO = new TextEncoder().encode("trustvault-keystore-v1");
const SESSION_KEY = "gtv_embedded_session"; // sessionStorage: { address, credentialId, jwk } (has private key)
const MARKER_KEY = "gtv_embedded_marker"; // localStorage: { address, credentialId } (NO private key)
const TURBO_UPLOAD_URL = "https://upload.ardrive.io/v1/tx";

export interface EmbeddedSession {
  address: string;
  credentialId: string; // base64url(rawId)
  jwk: JsonWebKey; // the Arweave RSA private key
}

// ── small helpers ───────────────────────────────────────────────────────────────
function rand(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n));
}
function toBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data === "string") return new TextEncoder().encode(data);
  return new Uint8Array(0);
}
function bufToB64Url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
async function credHash(credentialId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(credentialId) as Uint8Array<ArrayBuffer>);
  return bufToB64Url(digest);
}

/** WebAuthn is available (PRF support can only be confirmed at create/assert time). */
export function isPasskeySupported(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;
}

// ── PRF → AES wrap key ───────────────────────────────────────────────────────────
async function deriveWrapKey(prf: ArrayBuffer): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new Uint8Array(prf) as Uint8Array<ArrayBuffer>, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: HKDF_INFO as Uint8Array<ArrayBuffer> },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// WebAuthn requires the document to have focus. After the create() system dialog closes, a second
// ceremony fired immediately can throw "the page does not have focus" — wait until focus returns.
async function ensureFocus(timeoutMs = 4000): Promise<void> {
  if (typeof document === "undefined" || document.hasFocus()) return;
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; window.removeEventListener("focus", finish); resolve(); };
    window.addEventListener("focus", finish);
    try { window.focus(); } catch { /* ignore */ }
    setTimeout(finish, timeoutMs);
  });
}

// Run a passkey assertion that evaluates PRF for our fixed salt → the 32-byte secret.
async function evalPrf(allowId?: ArrayBuffer): Promise<ArrayBuffer> {
  await ensureFocus();
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: rand(32),
      rpId: location.hostname,
      ...(allowId ? { allowCredentials: [{ type: "public-key" as const, id: allowId }] } : {}),
      userVerification: "required",
      timeout: 60_000,
      // PRF extension isn't in the TS lib types yet.
      extensions: { prf: { eval: { first: PRF_SALT } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!assertion) throw new Error("Passkey sign-in was cancelled.");
  const prf = (assertion.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } }).prf?.results?.first;
  if (!prf) throw new Error("Your passkey doesn't support encryption (the WebAuthn PRF extension). Use a different device/browser, or a wallet extension.");
  return prf;
}

// ── Arweave keypair (RSA-4096) ────────────────────────────────────────────────────
async function generateWalletJwk(): Promise<JsonWebKey> {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSA-PSS", modulusLength: 4096, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  // Strip the algorithm binding so the SAME key re-imports under RSA-OAEP (encrypt/decrypt) freely.
  delete jwk.alg;
  delete jwk.key_ops;
  jwk.ext = true;
  return jwk;
}
function importOaepPublic(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RSA-OAEP-256", ext: true }, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
}
function importOaepPrivate(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", { ...jwk, alg: "RSA-OAEP-256", key_ops: ["decrypt"] }, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]);
}

// ── ANS-104 data-item signing with the JWK (arbundles, browser build, lazy-loaded) ─
async function signDataItemWithJwk(jwk: JsonWebKey, data: Uint8Array, tags: { name: string; value: string }[]): Promise<ArrayBuffer> {
  const arb = (await import("arbundles")) as unknown as {
    ArweaveSigner: new (jwk: JsonWebKey) => unknown;
    createData: (data: Uint8Array, signer: unknown, opts?: { tags?: { name: string; value: string }[] }) => { sign(signer: unknown): Promise<void>; getRaw(): Uint8Array };
  };
  const signer = new arb.ArweaveSigner(jwk);
  const item = arb.createData(data, signer, { tags });
  await item.sign(signer);
  const raw = item.getRaw();
  return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
}

// ── keystore (encrypted JWK on Arweave) ───────────────────────────────────────────
async function encryptKeystore(wrapKey: CryptoKey, jwk: JsonWebKey): Promise<Uint8Array> {
  const iv = rand(12);
  const plain = new TextEncoder().encode(JSON.stringify(jwk));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as Uint8Array<ArrayBuffer> }, wrapKey, plain as Uint8Array<ArrayBuffer>));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return out;
}
async function decryptKeystore(wrapKey: CryptoKey, blob: Uint8Array): Promise<JsonWebKey> {
  const iv = blob.slice(0, 12) as Uint8Array<ArrayBuffer>;
  const ct = blob.slice(12) as Uint8Array<ArrayBuffer>;
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, wrapKey, ct);
  return JSON.parse(new TextDecoder().decode(plain)) as JsonWebKey;
}
async function uploadKeystore(jwk: JsonWebKey, credentialId: string, blob: Uint8Array): Promise<void> {
  const tags = [
    { name: "App-Name", value: KEYSTORE_TAG },
    { name: "Cred", value: await credHash(credentialId) },
    { name: "Content-Type", value: "application/octet-stream" },
    { name: "Unix-Time", value: Date.now().toString() },
  ];
  const body = await signDataItemWithJwk(jwk, blob, tags);
  const res = await fetch(TURBO_UPLOAD_URL, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body });
  if (!res.ok) throw new Error(`Couldn't save your wallet keystore (${res.status}).`);
}
async function findKeystoreTx(credHashB64: string): Promise<string | null> {
  const query = `query($c:[String!]!){transactions(tags:[{name:"App-Name",values:["${KEYSTORE_TAG}"]},{name:"Cred",values:$c}],first:1,sort:HEIGHT_DESC){edges{node{id}}}}`;
  for (const ep of ["https://turbo-gateway.com/graphql", "https://arweave.net/graphql"]) {
    const json = await gqlQuery<{ id: string }>(ep, query, { c: [credHashB64] });
    const id = json?.data?.transactions?.edges?.[0]?.node?.id;
    if (typeof id === "string" && id) return id;
  }
  return null;
}
async function fetchKeystoreBlob(txId: string): Promise<Uint8Array | null> {
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

// ── session cache ─────────────────────────────────────────────────────────────────
function saveSession(s: EmbeddedSession): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    localStorage.setItem(MARKER_KEY, JSON.stringify({ address: s.address, credentialId: s.credentialId }));
  } catch {
    /* storage full / disabled */
  }
}
/** Restore an in-tab session (after a reload) without a passkey prompt. Null after a tab close. */
export function loadEmbeddedSession(): EmbeddedSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as EmbeddedSession;
    return s?.address && s?.jwk ? s : null;
  } catch {
    return null;
  }
}
/** A returning embedded user (address only) — lets the login screen offer "Continue with passkey". */
export function loadEmbeddedMarker(): { address: string; credentialId: string } | null {
  try {
    const raw = localStorage.getItem(MARKER_KEY);
    return raw ? (JSON.parse(raw) as { address: string; credentialId: string }) : null;
  } catch {
    return null;
  }
}
export function clearEmbeddedSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Download the active embedded wallet's **keyfile** (the Arweave JWK). This is the user's backup AND
 * the way to fund the wallet: importing the keyfile into Wander (or arweave.app) gives them the same
 * address, where they can buy / add AR. A randomly-generated RSA key has NO seed phrase — the keyfile
 * is the recovery artefact. Only works for the wallet whose session is live in this tab.
 */
export function downloadEmbeddedKeyfile(): boolean {
  const s = loadEmbeddedSession();
  if (!s?.jwk) return false;
  const blob = new Blob([JSON.stringify(s.jwk)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `trustvault-keyfile-${s.address.slice(0, 8)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}

// ── provider shim (window.arweaveWallet) ───────────────────────────────────────────
const PERMS = ["ACCESS_ADDRESS", "ACCESS_PUBLIC_KEY", "ACCESS_ALL_ADDRESSES", "SIGN_TRANSACTION", "ENCRYPT", "DECRYPT", "SIGNATURE", "ACCESS_ARWEAVE_CONFIG", "DISPATCH"];

function buildProvider(session: EmbeddedSession) {
  const { jwk, address } = session;
  return {
    walletName: "TrustVault Passkey",
    connect: async () => {},
    disconnect: async () => {},
    getActiveAddress: async () => address,
    getAllAddresses: async () => [address],
    getActivePublicKey: async () => jwk.n as string,
    getPermissions: async () => [...PERMS],
    getArweaveConfig: async () => ({ host: "arweave.net", port: 443, protocol: "https" }),
    encrypt: async (data: unknown) => new Uint8Array(await crypto.subtle.encrypt({ name: "RSA-OAEP" }, await importOaepPublic(jwk), toBytes(data) as Uint8Array<ArrayBuffer>)),
    decrypt: async (data: unknown) => crypto.subtle.decrypt({ name: "RSA-OAEP" }, await importOaepPrivate(jwk), toBytes(data) as Uint8Array<ArrayBuffer>),
    signDataItem: async (item: { data: unknown; tags?: { name: string; value: string }[] }) => signDataItemWithJwk(jwk, toBytes(item.data), item.tags ?? []),
    batchSignDataItem: async (items: { data: unknown; tags?: { name: string; value: string }[] }[]) =>
      Promise.all(items.map((it) => signDataItemWithJwk(jwk, toBytes(it.data), it.tags ?? []))),
  };
}

let savedProvider: unknown;
let installed = false;

/** Make the embedded wallet the active `window.arweaveWallet` so the whole app uses it. */
export function installEmbeddedProvider(session: EmbeddedSession): void {
  const win = window as unknown as { arweaveWallet?: unknown };
  if (!installed) {
    savedProvider = win.arweaveWallet;
    installed = true;
  }
  win.arweaveWallet = buildProvider(session);
}
/** Restore whatever owned `window.arweaveWallet` before (an extension, or nothing). */
export function uninstallEmbeddedProvider(): void {
  if (!installed) return;
  (window as unknown as { arweaveWallet?: unknown }).arweaveWallet = savedProvider;
  installed = false;
  savedProvider = undefined;
}
/** True while the embedded shim is shadowing window.arweaveWallet. */
export function isEmbeddedInstalled(): boolean {
  return installed;
}
/** The REAL wallet (e.g. the Wander extension) the shim replaced — for enumerating/switching extension
 *  accounts during a passkey session, where window.arweaveWallet is the shim. */
export function savedExtensionProvider(): unknown {
  if (installed) return savedProvider;
  return typeof window !== "undefined" ? (window as unknown as { arweaveWallet?: unknown }).arweaveWallet : undefined;
}

// ── create / recover ───────────────────────────────────────────────────────────────
/** Register a new passkey, mint an Arweave wallet, and store its encrypted keystore on Arweave. */
export async function createPasskeyWallet(label = "TrustVault"): Promise<EmbeddedSession> {
  if (!isPasskeySupported()) throw new Error("This browser doesn't support passkeys.");
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: rand(32),
      rp: { name: "TrustVault", id: location.hostname },
      user: { id: rand(16), name: label, displayName: label },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" },
      timeout: 60_000,
      attestation: "none",
      // Ask for the PRF SECRET at creation — browsers that support it (e.g. Chrome) return it here, so
      // we avoid a second WebAuthn ceremony (which would trip the "page does not have focus" error).
      extensions: { prf: { eval: { first: PRF_SALT } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Passkey creation was cancelled.");
  const credPrf = (cred.getClientExtensionResults() as { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } }).prf;
  if (credPrf?.enabled === false) {
    throw new Error("Your device's passkey doesn't support encryption (the WebAuthn PRF extension). Use a different device/browser, or a wallet extension.");
  }
  // Use the PRF secret from create() if returned; otherwise some authenticators (e.g. Safari) only
  // surface it from an assertion — do one more focus-guarded ceremony to get it.
  const prf = credPrf?.results?.first ?? (await evalPrf(cred.rawId));
  const wrapKey = await deriveWrapKey(prf);
  const jwk = await generateWalletJwk();
  const address = await addressFromPublicKey(jwk.n as string);
  const credentialId = bufToB64Url(cred.rawId);
  await uploadKeystore(jwk, credentialId, await encryptKeystore(wrapKey, jwk));
  const session: EmbeddedSession = { address, credentialId, jwk };
  saveSession(session);
  return session;
}

/** Sign in with an existing passkey: derive the key, find + decrypt the keystore on Arweave. */
export async function recoverPasskeyWallet(): Promise<EmbeddedSession> {
  if (!isPasskeySupported()) throw new Error("This browser doesn't support passkeys.");
  // Discoverable assertion (no allowCredentials) — the user picks their TrustVault passkey, so this
  // works on any device the passkey has synced to.
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: rand(32),
      rpId: location.hostname,
      userVerification: "required",
      timeout: 60_000,
      extensions: { prf: { eval: { first: PRF_SALT } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!assertion) throw new Error("Passkey sign-in was cancelled.");
  const prf = (assertion.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } }).prf?.results?.first;
  if (!prf) throw new Error("Your passkey doesn't support encryption (the WebAuthn PRF extension).");
  const credentialId = bufToB64Url(assertion.rawId);
  const wrapKey = await deriveWrapKey(prf);
  const txId = await findKeystoreTx(await credHash(credentialId));
  if (!txId) throw new Error("No TrustVault wallet is linked to this passkey yet. Create one first.");
  const blob = await fetchKeystoreBlob(txId);
  if (!blob) throw new Error("Couldn't load your wallet keystore — try again in a moment.");
  let jwk: JsonWebKey;
  try {
    jwk = await decryptKeystore(wrapKey, blob);
  } catch {
    throw new Error("Couldn't unlock your wallet with this passkey.");
  }
  const address = await addressFromPublicKey(jwk.n as string);
  const session: EmbeddedSession = { address, credentialId, jwk };
  saveSession(session);
  return session;
}
