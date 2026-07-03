// Share an already-uploaded document with new recipients.
//
// Arweave is immutable, so we can't add a recipient to an existing transaction.
// Instead we publish a tiny ACCESS-GRANT record: the document's AES key wrapped
// for the new recipient's RSA public key, tagged so their vault discovers it.
// (See vault.ts fetchSharedDocuments, which reads both original documents and
// grant records.)
//
// Revocation: anything published to Arweave is permanent, so there is no
// cryptographic "un-share" — a recipient who already DOWNLOADED the plaintext
// keeps it. What we CAN do is publish a tiny REVOKE record (a tombstone) that
// the recipient's vault honors: fetchSharedDocuments hides any document with a
// matching revoke from the same owner, so it disappears from their vault and
// they can no longer open it through the app. (See revokeShare below.)

import {
  wrapForRecipient,
  looksLikePublicKey,
  addressFromPublicKey,
  fetchPublicKey,
} from "./recipients";
import { fromBase64 } from "./vault";
import { gqlQuery } from "./gql";
import { postToTurbo, normalizeSigned } from "./turbo";
import { publishDepmRecords } from "./depmKey";

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function resolveModulus(token: string): Promise<{ address: string; modulus: string } | null> {
  const t = token.trim();
  if (!t) return null;
  if (looksLikePublicKey(t)) return { address: await addressFromPublicKey(t), modulus: t };
  const modulus = await fetchPublicKey(t);
  return modulus ? { address: t, modulus } : null;
}

export interface ShareableDoc {
  txId: string;
  rawKeyBase64: string; // the document's AES key (standard base64)
  ivBase64: string; // the document's IV (standard base64)
  originalName: string;
  originalType: string;
  originalSize: number;
  documentType: string;
  tags?: string[]; // the owner's custom searchable tags, carried to the recipient
}

/**
 * Grant one or more recipients access to one or more documents. Builds all
 * grant records and signs them with a SINGLE wallet approval (batchSignDataItem
 * when available), then posts them to Irys.
 */
export async function shareDocuments(
  docs: ShareableDoc[],
  recipientTokens: string[]
): Promise<{ sharedWith: string[]; missing: string[]; count: number }> {
  // Resolve recipients to public keys.
  const recipients: { address: string; modulus: string }[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const token of recipientTokens) {
    const r = await resolveModulus(token);
    if (!r) { missing.push(token.trim()); continue; }
    if (seen.has(r.address)) continue;
    seen.add(r.address);
    recipients.push(r);
  }
  if (recipients.length === 0) {
    throw new Error(
      missing.length
        ? "No public key found for the recipient(s). Ask them to paste their public key from “View a Document”."
        : "No recipients selected."
    );
  }

  // Build a grant data-item per (doc, recipient).
  const items: { data: Uint8Array; tags: { name: string; value: string }[] }[] = [];
  for (const doc of docs) {
    const rawKey = fromBase64(doc.rawKeyBase64);
    const iv = fromBase64(doc.ivBase64);
    for (const r of recipients) {
      const wrapped = await wrapForRecipient(r.modulus, rawKey);
      items.push({
        data: new TextEncoder().encode(`grant:${doc.txId}:${r.address}`),
        tags: [
          { name: "App-Name", value: "GTV-Access-Grant" },
          { name: "App-Version", value: "1.0.0" },
          { name: "Content-Type", value: "text/plain" },
          { name: "Target", value: doc.txId },
          { name: "Recipient", value: r.address },
          { name: `Rcpt-${r.address}`, value: bytesToBase64Url(wrapped) },
          { name: "Encryption-IV", value: bytesToBase64Url(iv) },
          { name: "Key-Scheme", value: "shared" },
          { name: "Document-Name", value: doc.originalName },
          { name: "Document-Type", value: doc.documentType },
          { name: "Document-Tags", value: (doc.tags ?? []).join(",") },
          { name: "Original-Size", value: String(doc.originalSize) },
          { name: "Original-MIME", value: doc.originalType },
          { name: "Unix-Time", value: Date.now().toString() },
        ],
      });
    }
  }

  // Publish grants SILENTLY — signed in-browser by this wallet's app key (publishDepmRecords) and
  // POSTed to Turbo, so there's NO wallet "authorize" popup (e.g. adding a board member re-shares
  // its attachments without nagging). Access is delivered by the wrapped key in the grant, read by
  // the recipient regardless of who signed it, so the signer identity is irrelevant here.
  const wallet = await (window.arweaveWallet as typeof window.arweaveWallet).getActiveAddress();
  await publishDepmRecords(wallet, items);

  // Track who each document is now shared with (for the manage UI).
  for (const doc of docs) {
    for (const r of recipients) recordShare(doc.txId, r.address);
  }

  return { sharedWith: recipients.map((r) => r.address), missing, count: items.length };
}

