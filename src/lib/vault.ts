import { gqlQuery } from "./gql";

export interface StoredUpload {
  txId: string;
  irysGatewayUrl: string;
  gatewayUrl: string;
  originalName: string;
  originalType: string;
  originalSize: number;
  documentType: string;
  uploadedAt: number;
  ivBase64: string;
  wrappedKeyBase64: string;
  tags: string[];
  // Raw AES-GCM key (base64). Stored so the owner can decrypt in the vault with
  // no wallet popup. Safe here only because the whole vault record already lives
  // in this browser's localStorage; it is NEVER uploaded to Arweave.
  rawKeyBase64?: string;
  // How wrappedKeyBase64 is wrapped: "master" (vault master key, popup-free),
  // "wallet" (legacy RSA, needs a prompt), or "shared" (also has on-chain
  // per-recipient copies). Absent ⇒ legacy "wallet". The uploader's own
  // wrappedKeyBase64 is always the master copy, so vault decrypt stays popup-free.
  keyScheme?: "master" | "wallet" | "shared";
  // "owned" = you uploaded it (in localStorage); "shared" = someone shared it
  // with your wallet (discovered on-chain). Absent ⇒ owned.
  ownership?: "owned" | "shared";
  // EXACT storage cost in AR-equivalent (Turbo's charged winc ÷ 1e12), recorded at upload
  // time. 0 for free-tier uploads. Absent for older/shared rows ⇒ dashboard falls back to the
  // size-based estimate. Never uploaded on-chain.
  costAr?: number;
}

/**
 * Find documents shared WITH this wallet (you're a recipient but not the
 * uploader), via the on-chain `Recipient` tag. Returns vault-shaped rows.
 */
function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const binary = atob(b64 + pad);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return arr;
}

