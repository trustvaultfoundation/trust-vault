// Silent publishing identity for DePM snapshots.
//
// DePM snapshots are public, plaintext, free (tiny → Turbo free tier) and re-published automatically
// as the board changes. Signing each one with the user's Wander wallet would pop an "approve" dialog
// every time — which the user explicitly rejected for no-value writes. So instead we mint a dedicated
// Arweave keypair PER WALLET, in-browser, and sign snapshots with it directly (arbundles, same path as
// the passkey embedded wallet). No extension, no popup, ever.
//
// The DePM key is the on-chain author of that wallet's public snapshots — stable so a board's snapshots
// stack (latest wins) and the owner can keep updating / unpublishing. It is cached in localStorage
// (per browser, like the rest of the DePM settings) — losing it just means the next publish starts a
// fresh public entry; the key never holds value, so the localStorage tradeoff is low-stakes.

import { addressFromPublicKey } from "./recipients";
import { postToTurbo, type DataItem } from "./turbo";

const KEY = (wallet: string) => `gtv_depm_jwk_${wallet}`;

interface DepmIdentity { address: string; jwk: JsonWebKey }

// RSA-4096 Arweave keypair, generated in-browser (alg binding stripped so arbundles can use it freely).
async function generateJwk(): Promise<JsonWebKey> {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSA-PSS", modulusLength: 4096, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  delete jwk.alg;
  delete jwk.key_ops;
  jwk.ext = true;
  return jwk;
}

/** Load (or mint + persist) this wallet's DePM publishing identity. */
export async function getDepmIdentity(wallet: string): Promise<DepmIdentity> {
  try {
    const raw = localStorage.getItem(KEY(wallet));
    if (raw) {
      const jwk = JSON.parse(raw) as JsonWebKey;
      if (jwk?.n) return { address: await addressFromPublicKey(jwk.n as string), jwk };
    }
  } catch { /* regenerate below */ }
  const jwk = await generateJwk();
  try { localStorage.setItem(KEY(wallet), JSON.stringify(jwk)); } catch { /* storage full/disabled */ }
  return { address: await addressFromPublicKey(jwk.n as string), jwk };
}

/** The on-chain author address of this wallet's public snapshots. */
export async function depmAuthorAddress(wallet: string): Promise<string> {
  return (await getDepmIdentity(wallet)).address;
}

// ── ANS-104 data-item signing with the DePM JWK (arbundles browser build, lazy-loaded) ──
async function signWithJwk(jwk: JsonWebKey, item: DataItem): Promise<ArrayBuffer> {
  const arb = (await import("arbundles")) as unknown as {
    ArweaveSigner: new (jwk: JsonWebKey) => unknown;
    createData: (data: Uint8Array, signer: unknown, opts?: { tags?: { name: string; value: string }[] }) => { sign(signer: unknown): Promise<void>; getRaw(): Uint8Array };
  };
  const signer = new arb.ArweaveSigner(jwk);
  const di = arb.createData(item.data, signer, { tags: item.tags });
  await di.sign(signer);
  const raw = di.getRaw();
  return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
}

/** Publish records signed by the wallet's DePM identity — no wallet popup. */
export async function publishDepmRecords(wallet: string, items: DataItem[]): Promise<void> {
  if (items.length === 0) return;
  const { jwk } = await getDepmIdentity(wallet);
  for (const it of items) await postToTurbo(await signWithJwk(jwk, it));
}
