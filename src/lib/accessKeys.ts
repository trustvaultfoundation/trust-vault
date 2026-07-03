// Access-control primitives: authorized identities (multi-party), PBKDF2
// password wrappers (non-wallet recipients), and inheritance triggers.

import { fromBase64, toBase64 } from "./vault";
import { fetchPublicKey, looksLikePublicKey, addressFromPublicKey, wrapForRecipient } from "./recipients";

const ADDR_RE = /^[A-Za-z0-9_-]{43}$/;

export function isValidArweaveAddress(s: string): boolean {
  return ADDR_RE.test(s.trim());
}

// ── Authorized identities (multi-party encryption address book) ───────────────

export type SocialKind = "x" | "github" | "linkedin" | "website" | "telegram" | "discord" | "email";
export const SOCIAL_KINDS: { kind: SocialKind; label: string; placeholder: string }[] = [
  { kind: "x", label: "X / Twitter", placeholder: "@handle or link" },
  { kind: "github", label: "GitHub", placeholder: "username or link" },
  { kind: "linkedin", label: "LinkedIn", placeholder: "profile link" },
  { kind: "website", label: "Website", placeholder: "https://…" },
  { kind: "telegram", label: "Telegram", placeholder: "@handle" },
  { kind: "discord", label: "Discord", placeholder: "username" },
  { kind: "email", label: "Email", placeholder: "name@example.com" },
];
export interface Social { kind: SocialKind; value: string }

export interface AuthorizedIdentity {
  address: string;
  label: string;
  /** Whether a public key is known (required to encrypt to them). */
  hasPublicKey: boolean;
  /** The recipient's RSA public modulus (base64url), when known. */
  publicKey?: string;
  /** Optional social handles/links, shown on their profile + hovercard. */
  socials?: Social[];
  addedAt: number;
}

const idKey = (owner: string) => `gtv_identities_${owner}`;

export function loadIdentities(owner: string | null): AuthorizedIdentity[] {
  if (!owner || typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(idKey(owner));
    return raw ? (JSON.parse(raw) as AuthorizedIdentity[]) : [];
  } catch {
    return [];
  }
}

export function saveIdentities(owner: string | null, list: AuthorizedIdentity[]): void {
  if (!owner || typeof window === "undefined") return;
  try {
    localStorage.setItem(idKey(owner), JSON.stringify(list));
  } catch {
    /* non-critical */
  }
}

// Create/update an address-book entry (the name + socials YOU keep for someone — including
// yourself). Merges into the existing record so a public key isn't lost when only the name changes.
export function upsertIdentity(owner: string | null, entry: { address: string; label?: string; socials?: Social[]; publicKey?: string }): AuthorizedIdentity[] {
  if (!owner || !entry.address) return loadIdentities(owner);
  const list = loadIdentities(owner);
  const i = list.findIndex((x) => x.address === entry.address);
  const socials = (entry.socials ?? (i >= 0 ? list[i].socials : []))?.filter((s) => s.value.trim());
  // Only overwrite the stored public key when a (new) one is supplied — never lose a known key.
  const keyPatch = entry.publicKey ? { publicKey: entry.publicKey, hasPublicKey: true } : {};
  if (i >= 0) {
    list[i] = { ...list[i], label: entry.label?.trim() || list[i].label, socials, ...keyPatch };
  } else {
    list.push({ address: entry.address, label: entry.label?.trim() || "", hasPublicKey: !!entry.publicKey, publicKey: entry.publicKey, socials, addedAt: Date.now() });
  }
  saveIdentities(owner, list);
  return list;
}

// Resolve a social entry to an openable URL.
export function socialUrl(s: Social): string {
  const v = s.value.trim();
  if (/^https?:\/\//i.test(v)) return v;
  const handle = v.replace(/^@/, "");
  switch (s.kind) {
    case "x": return `https://x.com/${handle}`;
    case "github": return `https://github.com/${handle}`;
    case "linkedin": return v.includes("/") ? `https://${v.replace(/^\/+/, "")}` : `https://www.linkedin.com/in/${handle}`;
    case "telegram": return `https://t.me/${handle}`;
    case "discord": return v; // no canonical profile URL
    case "email": return `mailto:${v}`;
    case "website": return `https://${v.replace(/^\/+/, "")}`;
  }
}

// ── Password-protected access key (PBKDF2 → AES-GCM) ───────────────────────────
//
// Wraps a document's raw AES key with a key derived from a human password, so a
// recipient without an Arweave wallet (an executor, an elderly relative) can
// decrypt with just the password + this metadata wrapper + the vault link.

export interface PasswordWrapper {
  v: 1;
  alg: "PBKDF2-SHA256+AES-GCM";
  iterations: number;
  txId: string;
  originalName: string;
  originalType: string;
  salt: string; // base64
  iv: string; // base64
  wrappedKey: string; // base64 — AES-GCM(pbkdf2Key, rawFileKey)
}

const PBKDF2_ITERATIONS = 250_000;

async function derivePasswordKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as Uint8Array<ArrayBuffer>, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function generatePasswordWrapper(
  password: string,
  rawFileKeyB64: string,
  doc: { txId: string; originalName: string; originalType: string }
): Promise<PasswordWrapper> {
  const rawFileKey = fromBase64(rawFileKeyB64) as Uint8Array<ArrayBuffer>;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derivePasswordKey(password, salt);
  const wrapped = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, rawFileKey)
  );
  return {
    v: 1,
    alg: "PBKDF2-SHA256+AES-GCM",
    iterations: PBKDF2_ITERATIONS,
    txId: doc.txId,
    originalName: doc.originalName,
    originalType: doc.originalType,
    salt: toBase64(salt),
    iv: toBase64(iv),
    wrappedKey: toBase64(wrapped),
  };
}

