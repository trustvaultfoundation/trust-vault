"use client";

import { useEffect, useMemo, useState } from "react";
import type { StoredUpload } from "@/lib/vault";
import {
  isValidArweaveAddress,
  loadIdentities,
  saveIdentities,
  generatePasswordWrapper,
  loadInheritance,
  saveInheritance,
  generateReleasePackage,
  type AuthorizedIdentity,
  type InheritanceConfig,
} from "@/lib/accessKeys";
import { fetchPublicKey, looksLikePublicKey, addressFromPublicKey } from "@/lib/recipients";
import { HelpTip } from "./HelpTip";
import PasswordInput from "./PasswordInput";
import { DateInput } from "./DateInput";

type Toast = (message: string, type?: "error" | "info" | "warning") => void;

export default function AccessKeysView({
  address,
  uploads,
  onToast,
}: {
  address: string;
  uploads: StoredUpload[];
  onToast: Toast;
}) {
  return (
    <div className="flex flex-col gap-6 pr-1">
      <div className="shrink-0">
        <h2 className="text-lg font-semibold text-white">Access Keys</h2>
        <p className="text-xs text-slate-500 mt-0.5 max-w-xl">
          Your cryptographic control center — decide who can unlock your vault, share access with
          people who don&apos;t have a wallet, and arrange inheritance.
        </p>
      </div>

      <MultiPartySection address={address} onToast={onToast} />
      <PasswordSection uploads={uploads} onToast={onToast} />
      <InheritanceSection address={address} uploads={uploads} onToast={onToast} />
    </div>
  );
}

// ── Section 1: Multi-party encryption ─────────────────────────────────────────