export async function fetchSharedDocuments(
  address: string,
  onPartial?: (docs: StoredUpload[]) => void,
): Promise<StoredUpload[]> {
  const rcptTag = `Rcpt-${address}`;
  const byData = new Map<string, StoredUpload>();
  // dataTxId → the wallet that shared it with us (the doc uploader or grant
  // author). A revoke only counts if it comes from this same wallet.
  const sharer = new Map<string, string>();
  // dataTxId → latest SHARE time and latest valid REVOKE time. A doc is hidden
  // only when its newest revoke is newer than its newest share — so re-sharing
  // someone after revoking them brings the doc back.
  const shareTime = new Map<string, number>();
  const revokeTime = new Map<string, number>();
  const bump = (m: Map<string, number>, key: string, t: number) => {
    if (t >= (m.get(key) ?? -1)) m.set(key, t);
  };

  const ingest = (edges: { node: GqlNode }[]) => {
    for (const e of edges) {
      const node = e.node;
      if (node.owner?.address === address) continue; // our own uploads aren't "shared with" us
      const t: Record<string, string> = {};
      for (const tag of node.tags) t[tag.name] = tag.value;

      // Only docs carrying OUR wrapped key + an IV are decryptable by us.
      const rcpt = t[rcptTag];
      const ivB64u = t["Encryption-IV"];
      if (!rcpt || !ivB64u) continue;

      // Data lives on the document itself, or on a grant's Target.
      const dataTxId = t["App-Name"] === "GTV-Access-Grant" ? t["Target"] : node.id;
      if (!dataTxId) continue;
      bump(shareTime, dataTxId, Number(t["Unix-Time"]) || 0); // track even for dup records
      if (byData.has(dataTxId)) continue; // but build the row only once
      sharer.set(dataTxId, node.owner?.address ?? "");

      byData.set(dataTxId, {
        txId: dataTxId,
        irysGatewayUrl: `https://gateway.irys.xyz/${dataTxId}`,
        gatewayUrl: `https://arweave.net/${dataTxId}`,
        originalName: t["Document-Name"] || dataTxId,
        originalType: t["Original-MIME"] || "application/octet-stream",
        originalSize: Number(t["Original-Size"]) || 0,
        documentType: t["Document-Type"] || "Other",
        uploadedAt: Number(t["Unix-Time"]) || 0,
        // Convert the tags' base64url to the standard base64 the vault uses.
        ivBase64: toBase64(base64UrlToBytes(ivB64u)),
        wrappedKeyBase64: toBase64(base64UrlToBytes(rcpt)),
        // The owner's custom searchable tags, carried on the share record.
        tags: (t["Document-Tags"] ?? "").split(",").map((s) => s.trim()).filter(Boolean),
        keyScheme: "shared",
        ownership: "shared",
      });
    }
  };

  // Revoke tombstones (App-Name: GTV-Access-Revoke) targeting our shares. We
  // record the latest revoke time per dataTxId, but only from the wallet that
  // shared it (validated against `sharer` in the filter below).
  const revoked: { target: string; owner: string; time: number }[] = [];
  const ingestRevokes = (edges: { node: GqlNode }[]) => {
    for (const e of edges) {
      const t: Record<string, string> = {};
      for (const tag of e.node.tags) t[tag.name] = tag.value;
      if (t["Target"]) revoked.push({ target: t["Target"], owner: e.node.owner?.address ?? "", time: Number(t["Unix-Time"]) || 0 });
    }
  };

  // arweave.net indexes the Irys-origin documents; turbo-gateway.com indexes the
  // Turbo-origin grants/revokes within minutes (arweave.net can lag ~25 min on
  // those). Query BOTH and union — neither alone has everything. Every
  // (endpoint × query) request runs in PARALLEL so a slow/flaky endpoint can't
  // serialize the wait (sequentially this was up to ~48s).
  const endpoints = ["https://arweave.net/graphql", "https://turbo-gateway.com/graphql"];
  // EXACT (scalable): docs/grants explicitly tagged Recipient = me.
  const exact = `query($me:[String!]!){transactions(tags:[{name:"Recipient",values:$me}],first:100,sort:HEIGHT_DESC){edges{node{id owner{address} tags{name value}}}}}`;
  // FALLBACK (bounded scan): recent Trust Vault docs/grants, matched client-side
  // on the Rcpt-<me> tag — catches docs shared before the Recipient tag existed.
  const scan = `query{transactions(tags:[{name:"App-Name",values:["Generational-Trust-Vault","GTV-Access-Grant"]}],first:100,sort:HEIGHT_DESC){edges{node{id owner{address} tags{name value}}}}}`;
  // Revoke tombstones aimed at us.
  const revokes = `query($me:[String!]!){transactions(tags:[{name:"App-Name",values:["GTV-Access-Revoke"]},{name:"Recipient",values:$me}],first:100,sort:HEIGHT_DESC){edges{node{id owner{address} tags{name value}}}}}`;
  const fetchEdges = async (endpoint: string, query: string, variables: Record<string, unknown>) => {
    // Via the /api/gql proxy: server-side, so turbo-gateway.com's missing CORS
    // headers (on its 502s) never block or spam the browser.
    const json = await gqlQuery<GqlNode>(endpoint, query, variables);
    return json ? (json.data?.transactions?.edges ?? []) : null;
  };

  // Current visible list: everything ingested so far, minus any doc whose newest
  // valid revoke (from the wallet that shared it) is newer than its newest share.
  // Recomputed (not mutated) so we can emit partials.
  const currentResults = (): StoredUpload[] => {
    for (const r of revoked) {
      if (sharer.get(r.target) === r.owner) bump(revokeTime, r.target, r.time);
    }
    const out = new Map(byData);
    for (const [dataTxId] of byData) {
      const revT = revokeTime.get(dataTxId) ?? -1;
      const shrT = shareTime.get(dataTxId) ?? 0;
      if (revT > shrT) out.delete(dataTxId);
    }
    return Array.from(out.values());
  };

  // Gather revokes from BOTH endpoints. Documents are emitted only after this
  // resolves, so a doc is never shown before we know whether it's revoked —
  // otherwise a doc from arweave.net flashes in, then vanishes when
  // turbo-gateway.com's revoke arrives (the "shows and disappears" flicker).
  // It runs concurrently with the document queries below (not before), so it
  // adds no latency in the common no-revoke case.
  const revokesReady = Promise.all(
    endpoints.map(async (ep) => {
      const edges = await fetchEdges(ep, revokes, { me: [address] });
      if (edges) ingestRevokes(edges);
    }),
  );

  // Documents: each endpoint emits a partial as soon as it answers (and revokes
  // are in), so fast arweave.net results render without waiting on a slow/flaky
  // turbo-gateway.com (and vice-versa).
  await Promise.all(
    endpoints.map(async (endpoint) => {
      const settled = await Promise.all([
        fetchEdges(endpoint, exact, { me: [address] }),
        fetchEdges(endpoint, scan, {}),
      ]);
      for (const edges of settled) if (edges) ingest(edges);
      await revokesReady; // ensure revokes are applied before we emit (no flicker)
      onPartial?.(currentResults());
    }),
  );
  return currentResults();
}

interface GqlNode {
  id: string;
  address?: string;
  owner?: { address: string };
  tags: { name: string; value: string }[];
}

