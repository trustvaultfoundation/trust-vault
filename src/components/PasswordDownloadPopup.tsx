"use client";

import { useEffect, useState } from "react";
import type { StoredUpload } from "@/lib/vault";
import { loadPasswords, addPassword, isPdf, type SavedPassword } from "@/lib/passwordLock";
import PasswordInput from "./PasswordInput";

type Toast = (message: string, type?: "error" | "info" | "warning") => void;

/** Split a filename into base + extension so the base can ellipsize on one line
 *  while the extension stays visible (e.g. "longname….pdf"). */
function splitName(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (dot > 0 && /^\.[A-Za-z0-9]{1,8}$/.test(name.slice(dot))) {
    return { base: name.slice(0, dot), ext: name.slice(dot) };
  }
  return { base: name, ext: "" };
}

/**
 * Middle step before a password-protected download: pick a saved password (from
 * Settings) or enter a new one (optionally saving it). On confirm it hands the
 * chosen password to the caller, which decrypts + re-encrypts + downloads.
 */
export default function PasswordDownloadPopup({
  docs,
  onClose,
  onConfirm,
  onToast,
}: {
  docs: StoredUpload[];
  onClose: () => void;
  onConfirm: (password: string) => Promise<void> | void;
  onToast: Toast;
}) {
  const [saved, setSaved] = useState<SavedPassword[]>([]);
  const [mode, setMode] = useState<"saved" | "new">("new");
  const [selectedId, setSelectedId] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [savePw, setSavePw] = useState(true);
  const [busy, setBusy] = useState(false);

  const allPdf = docs.length > 0 && docs.every((d) => isPdf(d.originalName, d.originalType));
  const anyPdf = docs.some((d) => isPdf(d.originalName, d.originalType));

  useEffect(() => {
    const list = loadPasswords();
    setSaved(list);
    if (list.length > 0) {
      setMode("saved");
      setSelectedId(list[0].id);
    }
  }, []);

  const submit = async () => {
    let password = "";
    if (mode === "saved") {
      const p = saved.find((s) => s.id === selectedId);
      if (!p) { onToast("Pick a saved password, or choose a new one.", "warning"); return; }
      password = p.password;
    } else {
      if (newPassword.length < 8) { onToast("Use a password of at least 8 characters.", "warning"); return; }
      password = newPassword;
      if (savePw) addPassword(newLabel, newPassword);
    }
    setBusy(true);
    try {
      await onConfirm(password);
      onClose();
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Could not create the download.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm pt-20" onClick={onClose}>
      <div
        className="mx-4 w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 space-y-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-white">Download with password</h3>
          {docs.length === 1 ? (
            // Keep the filename to one line, ellipsizing the middle/end but always
            // showing the extension.
            <div className="flex items-center text-xs text-slate-500 mt-0.5">
              <span className="truncate min-w-0">{splitName(docs[0].originalName).base}</span>
              <span className="shrink-0">{splitName(docs[0].originalName).ext}</span>
            </div>
          ) : (
            <p className="text-xs text-slate-500 mt-0.5">{docs.length} documents</p>
          )}
          <p className="text-[11px] text-slate-500 mt-0.5">
            {allPdf
              ? "Saves a password-protected PDF that opens with the password in any reader."
              : anyPdf
              ? "PDFs become password-protected PDFs; other files a self-unlocking page."
              : "Creates a portable encrypted copy anyone can open with the password."}
          </p>
        </div>

        {saved.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase tracking-wide text-slate-500">Use a saved password</p>
            <div className="max-h-36 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/40 divide-y divide-slate-800">
              {saved.map((p) => (
                <label key={p.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-800/40">
                  <input
                    type="radio"
                    name="pw"
                    checked={mode === "saved" && selectedId === p.id}
                    onChange={() => { setMode("saved"); setSelectedId(p.id); }}
                    className="accent-indigo-500 shrink-0"
                  />
                  <span className="text-sm text-slate-200 truncate">{p.label}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="pw"
              checked={mode === "new"}
              onChange={() => setMode("new")}
              className="accent-indigo-500 shrink-0"
            />
            <span className="text-[10px] uppercase tracking-wide text-slate-500">Use a new password</span>
          </label>
          {mode === "new" && (
            <div className="space-y-2 pl-6">
              <input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Label (e.g. Estate 2026)"
                className="h-9 w-full text-sm bg-slate-800 border border-slate-700 rounded-lg px-3 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />
              <PasswordInput value={newPassword} onChange={setNewPassword} placeholder="Password (min 8 characters)" autoFocus />
              <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                <input type="checkbox" checked={savePw} onChange={(e) => setSavePw(e.target.checked)} className="accent-indigo-500" />
                Save this password to Settings for reuse
              </label>
            </div>
          )}
        </div>

        <p className="text-[10px] text-slate-600 leading-relaxed">
          {allPdf
            ? "The PDF asks for this password when opened — in Preview, Acrobat, or a browser. No wallet, no app."
            : "PDFs open with the password in any reader; other files download as a self-unlocking page. No wallet, no app."}{" "}
          Send the password separately from the file.
        </p>

        <div className="flex justify-end gap-3 pt-1">
          <button onClick={onClose} className="text-sm text-slate-400 hover:text-slate-200 transition-colors">Cancel</button>
          <button
            onClick={submit}
            disabled={busy}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
          >
            {busy ? "Encrypting…" : "Download"}
          </button>
        </div>
      </div>
    </div>
  );
}
