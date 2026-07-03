// Document categories offered when uploading a file. TrustVault started as a legal-document
// vault but is now a general workspace for any company or individual, so the list spans many
// sectors. "Other" is kept LAST (some pickers default to the last entry as the generic choice).
export const DOCUMENT_TYPES = [
  // Business & finance
  "Contract",
  "Agreement",
  "NDA",
  "Invoice",
  "Receipt",
  "Purchase Order",
  "Financial Statement",
  "Tax Document",
  "Payslip",
  "Budget",
  "Report",
  "Proposal",
  "Presentation",
  "Policy",
  "Meeting Notes",
  // Legal
  "Will",
  "Deed",
  "Trust",
  "Power of Attorney",
  "Certificate",
  "License",
  "Permit",
  // People & HR
  "Employment Contract",
  "Offer Letter",
  "Resume / CV",
  // Tech & startup
  "Technical Specification",
  "Product Roadmap",
  "Source Code",
  "Design Asset",
  "Credentials",
  // Esports, gaming & media
  "Sponsorship Agreement",
  "Player Contract",
  "Media Asset",
  // Real estate
  "Lease",
  "Mortgage",
  // Personal / individual
  "ID Document",
  "Medical Record",
  "Insurance Policy",
  "Diploma",
  "Personal Note",
  // Fallback
  "Other",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export interface EncryptedPayload {
  encryptedData: ArrayBuffer;
  iv: Uint8Array<ArrayBuffer>;         // 12-byte AES-GCM nonce for the file
  wrappedKey: Uint8Array<ArrayBuffer>; // per-file key wrapped per `keyScheme`
  originalName: string;
  originalType: string;                // MIME type
  originalSize: number;                // bytes
  documentType: DocumentType;
  aesKey?: CryptoKey;                  // in-memory only — never serialised, speeds up same-session decryption
  // "master": wrappedKey = iv(12)||AES-GCM(masterKey, fileKey) — popup-free.
  // "wallet": wrappedKey = RSA-OAEP(walletKey, fileKey) — legacy, needs wallet.
  // "shared": uploader decrypts via wrappedKey (master); each recipient decrypts
  //   their own RSA-OAEP copy in recipientWraps with their wallet.
  keyScheme?: "master" | "wallet" | "shared";
  // Phase 6 — per-recipient wrapped keys (shared documents only).
  recipientWraps?: { address: string; wrappedKeyB64Url: string }[];
  // The owner's custom searchable tags, written on-chain as a `Document-Tags`
  // tag so recipients of a shared document see them too.
  customTags?: string[];
}

export type EncryptionStep =
  | "reading"
  | "generating-key"
  | "encrypting"
  | "wrapping-key"
  | "done";

export type OnStep = (step: EncryptionStep) => void;

// Decode base64url (no padding) → bytes. Used for shared-recipient wrapped keys.
function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const binary = atob(b64 + pad);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return arr;
}

/**
 * Encrypts a file entirely in the browser. No plaintext leaves the device.
 *
 * Encryption model:
 *   1. A random AES-256-GCM key encrypts the file bytes (the per-file key).
 *   2. The per-file key is wrapped with the vault MASTER key (AES-GCM, also
 *      symmetric) — see masterKey.ts. The master key is itself wrapped with the
 *      wallet's RSA key and persisted on Arweave, so the wallet is only ever
 *      needed once (to unlock the master key), never per file.
 *   3. Only this wallet can recover the master key, so only it can decrypt.
 */
