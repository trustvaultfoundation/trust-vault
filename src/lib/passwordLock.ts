// Password-protected file packaging + a local store of reusable passwords.
//
// "Download with password" turns a decrypted document into a portable, self-
// contained encrypted file (PBKDF2-SHA256 + AES-GCM) that anyone can open on the
// public /unlock page with just the password — no wallet, no Arweave. This is
// how you hand a document to an executor or relative who has no wallet.
//
// Saved passwords (labeled, e.g. per project) live in localStorage so the owner
// can reuse them. Like the rest of the vault this trades secrecy-at-rest for
// convenience: anyone with this browser profile can read them. The point that
// still holds: plaintext documents and keys are NEVER sent to a server.

import { toBase64, fromBase64 } from "./vault";

const PBKDF2_ITERATIONS = 250_000;
const PKG_TAG = "GTV-PasswordLock";

async function deriveKey(password: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as Uint8Array<ArrayBuffer>, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export interface LockedPackage {
  app: string;
  v: number;
  name: string;
  type: string;
  iterations: number;
  salt: string;
  iv: string;
  data: string;
}

async function encryptToPackage(blob: Blob, password: string, name: string, type: string): Promise<LockedPackage> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const plain = new Uint8Array(await blob.arrayBuffer()) as Uint8Array<ArrayBuffer>;
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  return {
    app: PKG_TAG,
    v: 1,
    name,
    type,
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(ct),
  };
}

/** Is this document a PDF (by MIME or extension)? PDFs get real PDF encryption. */
export function isPdf(name: string, type: string): boolean {
  return type === "application/pdf" || name.toLowerCase().endsWith(".pdf");
}

/**
 * Encrypt an existing PDF with a user password → a REAL password-protected PDF.
 * It opens (after the password prompt) in any PDF reader — the password lives in
 * the file itself, no wrapper. PDF-only; @cantoo/pdf-lib is dynamically imported
 * so it's only fetched when a password download actually happens.
 */
export async function lockPdfWithPassword(pdfBytes: ArrayBuffer, password: string): Promise<Blob> {
  const { PDFDocument } = await import("@cantoo/pdf-lib");
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true, updateMetadata: false });
  doc.encrypt({ userPassword: password, ownerPassword: password });
  const bytes = await doc.save();
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
}

/**
 * Encrypt a decrypted document with a password into a SELF-DECRYPTING HTML file.
 * The recipient just double-clicks it: it opens in any browser, asks for the
 * password, and downloads the ORIGINAL file (original name + type) after a local
 * PBKDF2 + AES-GCM decrypt. No wallet, no server, no special software. Named
 * `<original>.html` so they recognise their document.
 */
export async function lockBlobToHtml(
  blob: Blob,
  password: string,
  name: string,
  type: string
): Promise<{ blob: Blob; filename: string }> {
  const pkg = await encryptToPackage(blob, password, name, type);
  return {
    blob: new Blob([buildSelfDecryptingHtml(pkg)], { type: "text/html" }),
    filename: `${name}.html`,
  };
}

/**
 * Decrypt a locked document with its password. Accepts EITHER the self-
 * decrypting `.html` file (extracts the embedded package) or a raw JSON package
 * — used by the hosted /unlock fallback page.
 */
export async function unlockPackage(text: string, password: string): Promise<{ blob: Blob; name: string; type: string }> {
  // The HTML embeds the package in a <script type="application/json"> tag.
  const embedded = text.match(/<script id="gtv-pkg" type="application\/json">([\s\S]*?)<\/script>/);
  const jsonText = embedded ? embedded[1] : text;
  let pkg: LockedPackage;
  try {
    pkg = JSON.parse(jsonText) as LockedPackage;
  } catch {
    throw new Error("This file isn't a valid password-locked document.");
  }
  if (pkg?.app !== PKG_TAG || !pkg.salt || !pkg.iv || !pkg.data) {
    throw new Error("This isn't a Trust Vault password-locked file.");
  }
  const key = await deriveKey(password, fromBase64(pkg.salt), pkg.iterations || PBKDF2_ITERATIONS);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(pkg.iv) as Uint8Array<ArrayBuffer> },
      key,
      fromBase64(pkg.data) as Uint8Array<ArrayBuffer>
    );
  } catch {
    throw new Error("Wrong password, or the file is corrupted.");
  }
  const type = pkg.type || "application/octet-stream";
  return { blob: new Blob([plain], { type }), name: pkg.name || "document", type };
}

/** A standalone HTML page that decrypts its embedded payload in the recipient's
 *  browser. The password is never stored in it — only the ciphertext + UI. */
