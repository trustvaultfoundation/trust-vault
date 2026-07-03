// Phase 6 — multi-recipient key sharing.
//
// A shared document's per-file AES key is wrapped separately for each recipient
// using that recipient's RSA public key (RSA-OAEP, SHA-256). Each recipient can
// then unwrap their own copy with their wallet (window.arweaveWallet.decrypt),
// so a law firm and a client's family can decrypt the same will independently —
// no shared secret, no re-upload.
//
// A recipient's public key is the RSA modulus found in the `owner` field of any
// transaction they've signed; combined with the standard exponent AQAB it forms
// the JWK needed to encrypt to them.

const ADDR_RE = /^[A-Za-z0-9_-]{43}$/;

export function isArweaveAddress(s: string): boolean {
  return ADDR_RE.test(s.trim());
}

/** A pasted RSA public key (modulus) is much longer than a 43-char address. */
export function looksLikePublicKey(s: string): boolean {
  const t = s.trim();
  return t.length > 80 && /^[A-Za-z0-9_-]+$/.test(t);
}

function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const binary = atob(b64 + pad);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return arr;
}

/** Derive an Arweave address from an RSA public modulus (base64url). */
export async function addressFromPublicKey(modulusB64Url: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", base64UrlToBytes(modulusB64Url) as Uint8Array<ArrayBuffer>);
  return bytesToBase64Url(new Uint8Array(hash));
}

/** Fetch an address's RSA public modulus (base64url) from a past transaction. */
export async function fetchPublicKey(address: string): Promise<string | null> {
  const query = `query($o:[String!]!){transactions(owners:$o,first:1){edges{node{owner{key}}}}}`;
  for (const ep of ["https://arweave.net/graphql", "https://node2.irys.xyz/graphql"]) {
    try {
      const res = await fetch(ep, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables: { o: [address.trim()] } }),
      });
      if (!res.ok) continue;
      const json = await res.json();
      const key = json?.data?.transactions?.edges?.[0]?.node?.owner?.key;
      if (typeof key === "string" && key.length > 0) return key;
    } catch {
      /* try next endpoint */
    }
  }
  return null;
}

// RSA-OAEP with SHA-256: this matches ArConnect/Wander's `decrypt` (the
// WebCrypto-style { name: "RSA-OAEP" } form, which uses SHA-256), so ciphertext
// we produce here is byte-compatible with what the recipient's wallet unwraps.
async function importRecipientKey(modulusB64Url: string): Promise<CryptoKey> {
  const jwk: JsonWebKey = {
    kty: "RSA",
    n: modulusB64Url,
    e: "AQAB",
    alg: "RSA-OAEP-256",
    ext: true,
  };
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );
}

/** RSA-OAEP-encrypt a raw file key to a recipient's public modulus. */
export async function wrapForRecipient(
  modulusB64Url: string,
  rawFileKey: Uint8Array
): Promise<Uint8Array> {
  const key = await importRecipientKey(modulusB64Url);
  const ct = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    key,
    rawFileKey as Uint8Array<ArrayBuffer>
  );
  return new Uint8Array(ct);
}

export interface RecipientWrap {
  address: string;
  /** base64url(RSA-OAEP(recipientPubKey, rawFileKey)) */
  wrappedKeyB64Url: string;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Wrap a raw file key for every recipient. Each token is EITHER a 43-char
 * Arweave address (public key fetched on-chain — needs a prior transaction) OR
 * a pasted RSA public key (works even for brand-new wallets). Tokens whose
 * public key can't be resolved are returned in `missing`.
 */
export async function wrapKeyForRecipients(
  rawFileKey: Uint8Array,
  tokens: string[]
): Promise<{ wraps: RecipientWrap[]; missing: string[] }> {
  const wraps: RecipientWrap[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const raw of tokens) {
    const token = raw.trim();
    if (!token) continue;

    let address: string;
    let modulus: string | null;
    if (looksLikePublicKey(token)) {
      modulus = token;
      address = await addressFromPublicKey(token);
    } else {
      address = token;
      modulus = await fetchPublicKey(token);
    }

    if (seen.has(address)) continue;
    seen.add(address);

    if (!modulus) {
      missing.push(address);
      continue;
    }
    try {
      const wrapped = await wrapForRecipient(modulus, rawFileKey);
      wraps.push({ address, wrappedKeyB64Url: bytesToBase64Url(wrapped) });
    } catch {
      missing.push(address);
    }
  }
  return { wraps, missing };
}