export async function encryptFile(
  file: File,
  documentType: DocumentType,
  onStep?: OnStep,
  recipients?: string[]
): Promise<EncryptedPayload> {
  // 1. Read file into memory
  onStep?.("reading");
  const fileBuffer = await file.arrayBuffer();

  // 2. Generate a random, extractable AES-256-GCM per-file key
  onStep?.("generating-key");
  const aesKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true, // must be extractable so we can export and wrap it
    ["encrypt", "decrypt"]
  );

  // 3. Encrypt the file with a random 12-byte IV
  onStep?.("encrypting");
  const iv = crypto.getRandomValues(new Uint8Array(12)) as Uint8Array<ArrayBuffer>;
  const encryptedData = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    fileBuffer
  );

  // 4. Wrap the per-file key with the vault master key (no wallet popup once
  //    the master key is unlocked — first upload ever establishes it).
  onStep?.("wrapping-key");
  const { getMasterKey, wrapWithMaster } = await import("./masterKey");
  const master = await getMasterKey();
  const rawKey = new Uint8Array(await crypto.subtle.exportKey("raw", aesKey));
  const wrappedKey = (await wrapWithMaster(master, rawKey)) as Uint8Array<ArrayBuffer>;

  // 5. Phase 6 — if recipients are named, additionally wrap the per-file key
  //    with each recipient's RSA public key so they can decrypt independently.
  //    The uploader still recovers via wrappedKey (master), so we never include
  //    the uploader here.
  let recipientWraps: { address: string; wrappedKeyB64Url: string }[] | undefined;
  let keyScheme: "master" | "shared" = "master";
  const recips = (recipients ?? []).map((r) => r.trim()).filter(Boolean);
  if (recips.length > 0) {
    const { wrapKeyForRecipients } = await import("./recipients");
    const { wraps, missing } = await wrapKeyForRecipients(rawKey, recips);
    if (missing.length > 0) {
      throw new Error(
        `No public key found on-chain for: ${missing.join(", ")}. ` +
        `A recipient must have at least one prior Arweave transaction before they can be shared with.`
      );
    }
    recipientWraps = wraps;
    keyScheme = "shared";
  }

  onStep?.("done");

  return {
    encryptedData,
    iv,
    wrappedKey,
    originalName: file.name,
    originalType: file.type || "application/octet-stream",
    originalSize: file.size,
    documentType,
    aesKey,
    keyScheme,
    recipientWraps,
  };
}

/**
 * Phase 5 implementation: unwrap the AES key via ArConnect, then decrypt the
 * ciphertext. Only the wallet that originally encrypted the document can call
 * this successfully.
 */
export async function decryptFile(payload: EncryptedPayload): Promise<Blob> {
  let aesKey: CryptoKey;

  if (payload.aesKey) {
    // Fastest path: the per-file key is already in memory (fresh upload, or a
    // raw key cached in localStorage). No wallet, no master key needed.
    aesKey = payload.aesKey;
  } else if (payload.keyScheme === "shared") {
    // Shared document: a recipient unwraps their own RSA-OAEP copy with their
    // wallet; the uploader (no recipient copy) falls back to the master key.
    const myAddr = await window.arweaveWallet.getActiveAddress();
    const mine = payload.recipientWraps?.find((r) => r.address === myAddr);
    if (mine) {
      const wrapped = base64UrlToBytes(mine.wrappedKeyB64Url);
      const rawKeyBuffer = await (
        window.arweaveWallet as unknown as {
          decrypt(data: Uint8Array, algo: { name: string }): Promise<ArrayBuffer>;
        }
      ).decrypt(wrapped, { name: "RSA-OAEP" });
      aesKey = await crypto.subtle.importKey(
        "raw", rawKeyBuffer, { name: "AES-GCM" }, false, ["decrypt"]
      );
    } else {
      // Not a listed recipient — try the master key (works only for the uploader).
      const { getMasterKey, unwrapWithMaster } = await import("./masterKey");
      const master = await getMasterKey(false);
      aesKey = await unwrapWithMaster(master, payload.wrappedKey);
    }
  } else if (payload.keyScheme === "master") {
    // Master-key scheme: unwrap the per-file key with the vault master key.
    // The wallet is only involved if the master key isn't cached yet — one
    // authorization unlocks every document, not one per file.
    const { getMasterKey, unwrapWithMaster } = await import("./masterKey");
    const master = await getMasterKey(false); // recover only — never create
    aesKey = await unwrapWithMaster(master, payload.wrappedKey);
  } else {
    // Legacy scheme: per-file key was wrapped directly with the wallet's RSA
    // key. Unwrapping requires the wallet (one popup per file). Only applies to
    // documents uploaded before the master-key vault existed.
    // Cast: the installed arconnect package's decrypt() algorithm type predates
    // Wander's current WebCrypto-compatible { name: "RSA-OAEP" } shape.
    const rawKeyBuffer = await (
      window.arweaveWallet as unknown as {
        decrypt(data: Uint8Array, algo: { name: string }): Promise<ArrayBuffer>;
      }
    ).decrypt(payload.wrappedKey, { name: "RSA-OAEP" });
    aesKey = await crypto.subtle.importKey(
      "raw",
      rawKeyBuffer,
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );
  }

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: payload.iv },
    aesKey,
    payload.encryptedData
  );
  return new Blob([decryptedBuffer], { type: payload.originalType });
}

// ── Display helpers ──────────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function toHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