function buildSelfDecryptingHtml(pkg: LockedPackage): string {
  // Escape "<" so the JSON can't break out of the <script> tag; JSON.parse turns
  // < back into "<". The recipient's name is only ever set via textContent.
  const embedded = JSON.stringify(pkg).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Unlock document</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    background:#020617; color:#e2e8f0; font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif; padding:16px; }
  .card { width:100%; max-width:420px; background:#0f172a; border:1px solid #1e293b; border-radius:16px; padding:28px; box-shadow:0 20px 60px rgba(0,0,0,.5); }
  h1 { font-size:20px; margin:0 0 4px; } h1 span { color:#818cf8; }
  p { font-size:13px; color:#94a3b8; margin:0 0 16px; }
  .name { font-family:ui-monospace,monospace; color:#cbd5e1; word-break:break-all; }
  input { width:100%; box-sizing:border-box; height:40px; background:#1e293b; border:1px solid #334155; border-radius:10px; padding:0 12px; color:#e2e8f0; font-size:14px; outline:none; }
  input:focus { border-color:#6366f1; }
  button { width:100%; margin-top:12px; height:42px; background:#4f46e5; border:0; border-radius:12px; color:#fff; font-size:14px; font-weight:600; cursor:pointer; }
  button:hover { background:#6366f1; } button:disabled { opacity:.5; cursor:default; }
  .msg { font-size:12px; margin-top:12px; min-height:16px; } .err { color:#f87171; } .ok { color:#34d399; }
  .foot { font-size:10px; color:#475569; text-align:center; margin:16px 0 0; }
</style>
</head>
<body>
  <div class="card">
    <h1>Unlock a <span>document</span></h1>
    <p>Enter the password to decrypt <span class="name" id="name"></span>. It's decrypted on your device — nothing is uploaded.</p>
    <input id="pw" type="password" placeholder="Password" autocomplete="off" autofocus>
    <button id="btn">Unlock &amp; Download</button>
    <div class="msg" id="msg"></div>
    <p class="foot">Trust Vault · PBKDF2 + AES-GCM</p>
  </div>
  <script id="gtv-pkg" type="application/json">${embedded}</script>
  <script>
    var pkg = JSON.parse(document.getElementById("gtv-pkg").textContent);
    document.getElementById("name").textContent = pkg.name;
    function b(s){var x=atob(s),a=new Uint8Array(x.length);for(var i=0;i<x.length;i++)a[i]=x.charCodeAt(i);return a;}
    var btn=document.getElementById("btn"), msg=document.getElementById("msg");
    async function unlock(){
      var pw=document.getElementById("pw").value;
      if(!pw){msg.textContent="Enter the password.";msg.className="msg err";return;}
      if(!(window.crypto&&window.crypto.subtle)){msg.textContent="This browser can't decrypt local files. Open the vault link your sender gave you and add /unlock.";msg.className="msg err";return;}
      btn.disabled=true; msg.textContent="Unlocking…"; msg.className="msg";
      try{
        var base=await crypto.subtle.importKey("raw",new TextEncoder().encode(pw),"PBKDF2",false,["deriveKey"]);
        var key=await crypto.subtle.deriveKey({name:"PBKDF2",salt:b(pkg.salt),iterations:pkg.iterations,hash:"SHA-256"},base,{name:"AES-GCM",length:256},false,["decrypt"]);
        var plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:b(pkg.iv)},key,b(pkg.data));
        var url=URL.createObjectURL(new Blob([plain],{type:pkg.type||"application/octet-stream"}));
        var a=document.createElement("a");a.href=url;a.download=pkg.name;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
        msg.textContent="Unlocked. Check your downloads.";msg.className="msg ok";
      }catch(e){ msg.textContent="Wrong password, or the file is corrupted."; msg.className="msg err"; }
      btn.disabled=false;
    }
    btn.addEventListener("click",unlock);
    document.getElementById("pw").addEventListener("keydown",function(e){if(e.key==="Enter")unlock();});
  </script>
</body>
</html>`;
}

// ── Saved passwords (reusable, labeled — e.g. per project) ─────────────────────

export interface SavedPassword {
  id: string;
  label: string;
  password: string;
}

const PW_KEY = "gtv_passwords";

export function loadPasswords(): SavedPassword[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PW_KEY);
    const parsed = raw ? (JSON.parse(raw) as SavedPassword[]) : [];
    return Array.isArray(parsed) ? parsed.filter((p) => p && p.id && p.password) : [];
  } catch {
    return [];
  }
}

function save(list: SavedPassword[]): void {
  try {
    localStorage.setItem(PW_KEY, JSON.stringify(list));
  } catch {
    /* non-critical */
  }
}

export function addPassword(label: string, password: string): SavedPassword {
  const entry: SavedPassword = {
    id: crypto.randomUUID(),
    label: label.trim() || "Untitled",
    password,
  };
  save([entry, ...loadPasswords()]);
  return entry;
}

export function removePassword(id: string): void {
  save(loadPasswords().filter((p) => p.id !== id));
}

/** Remove every saved download password. */
export function clearAllPasswords(): void {
  save([]);
}
