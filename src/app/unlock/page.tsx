"use client";

import { useState } from "react";
import { unlockPackage } from "@/lib/passwordLock";
import PasswordInput from "@/components/PasswordInput";

/**
 * Public, wallet-free page for opening a password-protected document
 * (.gtvlock.json) that a Trust Vault owner downloaded and sent. Everything is
 * decrypted locally in the browser — nothing is uploaded, no account needed.
 * This is the recipient side of Vault → "Download with password".
 */
export default function UnlockPage() {
  const [fileText, setFileText] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const onFile = async (f: File | undefined) => {
    setError("");
    setDone("");
    if (!f) return;
    setFileName(f.name);
    setFileText(await f.text());
  };

  const unlock = async () => {
    setError("");
    setDone("");
    if (!fileText) { setError("Choose the .gtvlock.json file first."); return; }
    if (!password) { setError("Enter the password."); return; }
    setBusy(true);
    try {
      const { blob, name } = await unlockPackage(fileText, password);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      setDone(`Unlocked “${name}”. Check your downloads.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not unlock the file.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-slate-950">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 space-y-5 shadow-2xl">
        <div>
          <h1 className="text-xl font-bold text-white">
            Unlock a <span className="text-indigo-400">document</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Open a password-protected file someone shared with you. Tip: you can usually just double-click the <span className="font-mono text-slate-300">.html</span> file to unlock it — this page is a fallback. Nothing is uploaded; it all happens in your browser.
          </p>
        </div>

        <label className="block cursor-pointer rounded-xl border border-dashed border-slate-700 bg-slate-950/40 hover:border-indigo-600 px-4 py-6 text-center transition-colors">
          <input
            type="file"
            accept=".html,.json,text/html,application/json"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <span className="text-sm text-slate-300 break-all">{fileName || "Choose the locked file"}</span>
          <span className="block text-[11px] text-slate-600 mt-1">the .html file your sender gave you</span>
        </label>

        <PasswordInput value={password} onChange={setPassword} placeholder="Password" />

        {error && <p className="text-xs text-red-400">{error}</p>}
        {done && <p className="text-xs text-emerald-400">{done}</p>}

        <button
          onClick={unlock}
          disabled={busy}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors"
        >
          {busy ? "Unlocking…" : "Unlock & Download"}
        </button>

        <p className="text-[10px] text-slate-600 text-center">
          Trust Vault · decrypted locally with PBKDF2 + AES-GCM
        </p>
      </div>
    </main>
  );
}