// ── Local share/revoke tracking (per document) ────────────────────────────────
// Each stored as { address: timestamp } so the owner's own actions take effect
// IMMEDIATELY (before on-chain indexing) and feed the same newest-wins timeline
// comparison used for on-chain records: a recipient is shared iff their latest
// share time ≥ their latest revoke time. Without the local revoke times, a fresh
// revoke would be ignored until indexed and the on-chain grants would re-add the
// recipient; without local share times, a fresh re-share wouldn't show.

const shareKey = (txId: string) => `gtv_shares_${txId}`;
const revokeKey = (txId: string) => `gtv_revokes_${txId}`;

function loadTimes(key: string): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // Legacy share format was string[] — treat those as shared long ago (epoch 1).
    if (Array.isArray(parsed)) {
      const out: Record<string, number> = {};
      for (const a of parsed) out[a] = 1;
      return out;
    }
    return parsed as Record<string, number>;
  } catch {
    return {};
  }
}

function saveTimes(key: string, map: Record<string, number>): void {
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    /* non-critical */
  }
}

export function loadShareTimes(txId: string): Record<string, number> {
  return loadTimes(shareKey(txId));
}

export function loadRevokeTimes(txId: string): Record<string, number> {
  return loadTimes(revokeKey(txId));
}

export function loadShares(txId: string): string[] {
  return Object.keys(loadShareTimes(txId));
}

function recordShare(txId: string, address: string): void {
  const m = loadShareTimes(txId);
  m[address] = Date.now();
  saveTimes(shareKey(txId), m);
}

/** Record recipient addresses for a document (e.g. shared at upload time). */
export function recordShares(txId: string, addresses: string[]): void {
  const m = loadShareTimes(txId);
  const now = Date.now();
  for (const a of addresses) m[a] = now;
  saveTimes(shareKey(txId), m);
}

/** Mark a recipient locally revoked NOW, so the owner's list updates at once
 *  (the on-chain revoke takes a few minutes to index). Newest-wins, so this
 *  beats older grants; a later re-share beats this. */
export function removeShareLocally(txId: string, address: string): void {
  const m = loadRevokeTimes(txId);
  m[address] = Date.now();
  saveTimes(revokeKey(txId), m);
}

/**
 * Revoke a recipient's access to a document. Publishes a signed REVOKE record
 * (App-Name: GTV-Access-Revoke, Target, Recipient) via Turbo — free, one wallet
 * signature. The recipient's vault honors it (fetchSharedDocuments filters out
 * revoked documents), so the file disappears from their vault and they can no
 * longer open it in the app. NOTE: Arweave is permanent — this cannot recall a
 * copy the recipient already downloaded; it removes ongoing access only.
 */
