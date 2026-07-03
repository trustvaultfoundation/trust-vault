// Phase 5 — fetch an encrypted document by Arweave txId and decrypt it.
//
// The document's IV, wrapped key and key scheme are stored as Arweave TAGS on
// the upload transaction (see irys.ts), so a single GraphQL lookup recovers
// everything needed to decrypt — no local vault record required. This is what
// lets a user open a document by ID (or, after Phase 4, by ArNS name).

import { decryptFile, DocumentType } from "./crypto";
import { fromBase64 } from "./vault";
import { isShareRevoked } from "./sharing";
import { gqlQuery } from "./gql";

export interface DecryptedDocument {
  blob: Blob;
  name: string;
  mime: string;
  documentType: string;
}

// Decode base64url (no padding, - and _) → bytes. Tags are encoded this way.
function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const binary = atob(b64 + pad);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return arr;
}

type Tags = Record<string, string>;

// Look up a transaction's tags via the /api/gql proxy (node2.irys.xyz/graphql
// now 400s and lacks CORS; arweave.net has Irys-origin docs, turbo-gateway.com
// the Turbo-origin ones).
async function fetchTags(txId: string): Promise<Tags | null> {
  const query = `query($id:[ID!]!){transactions(ids:$id,first:1){edges{node{id tags{name value}}}}}`;
  for (const endpoint of ["https://arweave.net/graphql", "https://turbo-gateway.com/graphql"]) {
    const json = await gqlQuery<{ id: string; tags: { name: string; value: string }[] }>(endpoint, query, { id: [txId] });
    const node = json?.data?.transactions?.edges?.[0]?.node;
    if (!node?.tags) continue;
    const tags: Tags = {};
    for (const t of node.tags) tags[t.name] = t.value;
    return tags;
  }
  return null;
}

// A grant-shared recipient's wrapped key lives on a GTV-Access-Grant record
// (Target = this doc, Rcpt-<me>), NOT on the document's own tags. Fetch it so
// the viewer can open docs shared AFTER upload, not just upload-time shares.
async function fetchGrantWrap(txId: string, recipient: string): Promise<string | null> {
  const query = `query($t:[String!]!,$r:[String!]!){transactions(tags:[{name:"App-Name",values:["GTV-Access-Grant"]},{name:"Target",values:$t},{name:"Recipient",values:$r}],first:10,sort:HEIGHT_DESC){edges{node{tags{name value}}}}}`;
  for (const endpoint of ["https://arweave.net/graphql", "https://turbo-gateway.com/graphql"]) {
    const json = await gqlQuery<{ tags: { name: string; value: string }[] }>(endpoint, query, { t: [txId], r: [recipient] });
    for (const e of json?.data?.transactions?.edges ?? []) {
      const w = e.node.tags.find((t) => t.name === `Rcpt-${recipient}`)?.value;
      if (w) return w;
    }
  }
  return null;
}

async function fetchBytes(txId: string): Promise<ArrayBuffer> {
  for (const url of [`https://arweave.net/${txId}`, `https://gateway.irys.xyz/${txId}`, `https://turbo-gateway.com/${txId}`]) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.arrayBuffer();
    } catch {
      /* try next gateway */
    }
  }
  throw new Error("Could not fetch the document data from any gateway.");
}

/**
 * Fetch, verify and decrypt an encrypted document by its Arweave txId.
 * Throws with a friendly message on any failure.
 *
 * @param opts.rawKeyB64 standard-base64 raw AES key for this document, if known
 *   locally (e.g. it's one of the caller's own vault entries). When provided,
 *   the document decrypts with no wallet/master involvement at all.
 */
