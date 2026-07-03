"use client";

import { useEffect, useState } from "react";
import type { StoredUpload } from "@/lib/vault";
import { loadIdentities, type AuthorizedIdentity } from "@/lib/accessKeys";
import {
  shareDocuments,
  fetchDocumentRecipients,
  revokeShare,
  type ShareableDoc,
} from "@/lib/sharing";

type Toast = (message: string, type?: "error" | "info" | "warning") => void;

export default function SharePopup({
  owner,
  docs,
  onClose,
  onToast,
}: {
  owner: string;
  /** The owned documents to share (must include rawKeyBase64 + ivBase64). */
  docs: StoredUpload[];
  onClose: () => void;
  onToast: Toast;
}) {
  const [identities, setIdentities] = useState<AuthorizedIdentity[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [currentShares, setCurrentShares] = useState<string[]>([]);
  const [loadingShares, setLoadingShares] = useState(false);
  const [revoking, setRevoking] = useState<Set<string>>(new Set());

  useEffect(() => {
    setIdentities(loadIdentities(owner));
  }, [owner]);

  const shareable = docs.filter((d) => d.rawKeyBase64 && d.ivBase64);
  const single = shareable.length === 1 ? shareable[0] : null;

  // For a single document, load who it's already shared with (on-chain + local).
  useEffect(() => {
    if (!single) { setCurrentShares([]); return; }
    let active = true;
    setLoadingShares(true);
    fetchDocumentRecipients(single.txId, owner).then((list) => {
      if (active) { setCurrentShares(list); setLoadingShares(false); }
    });
    return () => { active = false; };
  }, [single]);

  const idLabel = (addr: string) => identities.find((i) => i.address === addr)?.label;

  const submit = async () => {
    const tokens = [
      ...identities.filter((i) => selected.has(i.address)).map((i) => i.publicKey ?? i.address),
      ...manual.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean),
    ];
    if (tokens.length === 0) { onToast("Pick at least one recipient.", "warning"); return; }
    if (shareable.length === 0) {
      onToast("These documents can only be shared from the browser that uploaded them.", "warning");
      return;
    }
    setBusy(true);
    try {
      const docInputs: ShareableDoc[] = shareable.map((d) => ({
        txId: d.txId,
        rawKeyBase64: d.rawKeyBase64!,
        ivBase64: d.ivBase64,
        originalName: d.originalName,
        originalType: d.originalType,
        originalSize: d.originalSize,
        documentType: d.documentType,
        tags: d.tags,
      }));
      const { sharedWith, missing } = await shareDocuments(docInputs, tokens);
      if (sharedWith.length > 0) {
        onToast(
          `Shared ${shareable.length} document${shareable.length !== 1 ? "s" : ""} with ${sharedWith.length} recipient${sharedWith.length !== 1 ? "s" : ""}. It appears in their vault in a few minutes (on-chain confirmation).`,
          "info"
        );
      }
      if (missing.length > 0) {
        onToast(`No public key found for: ${missing.join(", ")}.`, "warning");
      }
      onClose();
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Could not share.");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (addr: string) => {
    if (!single || revoking.has(addr)) return;
    setRevoking((p) => new Set(p).add(addr));
    try {
      await revokeShare(single.txId, addr);
      setCurrentShares((prev) => prev.filter((a) => a !== addr));
      onToast("Access revoked. It takes a few minutes to confirm on-chain before it disappears from their vault.", "info");
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Could not revoke access.");
    } finally {
      setRevoking((p) => { const n = new Set(p); n.delete(addr); return n; });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm pt-20" onClick={onClose}>
      <div
        className="mx-4 w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 space-y-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="text-base font-semibold text-white">
            Share {shareable.length > 1 ? `${shareable.length} documents` : "document"}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {single ? single.originalName : `${shareable.length} selected`}
            {docs.length !== shareable.length && (
              <span className="text-amber-400"> · {docs.length - shareable.length} not shareable from this browser</span>
            )}
          </p>
        </div>

        {identities.length > 0 ? (
          <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/40 divide-y divide-slate-800">
            {identities.map((i) => (
              <label key={i.address} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-800/40">
                <input
                  type="checkbox"
                  checked={selected.has(i.address)}
                  onChange={() =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(i.address)) next.delete(i.address);
                      else next.add(i.address);
                      return next;
                    })
                  }
                  className="accent-indigo-500 shrink-0"
                />
                <span className="text-sm text-slate-200 truncate">{i.label}</span>
                <span className="text-[10px] font-mono text-slate-600 ml-auto shrink-0">
                  {i.address.slice(0, 6)}…{i.address.slice(-4)}
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-600">
            No saved identities — add people in Access Keys, or paste a recipient below.
          </p>
        )}

        <div>
          <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5">Or paste recipient</p>
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="Wallet address or public key"
            className="h-9 w-full text-sm bg-slate-800 border border-slate-700 rounded-lg px-3 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
          />
        </div>

        {single && (
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5">
              Already shared with{loadingShares ? " …" : ` (${currentShares.length})`}
            </p>
            {currentShares.length === 0 ? (
              <p className="text-[11px] text-slate-600">
                {loadingShares ? "Checking on-chain…" : "Not shared with anyone yet."}
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {currentShares.map((a) => (
                  <span key={a} className="flex items-center gap-1 text-[10px] bg-slate-800 border border-slate-700 text-slate-300 px-1.5 py-0.5 rounded">
                    {idLabel(a) ? (
                      <span className="text-slate-200">{idLabel(a)}</span>
                    ) : (
                      <span className="font-mono">{a.slice(0, 6)}…{a.slice(-4)}</span>
                    )}
                    <button
                      onClick={() => revoke(a)}
                      disabled={revoking.has(a)}
                      title="Revoke access — removes this document from their vault"
                      className="text-slate-500 hover:text-red-400 disabled:opacity-40"
                    >
                      {revoking.has(a) ? "…" : "×"}
                    </button>
                  </span>
                ))}
              </div>
            )}
            <p className="text-[10px] text-slate-600 mt-1.5 leading-relaxed">
              Revoking publishes an on-chain notice (one wallet signature) that removes the document from their vault and blocks future access. It takes a few minutes to confirm on-chain. Arweave is permanent, so a copy they already downloaded can&apos;t be recalled.
            </p>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-1">
          <button onClick={onClose} className="text-sm text-slate-400 hover:text-slate-200 transition-colors">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
          >
            {busy ? "Sharing…" : "Share"}
          </button>
        </div>
      </div>
    </div>
  );
}