export async function revokeShare(txId: string, address: string): Promise<void> {
  const w = window.arweaveWallet as typeof window.arweaveWallet & {
    signDataItem?: (item: { data: Uint8Array; tags: { name: string; value: string }[] }) => Promise<ArrayBuffer | { getRaw(): Uint8Array }>;
  };
  if (typeof w.signDataItem !== "function") {
    throw new Error("Your wallet doesn't support revoking (needs signDataItem). Update Wander.");
  }
  const item = {
    data: new TextEncoder().encode(`revoke:${txId}:${address}`),
    tags: [
      { name: "App-Name", value: "GTV-Access-Revoke" },
      { name: "App-Version", value: "1.0.0" },
      { name: "Content-Type", value: "text/plain" },
      { name: "Target", value: txId },
      { name: "Recipient", value: address },
      { name: "Unix-Time", value: Date.now().toString() },
    ],
  };
  await postToTurbo(normalizeSigned(await w.signDataItem(item)));
  // Drop them from our own local list too, so the owner's UI updates at once.
  removeShareLocally(txId, address);
}

/**
 * Is `recipient`'s access to `txId` CURRENTLY revoked? True only when the owner's
 * latest revoke is newer than the latest share (the doc's own Unix-Time plus any
 * grant re-shares) — so re-sharing after a revoke restores access here too.
 * Owner-validated (only a revoke from the document owner counts). Used to deny
 * access in the viewer, not just hide it from the vault. Best-effort.
 */
export async function isShareRevoked(txId: string, recipient: string): Promise<boolean> {
  type Node = { owner?: { address: string }; tags: { name: string; value: string }[] };
  const docQ = `query($id:[ID!]!){transactions(ids:$id,first:1){edges{node{owner{address} tags{name value}}}}}`;
  const grantQ = `query($t:[String!]!,$r:[String!]!){transactions(tags:[{name:"App-Name",values:["GTV-Access-Grant"]},{name:"Target",values:$t},{name:"Recipient",values:$r}],first:100){edges{node{owner{address} tags{name value}}}}}`;
  const revokeQ = `query($t:[String!]!,$r:[String!]!){transactions(tags:[{name:"App-Name",values:["GTV-Access-Revoke"]},{name:"Target",values:$t},{name:"Recipient",values:$r}],first:100){edges{node{owner{address} tags{name value}}}}}`;
  const unixTime = (n: Node) => Number(n.tags.find((t) => t.name === "Unix-Time")?.value) || 0;

  let docOwner = "";
  let shareTime = -1;
  let revokeTime = -1;
  for (const endpoint of ["https://arweave.net/graphql", "https://turbo-gateway.com/graphql"]) {
    const [docJson, grantJson, revokeJson] = await Promise.all([
      gqlQuery<Node>(endpoint, docQ, { id: [txId] }),
      gqlQuery<Node>(endpoint, grantQ, { t: [txId], r: [recipient] }),
      gqlQuery<Node>(endpoint, revokeQ, { t: [txId], r: [recipient] }),
    ]);
    const docNode = docJson?.data?.transactions?.edges?.[0]?.node;
    if (docNode) {
      docOwner = docNode.owner?.address ?? docOwner;
      // The doc shares to us at upload time if it carries our Rcpt-<recipient> tag.
      if (docNode.tags.some((t) => t.name === `Rcpt-${recipient}`)) shareTime = Math.max(shareTime, unixTime(docNode));
    }
    for (const e of grantJson?.data?.transactions?.edges ?? []) shareTime = Math.max(shareTime, unixTime(e.node));
    for (const e of revokeJson?.data?.transactions?.edges ?? []) {
      if (docOwner && e.node.owner?.address !== docOwner) continue; // only the owner may revoke
      revokeTime = Math.max(revokeTime, unixTime(e.node));
    }
  }
  return revokeTime > shareTime;
}

/**
 * Discover everyone a document is CURRENTLY shared with. Sharing and revoking
 * both leave permanent on-chain records, so a recipient is "shared" only when
 * their most recent SHARE (the doc's own Recipient tags at upload, a grant
 * record, or a fresh local share) is newer than their most recent REVOKE — this
 * is what lets you re-share someone you previously revoked. `ownerAddress` (the
 * connected wallet, which owns this doc) anchors which revokes count, so a third
 * party can't fake one.
 */