export async function fetchAndDecryptByTxId(
  rawTxId: string,
  opts?: { rawKeyB64?: string }
): Promise<DecryptedDocument> {
  const txId = rawTxId.trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(txId)) {
    throw new Error("That doesn't look like a valid Arweave transaction ID (43 characters).");
  }

  const tags = await fetchTags(txId);
  if (!tags) {
    throw new Error("Transaction not found, or it isn't indexed yet. Try again in a minute.");
  }
  if (tags["App-Name"] !== "Generational-Trust-Vault") {
    throw new Error("This transaction was not created by Trust Vault.");
  }

  const ivB64 = tags["Encryption-IV"];
  const wrappedB64 = tags["Wrapped-Key"];
  if (!ivB64 || !wrappedB64) {
    throw new Error("This document is missing its encryption metadata and cannot be decrypted.");
  }

  const iv = base64UrlToBytes(ivB64) as Uint8Array<ArrayBuffer>;
  const wrappedKey = base64UrlToBytes(wrappedB64) as Uint8Array<ArrayBuffer>;
  const mime = tags["Original-MIME"] || "application/octet-stream";
  const name = tags["Document-Name"] || `${txId}.bin`;
  const documentType = tags["Document-Type"] || "Other";
  const tag = tags["Key-Scheme"];
  // The doc's OWN scheme — how the UPLOADER's key copy is wrapped. A recipient
  // decrypts via their own wrap instead (see below), so `scheme` may flip to
  // "shared" for us even when the document is a "master" upload shared later.
  // "master"/"shared" are explicit; anything else (incl. no tag) is legacy "wallet".
  let scheme: "master" | "wallet" | "shared" = tag === "master" ? "master" : tag === "shared" ? "shared" : "wallet";

  // Phase 6 — reconstruct per-recipient wrapped keys from Rcpt-<address> tags.
  const recipientWraps = Object.entries(tags)
    .filter(([k]) => k.startsWith("Rcpt-"))
    .map(([k, v]) => ({ address: k.slice("Rcpt-".length), wrappedKeyB64Url: v }));

  // Fast path: caller supplied the raw key (their own document) → no prompt.
  let aesKey: CryptoKey | undefined;
  if (opts?.rawKeyB64) {
    try {
      aesKey = await crypto.subtle.importKey(
        "raw",
        fromBase64(opts.rawKeyB64) as Uint8Array<ArrayBuffer>,
        { name: "AES-GCM" },
        false,
        ["decrypt"]
      );
    } catch {
      /* corrupt hint — fall back to scheme below */
    }
  }

  // Am I a RECIPIENT? I have a wrapped key if the document carries my Rcpt tag
  // (shared at upload) OR a grant record targets me (shared later). This is
  // independent of the doc's own Key-Scheme — a "master" upload shared via a
  // grant still decrypts for me through my grant wrap.
  if (!aesKey) {
    const me = await window.arweaveWallet.getActiveAddress().catch(() => "");
    let myWrap = recipientWraps.find((r) => r.address === me)?.wrappedKeyB64Url ?? null;
    if (me && !myWrap) {
      myWrap = await fetchGrantWrap(txId, me);
      if (myWrap) recipientWraps.push({ address: me, wrappedKeyB64Url: myWrap });
    }
    if (myWrap) {
      // I'm a recipient → decrypt via my own wrap, regardless of doc scheme.
      if (await isShareRevoked(txId, me)) throw new AccessRevokedError();
      scheme = "shared";
    } else if (scheme === "shared" && me) {
      // The doc IS a shared upload but carries no wrap for me → not shared with me.
      throw new AccessDeniedError(me);
    }
    // Otherwise (master/wallet, no recipient wrap) assume I'm the uploader; the
    // owner decrypt below succeeds for them, and the catch denies non-owners.
  }

  const encryptedData = await fetchBytes(txId);

  try {
    const blob = await decryptFile({
      encryptedData,
      iv,
      wrappedKey,
      originalName: name,
      originalType: mime,
      originalSize: encryptedData.byteLength,
      documentType: documentType as DocumentType,
      keyScheme: scheme,
      recipientWraps: recipientWraps.length > 0 ? recipientWraps : undefined,
      aesKey,
    });
    return { blob, name, mime, documentType };
  } catch (err) {
    // Decryption only fails like this when the connected wallet can't unwrap the
    // key — i.e. the document isn't shared with you.
    if (!aesKey) {
      const me = await window.arweaveWallet.getActiveAddress().catch(() => "");
      throw new AccessDeniedError(me);
    }
    throw err;
  }
}

/** Thrown when the connected wallet has no access to a document. */
export class AccessDeniedError extends Error {
  address: string;
  constructor(address: string) {
    super(
      "This document hasn't been shared with your wallet. Ask the owner to grant you access — " +
      "send them your wallet address shown above."
    );
    this.name = "AccessDeniedError";
    this.address = address;
  }
}

/** Thrown when the owner has revoked this wallet's access to a document. */
export class AccessRevokedError extends Error {
  constructor() {
    super("The owner has revoked your access to this document.");
    this.name = "AccessRevokedError";
  }
}