/**
 * Discover the wallet's OWN uploads directly from Arweave (App-Name + owner) and rebuild
 * the vault rows from their tags — so the vault repopulates after a cache wipe with ZERO
 * dependence on the local index or any state snapshot. The files live permanently on Arweave
 * owned by the wallet; each carries its IV + Wrapped-Key + Key-Scheme, and for master/shared
 * schemes the uploader's Wrapped-Key is the master copy, so decrypt is popup-free (the open
 * path unwraps it with the recoverable vault master key). This is the durable source of truth
 * for vault files — localStorage is just a fast cache of it.
 */
export async function fetchOwnedDocuments(address: string): Promise<StoredUpload[]> {
  const query = `query($o:[String!]!){transactions(owners:$o,tags:[{name:"App-Name",values:["Generational-Trust-Vault"]}],first:100,sort:HEIGHT_DESC){edges{node{id owner{address} tags{name value}}}}}`;
  const out = new Map<string, StoredUpload>();
  // arweave.net indexes mined docs reliably; turbo-gateway.com catches very recent ones.
  for (const endpoint of ["https://arweave.net/graphql", "https://turbo-gateway.com/graphql"]) {
    const json = await gqlQuery<GqlNode>(endpoint, query, { o: [address] });
    const edges = json?.data?.transactions?.edges ?? [];
    for (const e of edges) {
      const node = e.node;
      if (out.has(node.id)) continue;
      const t: Record<string, string> = {};
      for (const tag of node.tags) t[tag.name] = tag.value;
      const ivB64u = t["Encryption-IV"];
      const wrapB64u = t["Wrapped-Key"];
      if (!ivB64u || !wrapB64u) continue; // not a decryptable document
      // From the OWNER's view, master AND shared uploads keep the master-wrapped key copy in
      // Wrapped-Key (the recipient copies are separate Rcpt-<addr> tags) → both decrypt via the
      // master key. Only legacy (no Key-Scheme) used the wallet RSA wrap.
      const ks = t["Key-Scheme"];
      const keyScheme: StoredUpload["keyScheme"] = ks === "master" ? "master" : ks === "shared" ? "shared" : "wallet";
      out.set(node.id, {
        txId: node.id,
        irysGatewayUrl: `https://arweave.net/${node.id}`,
        gatewayUrl: `https://arweave.net/${node.id}`,
        originalName: t["Document-Name"] || node.id,
        originalType: t["Original-MIME"] || "application/octet-stream",
        originalSize: Number(t["Original-Size"]) || 0,
        documentType: t["Document-Type"] || "Other",
        uploadedAt: Number(t["Unix-Time"]) || 0,
        ivBase64: toBase64(base64UrlToBytes(ivB64u)),
        wrappedKeyBase64: toBase64(base64UrlToBytes(wrapB64u)),
        tags: (t["Document-Tags"] ?? "").split(",").map((s) => s.trim()).filter(Boolean),
        keyScheme,
        ownership: "owned",
      });
    }
    if (out.size > 0) break; // first endpoint with results wins; the other is just a fallback
  }
  return Array.from(out.values());
}

export function storageKey(address: string): string {
  return `gtv_uploads_${address}`;
}

export function loadStoredUploads(address: string | null): StoredUpload[] {
  if (!address || typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey(address));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredUpload[];
    // Backfill missing tags field for older entries
    return parsed.map((u) => ({ ...u, tags: u.tags ?? [] }));
  } catch {
    return [];
  }
}

export function saveUpload(
  address: string | null,
  upload: StoredUpload
): void {
  if (!address || typeof window === "undefined") return;
  try {
    const existing = loadStoredUploads(address);
    const updated = [upload, ...existing].slice(0, 50);
    localStorage.setItem(storageKey(address), JSON.stringify(updated));
    // Snapshot state to Arweave so the file TX ids survive a cache wipe. The dynamic import
    // + sync code only load when NEXT_PUBLIC_STATE_SYNC is set; with the flag off this branch
    // is dead and the app behaves exactly as before.
    if (process.env.NEXT_PUBLIC_STATE_SYNC) {
      import("./stateSync").then((m) => m.mirror(address)).catch(() => {});
    }
  } catch {}
}

/**
 * Replace the whole local vault index (used when self-healing from on-chain discovery via
 * fetchOwnedDocuments) and re-mirror to the snapshot so it's durable going forward.
 */
export function saveStoredUploads(address: string | null, uploads: StoredUpload[]): void {
  if (!address || typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey(address), JSON.stringify(uploads.slice(0, 200)));
    if (process.env.NEXT_PUBLIC_STATE_SYNC) {
      import("./stateSync").then((m) => m.mirror(address)).catch(() => {});
    }
  } catch {}
}

export function fromBase64(s: string): Uint8Array {
  const binary = atob(s);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return arr;
}

export function toBase64(arr: Uint8Array): string {
  let s = "";
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}