export async function fetchDocumentRecipients(txId: string, ownerAddress?: string): Promise<string[]> {
  // recipient → latest share time, and recipient → latest revoke time.
  const shareTime = new Map<string, number>();
  const revokeTime = new Map<string, number>();
  const bump = (m: Map<string, number>, addr: string, t: number) => {
    if (t >= (m.get(addr) ?? -1)) m.set(addr, t);
  };
  // Seed local shares AND revokes (the owner's own actions take effect before
  // on-chain indexing; newest-wins resolves them against each other).
  for (const [addr, t] of Object.entries(loadShareTimes(txId))) bump(shareTime, addr, t);
  for (const [addr, t] of Object.entries(loadRevokeTimes(txId))) bump(revokeTime, addr, t);

  let docOwner = ownerAddress ?? "";

  type Node = { owner?: { address: string }; tags: { name: string; value: string }[] };
  const queries: [string, Record<string, unknown>, "doc" | "grant" | "revoke"][] = [
    // The document's own tags (+ owner, which anchors who may revoke).
    [`query($id:[ID!]!){transactions(ids:$id,first:1){edges{node{owner{address} tags{name value}}}}}`, { id: [txId] }, "doc"],
    // Access-grant records that target this document.
    [`query($t:[String!]!){transactions(tags:[{name:"App-Name",values:["GTV-Access-Grant"]},{name:"Target",values:$t}],first:100){edges{node{owner{address} tags{name value}}}}}`, { t: [txId] }, "grant"],
    // Revoke tombstones that target this document.
    [`query($t:[String!]!){transactions(tags:[{name:"App-Name",values:["GTV-Access-Revoke"]},{name:"Target",values:$t}],first:100){edges{node{owner{address} tags{name value}}}}}`, { t: [txId] }, "revoke"],
  ];

  const endpoints = ["https://arweave.net/graphql", "https://turbo-gateway.com/graphql"];
  const fetchEdges = async (endpoint: string, query: string, variables: Record<string, unknown>, kind: "doc" | "grant" | "revoke") => {
    const json = await gqlQuery<Node>(endpoint, query, variables);
    return json ? { edges: json.data?.transactions?.edges ?? [], kind } : null;
  };

  const results = await Promise.all(
    endpoints.flatMap((ep) => queries.map(([query, variables, kind]) => fetchEdges(ep, query, variables, kind)))
  );
  // Pass 1: learn the doc owner (anchors valid revokes) if not supplied.
  if (!docOwner) {
    for (const r of results) {
      if (r?.kind !== "doc") continue;
      for (const e of r.edges) if (e.node.owner?.address) docOwner = e.node.owner.address;
    }
  }
  // Pass 2: record share/revoke timestamps per recipient.
  for (const r of results) {
    if (!r) continue;
    for (const e of r.edges) {
      const tags: Record<string, string> = {};
      for (const tag of e.node.tags) tags[tag.name] = tag.value;
      const t = Number(tags["Unix-Time"]) || 0;
      if (r.kind === "revoke") {
        // Only revokes from the document owner count.
        if (docOwner && e.node.owner?.address !== docOwner) continue;
        const rcpt = tags["Recipient"];
        if (rcpt) bump(revokeTime, rcpt, t);
        continue;
      }
      for (const tag of e.node.tags) {
        // Recipients are carried as a `Recipient` tag (value = address) and/or
        // as `Rcpt-<address>` tag names. Read both so docs shared before the
        // Recipient tag existed still resolve.
        if (tag.name === "Recipient") bump(shareTime, tag.value, t);
        else if (tag.name.startsWith("Rcpt-")) bump(shareTime, tag.name.slice("Rcpt-".length), t);
      }
    }
  }
  // Currently shared = latest share is at least as recent as the latest revoke.
  const result: string[] = [];
  for (const [addr, st] of shareTime) {
    if (st >= (revokeTime.get(addr) ?? -1)) result.push(addr);
  }
  return result;
}
