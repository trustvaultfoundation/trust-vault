import type { EncryptedPayload } from "./crypto";

export async function getUploadPrice(byteLength: number): Promise<string | null> {
  try {
    const res = await fetch(`https://node2.irys.xyz/price/arweave/${byteLength}`);
    if (!res.ok) return null;
    const winstons = await res.text();
    const ar = (parseFloat(winstons) / 1e12).toFixed(8);
    return `${ar} AR`;
  } catch {
    return null;
  }
}

/**
 * The wallet's currently loaded (pre-funded) Irys balance for the given node,
 * as an AR string. Returns null on failure. Read-only — never prompts.
 * (Legacy — kept for the Settings balance read; uploads now go via Turbo below.)
 */
export async function getLoadedIrysBalance(node: string): Promise<string | null> {
  try {
    const { Buffer: BrowserBuffer } = await import("buffer");
    if (typeof (globalThis as Record<string, unknown>)["Buffer"] === "undefined") {
      (globalThis as Record<string, unknown>)["Buffer"] = BrowserBuffer;
    }
    const { ArweaveWebIrys } = await import(
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore – deep internal path; stable across 0.2.x
      "@irys/sdk/build/cjs/web/tokens/arweave"
    );
    const webIrys = new ArweaveWebIrys({
      url: node,
      wallet: { provider: window.arweaveWallet },
      config: { providerUrl: "https://arweave.net" },
    });
    await webIrys.ready();
    const balance = await webIrys.getLoadedBalance();
    return webIrys.utils.fromAtomic(balance).toFixed(6);
  } catch {
    return null;
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export type UploadStatus =
  | "initializing"
  | "checking-balance"
  | "funding"
  | "awaiting-credit"
  | "uploading"
  | "done";

export type OnUploadStatus = (status: UploadStatus, detail?: string) => void;

export interface UploadResult {
  txId: string;
  gatewayUrl: string;     // arweave.net — permanent
  irysGatewayUrl: string; // a fast-indexing gateway for immediate reads
  costWinc?: string;      // exact Turbo credits charged for this upload ("0" on the free tier)
}

/** The Arweave tags for an encrypted document (data-item metadata). */
export function buildDocumentTags(payload: EncryptedPayload): { name: string; value: string }[] {
  const tags = [
    { name: "Content-Type", value: "application/octet-stream" },
    { name: "App-Name", value: "Generational-Trust-Vault" },
    { name: "App-Version", value: "1.0.0" },
    { name: "Document-Type", value: payload.documentType },
    { name: "Document-Name", value: payload.originalName },
    { name: "Original-Size", value: payload.originalSize.toString() },
    { name: "Original-MIME", value: payload.originalType },
    { name: "Encryption-IV", value: bytesToBase64Url(payload.iv) },
    { name: "Wrapped-Key", value: bytesToBase64Url(payload.wrappedKey) },
    { name: "Key-Scheme", value: payload.keyScheme ?? "master" },
    { name: "Unix-Time", value: Date.now().toString() },
  ];
  // The owner's custom searchable tags, so recipients of a shared doc see them.
  if (payload.customTags && payload.customTags.length > 0) {
    tags.push({ name: "Document-Tags", value: payload.customTags.join(",") });
  }
  // Per recipient: Rcpt-<addr> holds their wrapped key (for decryption), and a Recipient
  // tag (value = address) makes the doc discoverable by GraphQL so recipients can find it.
  if (payload.recipientWraps) {
    for (const r of payload.recipientWraps) {
      tags.push({ name: `Rcpt-${r.address}`, value: r.wrappedKeyB64Url });
      tags.push({ name: "Recipient", value: r.address });
    }
  }
  return tags;
}

function normalizeSignedItem(signed: ArrayBuffer | { getRaw(): Uint8Array }): ArrayBuffer {
  if (signed && typeof (signed as { getRaw?: unknown }).getRaw === "function") {
    const raw = (signed as { getRaw(): Uint8Array }).getRaw();
    return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
  }
  return signed as ArrayBuffer;
}

/**
 * Sign many documents' data items with a SINGLE wallet approval, if Wander
 * supports batchSignDataItem. Returns one signed ArrayBuffer per payload in the
 * same order, or null when batch signing isn't available (caller falls back to
 * per-file signing). Throws "cancelled" if the user rejects the prompt.
 */
export async function batchSignDocuments(
  payloads: EncryptedPayload[]
): Promise<ArrayBuffer[] | null> {
  const w = window.arweaveWallet as typeof window.arweaveWallet & {
    batchSignDataItem?: (
      items: { data: Uint8Array; tags: { name: string; value: string }[] }[]
    ) => Promise<(ArrayBuffer | { getRaw(): Uint8Array })[]>;
  };
  if (typeof w.batchSignDataItem !== "function") return null;
  const items = payloads.map((p) => ({
    data: new Uint8Array(p.encryptedData),
    tags: buildDocumentTags(p),
  }));
  try {
    const signed = await w.batchSignDataItem(items);
    if (!Array.isArray(signed) || signed.length !== payloads.length) return null;
    return signed.map(normalizeSignedItem);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/reject|cancel|denied/i.test(msg)) throw new Error("Upload cancelled by user.");
    return null; // unsupported shape / runtime error → caller falls back
  }
}

const TURBO_UPLOAD_URL = "https://upload.ardrive.io/v1/tx";

/**
 * Upload an encrypted document to Arweave via Turbo (ArDrive's bundler).
 *
 * Replaces the old Irys self-funding flow (which needed the user to fund a node with AR,
 * and whose funding txs could drop). Turbo bundles the SAME ANS-104 data item to Arweave:
 *   • the encrypted file bytes are the data, IV + wrapped key ride as tags (single-fetch decrypt),
 *   • files under Turbo's free tier (~100 KiB) cost nothing,
 *   • larger files draw on Turbo credits — a 402 means "top up at turbo.ardrive.io", which is
 *     far simpler than the Irys AR dance (card or crypto, no dropped txs).
 * Signing is the wallet's signDataItem (silent), or a pre-signed body from a batch approval.
 */
export async function uploadToArweave(
  payload: EncryptedPayload,
  onStatus: OnUploadStatus,
  preSignedBody?: ArrayBuffer
): Promise<UploadResult> {
  onStatus("initializing");

  const tags = buildDocumentTags(payload);
  const encryptedBytes = new Uint8Array(payload.encryptedData);

  if (encryptedBytes.byteLength > 50 * 1024 * 1024) {
    throw new Error(`Encrypted file is ${(encryptedBytes.byteLength / 1024 / 1024).toFixed(1)} MB — please use a file under 50 MB.`);
  }

  const walletExt = window.arweaveWallet as typeof window.arweaveWallet & {
    signDataItem?: (item: { data: Uint8Array; tags: { name: string; value: string }[] }) => Promise<ArrayBuffer | { getRaw(): Uint8Array }>;
  };
  if (!preSignedBody && typeof walletExt.signDataItem !== "function") {
    throw new Error("Your wallet can't sign data items (needed to store files). Update Wander and reconnect.");
  }

  onStatus("uploading");

  let body: ArrayBuffer;
  try {
    body = preSignedBody ?? normalizeSignedItem(await walletExt.signDataItem!({ data: encryptedBytes, tags }));
  } catch (signErr: unknown) {
    const msg = signErr instanceof Error ? signErr.message : String(signErr);
    if (/reject|cancel|denied/i.test(msg)) throw new Error("Upload cancelled.");
    throw new Error(`Could not sign the file: ${msg}`);
  }

  const res = await fetch(TURBO_UPLOAD_URL, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body,
  });
  if (res.status === 402) {
    throw new Error(
      "This file is above the free size, so it needs Turbo credits. Add Turbo credits to your wallet, " +
      "then upload again — smaller files are free."
    );
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Upload failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  const text = await res.text();
  let txId: string;
  let costWinc: string | undefined;
  try {
    const parsed = JSON.parse(text) as { id?: string; winc?: string };
    txId = parsed.id?.trim() || "";
    if (typeof parsed.winc === "string") costWinc = parsed.winc; // exact credits charged ("0" = free)
  } catch {
    txId = text.trim();
  }
  if (!txId || txId.length < 30) {
    throw new Error(`Turbo returned an unexpected response: "${text.slice(0, 60)}"`);
  }

  onStatus("done");
  return {
    txId,
    irysGatewayUrl: `https://turbo-gateway.com/${txId}`, // fast-indexing read
    gatewayUrl: `https://arweave.net/${txId}`,
    costWinc,
  };
}