// ── Inheritance triggers ("dead man's switch") ────────────────────────────────
//
// UI/config only for now — enforcement requires an AO/SmartWeave contract that
// releases keys on the trigger. Persisted so the estate setup survives reloads.

export interface InheritanceConfig {
  /** The estate/family wallet that should inherit access (address or public key). */
  beneficiary: string;
  timeLockEnabled: boolean;
  /** ISO date (yyyy-mm-dd) after which access is released. */
  unlockDate: string;
  multiSigEnabled: boolean;
  /** Secondary approver wallet (e.g. the attorney). */
  approverAddress: string;
}

export const DEFAULT_INHERITANCE: InheritanceConfig = {
  beneficiary: "",
  timeLockEnabled: false,
  unlockDate: "",
  multiSigEnabled: false,
  approverAddress: "",
};

const inheritanceKey = (owner: string) => `gtv_inheritance_${owner}`;

export function loadInheritance(owner: string | null): InheritanceConfig {
  if (!owner || typeof window === "undefined") return DEFAULT_INHERITANCE;
  try {
    const raw = localStorage.getItem(inheritanceKey(owner));
    return raw ? { ...DEFAULT_INHERITANCE, ...JSON.parse(raw) } : DEFAULT_INHERITANCE;
  } catch {
    return DEFAULT_INHERITANCE;
  }
}

export function saveInheritance(owner: string | null, cfg: InheritanceConfig): void {
  if (!owner || typeof window === "undefined") return;
  try {
    localStorage.setItem(inheritanceKey(owner), JSON.stringify(cfg));
  } catch {
    /* non-critical */
  }
}

// ── Estate release package ────────────────────────────────────────────────────
//
// Turns the inheritance config into a concrete, portable artifact: each
// document's key is RSA-wrapped for the beneficiary so they can decrypt with
// their own wallet. With the multi-signature trigger on, the key is split
// 2-of-2 (information-theoretic XOR shares) between the beneficiary and the
// approver — BOTH must cooperate to reconstruct it. The time-lock date travels
// as honored metadata. The executor holds this package and releases it per the
// instructions (a fully on-chain auto-release process is a future enhancement).

export interface ReleaseDoc {
  txId: string;
  originalName: string;
  rawKeyB64: string;
}

export interface ReleasePackage {
  app: "Generational-Trust-Vault";
  kind: "estate-release";
  version: 1;
  generatedAt: string;
  beneficiary: string;
  triggers: { unlockDate?: string; approver?: string };
  documents: {
    txId: string;
    name: string;
    multiSig: boolean;
    wrappedForBeneficiary: string; // base64
    wrappedForApprover?: string; // base64 (multi-sig only)
  }[];
}

async function resolveModulus(token: string): Promise<{ address: string; modulus: string } | null> {
  const t = token.trim();
  if (!t) return null;
  if (looksLikePublicKey(t)) return { address: await addressFromPublicKey(t), modulus: t };
  const modulus = await fetchPublicKey(t);
  return modulus ? { address: t, modulus } : null;
}

function xorBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

export async function generateReleasePackage(
  docs: ReleaseDoc[],
  cfg: InheritanceConfig
): Promise<ReleasePackage> {
  if (docs.length === 0) throw new Error("You have no documents with a local key to include.");
  const beneficiary = await resolveModulus(cfg.beneficiary);
  if (!beneficiary) {
    throw new Error("Couldn't find the beneficiary's public key. Paste their public key (from “View a Document”) instead of an address.");
  }
  let approver: { address: string; modulus: string } | null = null;
  if (cfg.multiSigEnabled) {
    approver = await resolveModulus(cfg.approverAddress);
    if (!approver) throw new Error("Couldn't find the approver's public key.");
  }

  const documents: ReleasePackage["documents"] = [];
  for (const doc of docs) {
    const raw = fromBase64(doc.rawKeyB64);
    if (cfg.multiSigEnabled && approver) {
      const shareApprover = crypto.getRandomValues(new Uint8Array(raw.length));
      const shareBeneficiary = xorBytes(raw, shareApprover); // raw = A ⊕ B
      documents.push({
        txId: doc.txId,
        name: doc.originalName,
        multiSig: true,
        wrappedForBeneficiary: toBase64(await wrapForRecipient(beneficiary.modulus, shareBeneficiary)),
        wrappedForApprover: toBase64(await wrapForRecipient(approver.modulus, shareApprover)),
      });
    } else {
      documents.push({
        txId: doc.txId,
        name: doc.originalName,
        multiSig: false,
        wrappedForBeneficiary: toBase64(await wrapForRecipient(beneficiary.modulus, raw)),
      });
    }
  }

  return {
    app: "Generational-Trust-Vault",
    kind: "estate-release",
    version: 1,
    generatedAt: new Date().toISOString(),
    beneficiary: beneficiary.address,
    triggers: {
      unlockDate: cfg.timeLockEnabled && cfg.unlockDate ? cfg.unlockDate : undefined,
      approver: cfg.multiSigEnabled && approver ? approver.address : undefined,
    },
    documents,
  };
}
