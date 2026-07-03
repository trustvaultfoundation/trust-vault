// Publish signed ANS-104 data items to ardrive Turbo.
//
// Turbo's free tier covers uploads under ~105 KB (its `freeUploadLimitBytes`), so
// tiny records (access grants, board events…) cost nothing — unlike node2.irys.xyz,
// which has NO free tier for AR and 402s every upload. Turbo bundles to Arweave,
// indexed by arweave.net + turbo-gateway.com GraphQL (read via /api/gql).
//
// Extracted from sharing.ts so the board sync layer reuses the exact same signing
// + publish path (incl. the Wander `signDataItem` return-shape normalization).

export const TURBO_UPLOAD_URL = "https://upload.ardrive.io/v1/tx";

export type DataItem = { data: Uint8Array; tags: { name: string; value: string }[] };
type SignedItem = ArrayBuffer | { getRaw(): Uint8Array };
type WalletSigning = {
  signDataItem?: (item: DataItem) => Promise<SignedItem>;
  batchSignDataItem?: (items: DataItem[]) => Promise<SignedItem[]>;
};

// Wander's signDataItem may return either an ArrayBuffer or an object with
// getRaw(); normalize both to a plain ArrayBuffer body Turbo accepts.
export function normalizeSigned(signed: SignedItem): ArrayBuffer {
  if (signed && typeof (signed as { getRaw?: unknown }).getRaw === "function") {
    const raw = (signed as { getRaw(): Uint8Array }).getRaw();
    return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
  }
  return signed as ArrayBuffer;
}

export async function postToTurbo(body: ArrayBuffer): Promise<void> {
  const res = await fetch(TURBO_UPLOAD_URL, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    if (res.status === 402) throw new Error("This record is too large for the free tier.");
    throw new Error(`Couldn't publish the record (${res.status})${err ? `: ${err}` : ""}.`);
  }
}

// Sign one or more data items (a SINGLE wallet approval when batchSignDataItem is
// available) and publish each via Turbo.
export async function publishRecords(items: DataItem[]): Promise<void> {
  if (items.length === 0) return;
  const w = window.arweaveWallet as typeof window.arweaveWallet & WalletSigning;
  if (typeof w.signDataItem !== "function") {
    throw new Error("Your wallet doesn't support this (needs signDataItem). Update Wander.");
  }
  let bodies: ArrayBuffer[];
  if (typeof w.batchSignDataItem === "function" && items.length > 1) {
    bodies = (await w.batchSignDataItem(items)).map(normalizeSigned);
  } else {
    bodies = [];
    for (const it of items) bodies.push(normalizeSigned(await w.signDataItem!(it)));
  }
  for (const body of bodies) await postToTurbo(body);
}

export const publishRecord = (item: DataItem): Promise<void> => publishRecords([item]);

// Upload a PUBLIC (unencrypted) file to Arweave via Turbo and return its txId — the same bundler +
// "free under ~100 KiB, otherwise draw on Turbo credits (402 = top up)" path the document uploader
// uses, but WITHOUT encryption so anyone can open it (e.g. a public whitepaper on the DePM page).
// Signed once with the wallet (a deliberate, paid, value action — a prompt here is expected).
export async function uploadPublicFile(file: File): Promise<{ txId: string; name: string; url: string }> {
  const w = window.arweaveWallet as typeof window.arweaveWallet & WalletSigning;
  if (typeof w.signDataItem !== "function") throw new Error("Your wallet can't sign files. Update Wander and reconnect.");
  if (file.size > 50 * 1024 * 1024) throw new Error(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — please use one under 50 MB or paste a link.`);
  const data = new Uint8Array(await file.arrayBuffer());
  const tags = [
    { name: "App-Name", value: "GTV-DePM-File" },
    { name: "Content-Type", value: file.type || "application/octet-stream" },
    { name: "File-Name", value: file.name },
    { name: "Unix-Time", value: String(Date.now()) },
  ];
  let body: ArrayBuffer;
  try {
    body = normalizeSigned(await w.signDataItem!({ data, tags }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/reject|cancel|denied/i.test(msg)) throw new Error("Upload cancelled.");
    throw new Error(`Couldn't sign the file: ${msg}`);
  }
  const res = await fetch(TURBO_UPLOAD_URL, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body });
  if (res.status === 402) throw new Error("This file is above Turbo's free size, so it needs Turbo credits. Top up at https://turbo.ardrive.io, then upload again — smaller files are free.");
  if (!res.ok) throw new Error(`Upload failed (${res.status}).`);
  const text = await res.text();
  let txId = "";
  try { txId = (JSON.parse(text) as { id?: string }).id?.trim() || ""; } catch { txId = text.trim(); }
  if (!txId || txId.length < 30) throw new Error("Turbo returned an unexpected response.");
  return { txId, name: file.name, url: `https://arweave.net/${txId}` };
}

// Publish records WITHOUT a wallet popup, via Wander's `dispatch()`. Wander bundles
// small data items (well within our <105 KB records) and signs them silently — there's
// no value transfer, so it never shows the "authorize" prompt that signDataItem does.
// Used for low-stakes, high-frequency writes (board edits, DePM snapshots) so routine
// actions like adding a column don't nag the user. Falls back to the signDataItem +
// Turbo path if dispatch is missing or fails (older wallets, oversized item).
type Dispatchable = { dispatch?: (tx: unknown) => Promise<{ id: string }> };
export async function dispatchRecords(items: DataItem[]): Promise<void> {
  if (items.length === 0) return;
  const w = window.arweaveWallet as typeof window.arweaveWallet & Dispatchable;
  // Only fall back to the (prompting) signing path if the wallet has no dispatch at all.
  // If dispatch EXISTS we never silently fall back — that would reintroduce the very
  // approval popup we're trying to avoid for these free, no-value snapshots.
  if (typeof w.dispatch !== "function") return publishRecords(items);
  // arweave-js needs a Buffer global in the browser (same as the Irys path).
  const { Buffer: BrowserBuffer } = await import("buffer");
  if (typeof (globalThis as Record<string, unknown>)["Buffer"] === "undefined") {
    (globalThis as Record<string, unknown>)["Buffer"] = BrowserBuffer;
  }
  const { default: Arweave } = await import("arweave");
  const arweave = Arweave.init({ host: "arweave.net", port: 443, protocol: "https" });
  for (const it of items) {
    const tx = await arweave.createTransaction({ data: it.data });
    for (const t of it.tags) tx.addTag(t.name, t.value);
    await w.dispatch!(tx); // dispatch signs + bundles small items silently (no popup)
  }
}