function MultiPartySection({ address, onToast }: { address: string; onToast: Toast }) {
  const [identities, setIdentities] = useState<AuthorizedIdentity[]>([]);
  const [addr, setAddr] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [editAddr, setEditAddr] = useState<string | null>(null); // row whose name is being edited
  const [editLabel, setEditLabel] = useState("");

  useEffect(() => {
    setIdentities(loadIdentities(address));
  }, [address]);

  const add = async () => {
    const input = addr.trim();
    setBusy(true);
    try {
      // The input may be a 43-char address (key fetched on-chain) or a pasted
      // public key (works for brand-new wallets, no transaction needed).
      let resolvedAddress: string;
      let pubKey: string | null;
      if (looksLikePublicKey(input)) {
        pubKey = input;
        resolvedAddress = await addressFromPublicKey(input);
      } else if (isValidArweaveAddress(input)) {
        resolvedAddress = input;
        pubKey = await fetchPublicKey(input);
      } else {
        onToast("Paste a valid wallet address or a public key.", "warning");
        return;
      }

      if (identities.some((i) => i.address === resolvedAddress)) {
        onToast("That identity is already authorized.", "warning");
        return;
      }

      const next: AuthorizedIdentity[] = [
        {
          address: resolvedAddress,
          label: label.trim() || "Unnamed",
          hasPublicKey: !!pubKey,
          publicKey: pubKey ?? undefined,
          addedAt: Date.now(),
        },
        ...identities,
      ];
      setIdentities(next);
      saveIdentities(address, next);
      setAddr("");
      setLabel("");
      onToast(
        pubKey ? "Identity authorized — you can select them when uploading." : "Added.",
        pubKey ? "info" : "warning"
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = (a: string) => {
    const next = identities.filter((i) => i.address !== a);
    setIdentities(next);
    saveIdentities(address, next);
  };

  const startEdit = (i: AuthorizedIdentity) => { setEditAddr(i.address); setEditLabel(i.label === "Unnamed" ? "" : i.label); };
  const saveEdit = () => {
    if (!editAddr) return;
    const next = identities.map((i) => (i.address === editAddr ? { ...i, label: editLabel.trim() || i.label } : i));
    setIdentities(next);
    saveIdentities(address, next);
    setEditAddr(null);
  };

  return (
    <Section
      title="Multi-Party Encryption"
      help="Each authorized person can independently decrypt documents you share with them, using their own wallet — no shared password. You add them by their wallet address or public key; we then encrypt a copy of the document key just for them."
      subtitle="Ask a family member or attorney for their wallet address and paste it here — we fetch their public key automatically. Once added, you can select them when uploading. (They can find their address and public key under “View a Document”.)"
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          placeholder="Paste their wallet address or public key"
          className="h-9 flex-1 min-w-[220px] text-sm bg-slate-800 border border-slate-700 rounded-lg px-3 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
        />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (e.g. Attorney)"
          className="h-9 w-40 text-sm bg-slate-800 border border-slate-700 rounded-lg px-3 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
        />
        <button
          onClick={add}
          disabled={busy}
          className="h-9 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold px-4 rounded-lg transition-colors"
        >
          {busy ? "Adding…" : "Add"}
        </button>
      </div>

      {identities.length === 0 ? (
        <p className="text-xs text-slate-600">No authorized identities yet.</p>
      ) : (
        <div className="rounded-lg border border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-500 text-[10px] uppercase tracking-wide">
              <tr>
                <th className="text-left px-3 py-2">Identity</th>
                <th className="text-left px-3 py-2">Address</th>
                <th className="text-left px-3 py-2">Public Key</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {identities.map((i) => (
                <tr key={i.address} className="border-t border-slate-800">
                  <td className="px-3 py-2 text-slate-200">
                    {editAddr === i.address ? (
                      <input
                        autoFocus
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); else if (e.key === "Escape") setEditAddr(null); }}
                        placeholder="Name"
                        className="w-40 rounded-md border border-indigo-500 bg-slate-800 px-2 py-1 text-sm text-slate-100 focus:outline-none"
                      />
                    ) : (
                      i.label
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-400">
                    {i.address.slice(0, 8)}…{i.address.slice(-6)}
                  </td>
                  <td className="px-3 py-2">
                    {i.hasPublicKey && i.publicKey ? (
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(i.publicKey!);
                          onToast("Public key copied.", "info");
                        }}
                        className="group/tip relative text-[10px] text-emerald-400 border border-emerald-800/50 bg-emerald-500/10 hover:bg-emerald-500/20 px-1.5 py-0.5 rounded transition-colors"
                      >
                        found · copy
                        <span className="pointer-events-none absolute top-full mt-2 left-0 w-60 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 shadow-xl opacity-0 group-hover/tip:opacity-100 transition-opacity z-[60]">
                          <span className="block text-[10px] font-mono break-all text-slate-300">
                            {i.publicKey.slice(0, 96)}…
                          </span>
                          <span className="block text-[10px] text-slate-500 mt-1">Click to copy the full key</span>
                        </span>
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <span className="text-[10px] text-amber-400 border border-amber-800/50 bg-amber-500/10 px-1.5 py-0.5 rounded">
                          no key
                        </span>
                        <HelpTip text="This wallet hasn't made any Arweave transaction, so its public key isn't on-chain yet. Ask them to open “View a Document”, copy their access key (public key), and paste it here — then you can share with them." />
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {editAddr === i.address ? (
                      <span className="inline-flex items-center gap-2">
                        <button onClick={saveEdit} className="text-xs font-medium text-indigo-300 hover:text-indigo-200 transition-colors">Save</button>
                        <button onClick={() => setEditAddr(null)} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">Cancel</button>
                      </span>
                    ) : (
                      <span className="inline-flex items-center justify-end gap-3">
                        <button onClick={() => startEdit(i)} title="Edit name" aria-label="Edit name" className="text-slate-500 hover:text-indigo-300 transition-colors">
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>
                        </button>
                        <button onClick={() => remove(i.address)} className="text-xs text-slate-600 hover:text-red-400 transition-colors">Remove</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// ── Section 2: Password & secret-sharing ──────────────────────────────────────

function PasswordSection({ uploads, onToast }: { uploads: StoredUpload[]; onToast: Toast }) {
  const shareable = useMemo(() => uploads.filter((u) => u.rawKeyBase64), [uploads]);
  const [txId, setTxId] = useState("");
  const [password, setPassword] = useState("");
  const [wrapper, setWrapper] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!txId && shareable.length > 0) setTxId(shareable[0].txId);
  }, [shareable, txId]);

  const generate = async () => {
    const doc = shareable.find((u) => u.txId === txId);
    if (!doc || !doc.rawKeyBase64) {
      onToast("Pick a document you uploaded on this browser.", "warning");
      return;
    }
    if (password.length < 8) {
      onToast("Use a password of at least 8 characters.", "warning");
      return;
    }
    setBusy(true);
    try {
      const w = await generatePasswordWrapper(password, doc.rawKeyBase64, {
        txId: doc.txId,
        originalName: doc.originalName,
        originalType: doc.originalType,
      });
      setWrapper(JSON.stringify(w, null, 2));
      onToast("Shareable key generated.", "info");
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Could not generate the key.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!wrapper) return;
    await navigator.clipboard.writeText(wrapper);
    onToast("Copied access key wrapper.", "info");
  };

  return (
    <Section
      title="Password & Secret-Sharing Access"
      help="For recipients who don't have an Arweave wallet at all (an executor, an elderly relative). The document's key is wrapped with a password you choose (PBKDF2). They decrypt with just that password plus the wrapper text — no wallet needed. Send the password separately from the wrapper."
      subtitle="Generate a password-protected key for a recipient without a wallet. Share the wrapper below by email alongside the vault link."
    >
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={txId}
          onChange={(e) => setTxId(e.target.value)}
          className="h-9 text-sm bg-slate-800 border border-slate-700 rounded-lg px-2 text-slate-300 focus:outline-none focus:border-indigo-500 max-w-[220px]"
        >
          {shareable.length === 0 && <option value="">No shareable documents</option>}
          {shareable.map((u) => (
            <option key={u.txId} value={u.txId}>
              {u.originalName}
            </option>
          ))}
        </select>
        <PasswordInput
          value={password}
          onChange={setPassword}
          placeholder="Custom password"
          className="flex-1 min-w-[160px]"
        />
        <button
          onClick={generate}
          disabled={busy || shareable.length === 0}
          className="h-9 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold px-4 rounded-lg transition-colors"
        >
          {busy ? "Generating…" : "Generate Shareable Key"}
        </button>
      </div>

      {wrapper && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-wide text-slate-500">Access key wrapper</p>
            <button
              onClick={copy}
              className="text-xs text-indigo-300 border border-indigo-800/50 bg-indigo-500/10 hover:bg-indigo-500/20 px-2.5 py-1 rounded-lg transition-colors"
            >
              Copy
            </button>
          </div>
          <textarea
            readOnly
            value={wrapper}
            rows={8}
            className="w-full text-[11px] font-mono bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-300 resize-none"
          />
          <p className="text-[10px] text-slate-600">
            The wrapper contains no plaintext — only the document key encrypted with the password.
            The recipient needs both this wrapper and the password to decrypt.
          </p>
        </div>
      )}
    </Section>
  );
}

// ── Section 3: Inheritance triggers ───────────────────────────────────────────

function InheritanceSection({
  address,
  uploads,
  onToast,
}: {
  address: string;
  uploads: StoredUpload[];
  onToast: Toast;
}) {
  const [cfg, setCfg] = useState<InheritanceConfig>(() => loadInheritance(null));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCfg(loadInheritance(address));
  }, [address]);

  const update = (patch: Partial<InheritanceConfig>) => setCfg((c) => ({ ...c, ...patch }));

  const validate = (): boolean => {
    if (!cfg.beneficiary.trim()) {
      onToast("Add a beneficiary (the estate or family wallet).", "warning");
      return false;
    }
    if (cfg.timeLockEnabled && !cfg.unlockDate) {
      onToast("Pick an unlock date for the time-lock trigger.", "warning");
      return false;
    }
    if (cfg.multiSigEnabled && !isValidArweaveAddress(cfg.approverAddress)) {
      onToast("Enter a valid approver address for the multi-signature trigger.", "warning");
      return false;
    }
    return true;
  };

  const save = () => {
    if (!validate()) return;
    saveInheritance(address, cfg);
    onToast("Inheritance settings saved.", "info");
  };

  const generate = async () => {
    if (!validate()) return;
    const docs = uploads
      .filter((u) => u.rawKeyBase64)
      .map((u) => ({ txId: u.txId, originalName: u.originalName, rawKeyB64: u.rawKeyBase64! }));
    if (docs.length === 0) {
      onToast("No documents with a local key to include. Upload one on this browser first.", "warning");
      return;
    }
    setBusy(true);
    try {
      saveInheritance(address, cfg);
      const pkg = await generateReleasePackage(docs, cfg);
      const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `trust-vault-estate-release-${address.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      onToast(`Estate release package generated for ${docs.length} document${docs.length !== 1 ? "s" : ""}.`, "info");
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Could not generate the release package.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Inheritance Triggers"
      help="A “dead man's switch” for your estate. Name a beneficiary, then generate a release package that wraps your document keys for them so they can decrypt with their own wallet. The multi-signature trigger splits each key 2-of-2 with your attorney (both are required). The time-lock date travels as honored metadata. Give the package to your executor to release per your instructions; fully automated on-chain release is a future enhancement."
      subtitle="Name who inherits access and how it's released, then generate a portable release package for your executor."
    >
      <div>
        <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5">Beneficiary</p>
        <input
          value={cfg.beneficiary}
          onChange={(e) => update({ beneficiary: e.target.value })}
          placeholder="Estate / family wallet address or public key"
          className="h-9 w-full max-w-md text-sm bg-slate-800 border border-slate-700 rounded-lg px-3 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
        />
      </div>

      <ToggleRow
        label="Time-Lock Trigger"
        hint="Release access after a chosen date."
        checked={cfg.timeLockEnabled}
        onChange={(v) => update({ timeLockEnabled: v })}
      />
      {cfg.timeLockEnabled && (
        <DateInput
          value={cfg.unlockDate}
          onChange={(v) => update({ unlockDate: v })}
          className="h-9 text-sm bg-slate-800 border border-slate-700 rounded-lg px-3 text-slate-200 focus:outline-none focus:border-indigo-500"
        />
      )}

      <ToggleRow
        label="Multi-Signature Trigger"
        hint="Require a second wallet (e.g. your attorney) to approve release."
        checked={cfg.multiSigEnabled}
        onChange={(v) => update({ multiSigEnabled: v })}
      />
      {cfg.multiSigEnabled && (
        <input
          value={cfg.approverAddress}
          onChange={(e) => update({ approverAddress: e.target.value })}
          placeholder="Approver address or public key"
          className="h-9 w-full max-w-md text-sm bg-slate-800 border border-slate-700 rounded-lg px-3 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
        />
      )}

      <div className="flex gap-3 pt-1">
        <button
          onClick={save}
          className="bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
        >
          Save settings
        </button>
        <button
          onClick={generate}
          disabled={busy}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
        >
          {busy ? "Generating…" : "Generate Release Package"}
        </button>
      </div>
    </Section>
  );
}

// ── Shared layout ─────────────────────────────────────────────────────────────

function Section({
  title,
  subtitle,
  help,
  children,
}: {
  title: string;
  subtitle: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 space-y-4 shrink-0">
      <div>
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          {help && <HelpTip text={help} />}
        </div>
        <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm text-slate-200">{label}</p>
        <p className="text-[11px] text-slate-500">{hint}</p>
      </div>
      <Switch checked={checked} onChange={onChange} />
    </div>
  );
}

export function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
        checked ? "bg-indigo-600" : "bg-slate-700"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}
