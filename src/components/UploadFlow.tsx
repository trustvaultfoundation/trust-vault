"use client";

import { useCallback, useEffect, useState } from "react";
import FileDropzone from "./FileDropzone";
import {
  DOCUMENT_TYPES,
  DocumentType,
  EncryptedPayload,
  EncryptionStep,
  encryptFile,
  decryptFile,
  formatBytes,
} from "@/lib/crypto";
import {
  uploadToArweave,
  UploadStatus,
  UploadResult,
  getUploadPrice,
} from "@/lib/irys";
import { useWallet } from "@/context/WalletContext";
import {
  StoredUpload,
  saveUpload,
  toBase64,
  loadStoredUploads,
} from "@/lib/vault";
import { loadIdentities } from "@/lib/accessKeys";
import { Spinner } from "@/components/Spinner";
import { ThemedCombo, ThemedAutocomplete } from "@/components/BoardDropdowns";
import { TurboCreditsModal } from "@/components/TurboCreditsModal";
import { getUploadUsd, getFreeUploadLimit } from "@/lib/turboCredits";

// ── Queue types ──────────────────────────────────────────────────────────────

interface QueueEntry {
  id: string;
  file: File;
  docType: DocumentType;
  tags: string[];
  phase:
    | { type: "pending" }
    | { type: "encrypting"; step: EncryptionStep }
    | { type: "uploading"; status: UploadStatus; detail?: string }
    | { type: "done"; payload: EncryptedPayload; result: UploadResult }
    | { type: "error"; message: string; isFundingPending?: boolean };
}

type AppState =
  | { stage: "idle" }
  | { stage: "queue"; entries: QueueEntry[]; running: boolean };

// ── Upload step metadata ─────────────────────────────────────────────────────

const UPLOAD_STEPS: { key: UploadStatus; label: string; warn?: string }[] = [
  { key: "initializing", label: "Connecting to Irys node" },
  { key: "checking-balance", label: "Checking Irys balance" },
  {
    key: "funding",
    label: "Funding Irys wallet",
    warn: "Wander will prompt you to sign the funding transaction",
  },
  {
    key: "awaiting-credit",
    label: "Notifying Irys of pending AR deposit",
    warn: "Irys requires 25+ on-chain confirmations (~30–60 min) before crediting AR. If balance isn't ready yet, you'll see a message to try again later.",
  },
  {
    key: "uploading",
    label: "Uploading encrypted document to Arweave",
    warn: "ArConnect may prompt you to sign the upload",
  },
  { key: "done", label: "Upload confirmed" },
];

const UPLOAD_STEP_ORDER = UPLOAD_STEPS.map((s) => s.key);

// ── Toast system ─────────────────────────────────────────────────────────────

interface ToastItem { id: string; message: string; type: "error" | "info" | "warning" }

function ToastContainer({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-5 right-5 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map(t => (
        <div key={t.id} className={`flex items-start gap-3 rounded-xl px-4 py-3 shadow-xl border text-sm ${
          t.type === "error" ? "bg-red-950/90 border-red-800/50 text-red-300" :
          t.type === "warning" ? "bg-amber-950/90 border-amber-800/50 text-amber-300" :
          "bg-slate-900 border-slate-700 text-slate-300"
        }`}>
          <span className="flex-1 leading-relaxed text-xs">{t.message}</span>
          <button onClick={() => onDismiss(t.id)} className="shrink-0 text-current opacity-60 hover:opacity-100 transition-opacity text-base leading-none">×</button>
        </div>
      ))}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function UploadFlow({ knownTags = [] }: { knownTags?: string[] }) {
  const { address } = useWallet();
  const [appState, setAppState] = useState<AppState>({ stage: "idle" });
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmPrice, setConfirmPrice] = useState<string | null>(null);
  const [confirmUsd, setConfirmUsd] = useState<number | null>(null);
  // Phase 6 — optional recipients to share this batch with.
  const [recipientsInput, setRecipientsInput] = useState("");
  // Authorized identities (from Access Keys) selectable as recipients.
  const [identities, setIdentities] = useState<{ address: string; label: string; publicKey?: string }[]>([]);
  const [selectedIdentities, setSelectedIdentities] = useState<Set<string>>(new Set());

  // Feature 3: pending multi-select state
  const [pendingSelected, setPendingSelected] = useState<Set<string>>(new Set());

  // Tags the user has already used across their vault — offered as suggestions when tagging
  // new files (same searchable dropdown design as the rest of the app). Sourced from the
  // on-chain vault documents (`knownTags`, passed in) so they persist across browsers/devices,
  // unioned with any locally-recorded uploads not yet reflected on-chain.
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  useEffect(() => {
    const set = new Set<string>(knownTags.map((t) => t.trim()).filter(Boolean));
    if (address) for (const u of loadStoredUploads(address)) for (const t of u.tags ?? []) { const v = t.trim(); if (v) set.add(v); }
    setTagSuggestions([...set].sort((a, b) => a.localeCompare(b)));
  }, [address, appState.stage, knownTags]);

  // Turbo credits modal — opened proactively, or from the "needs credits" upload error via a
  // window event (so the deeply-nested ErrorContent doesn't need the callback threaded down).
  const [showCredits, setShowCredits] = useState(false);
  useEffect(() => {
    const open = () => setShowCredits(true);
    window.addEventListener("gtv:add-turbo-credits", open);
    return () => window.removeEventListener("gtv:add-turbo-credits", open);
  }, []);

  // Toast state
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const addToast = useCallback((message: string, type: ToastItem["type"] = "error") => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    setToasts(prev => [...prev.slice(-4), { id, message, type }]); // keep max 5
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 6000);
  }, []);
  const dismissToast = useCallback((id: string) => setToasts(prev => prev.filter(t => t.id !== id)), []);

  // Load authorized identities (from Access Keys) whenever the confirm dialog opens.
  useEffect(() => {
    if (!showConfirm || !address) return;
    setIdentities(
      loadIdentities(address).map((i) => ({ address: i.address, label: i.label, publicKey: i.publicKey }))
    );
  }, [showConfirm, address]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const addFiles = useCallback((files: File[]) => {
    setAppState((prev) => {
      // Collect keys of already-queued entries for deduplication
      const existingKeys = new Set(
        prev.stage === "queue"
          ? prev.entries.map((e) => `${e.file.name}:${e.file.size}`)
          : []
      );
      const newEntries: QueueEntry[] = files
        .filter((f) => !existingKeys.has(`${f.name}:${f.size}`))
        .map((f) => ({
          id: `${f.name}-${Date.now()}-${Math.random()}`,
          file: f,
          docType: "Other" as DocumentType,
          tags: [],
          phase: { type: "pending" } as const,
        }));

      if (newEntries.length === 0) return prev;

      if (prev.stage === "idle") {
        return { stage: "queue", entries: newEntries, running: false };
      }
      return { ...prev, entries: [...prev.entries, ...newEntries] };
    });
  }, []);

  const removeEntry = useCallback((id: string) => {
    setAppState((prev) => {
      if (prev.stage !== "queue") return prev;
      const entries = prev.entries.filter((e) => e.id !== id);
      if (entries.length === 0) return { stage: "idle" };
      return { ...prev, entries };
    });
    // Also remove from pendingSelected if present
    setPendingSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const resetPhase = useCallback((id: string) => {
    setAppState((prev) => {
      if (prev.stage !== "queue") return prev;
      return {
        ...prev,
        entries: prev.entries.map((e) =>
          e.id === id ? { ...e, phase: { type: "pending" } } : e
        ),
      };
    });
  }, []);

  const updateDocType = useCallback((id: string, docType: DocumentType) => {
    setAppState((prev) => {
      if (prev.stage !== "queue") return prev;
      return {
        ...prev,
        entries: prev.entries.map((e) =>
          e.id === id ? { ...e, docType } : e
        ),
      };
    });
  }, []);

  const updateTags = useCallback((id: string, tags: string[]) => {
    setAppState((prev) => {
      if (prev.stage !== "queue") return prev;
      return {
        ...prev,
        entries: prev.entries.map((e) =>
          e.id === id ? { ...e, tags } : e
        ),
      };
    });
  }, []);

  const updatePhase = useCallback(
    (id: string, phase: QueueEntry["phase"]) => {
      setAppState((prev) => {
        if (prev.stage !== "queue") return prev;
        return {
          ...prev,
          entries: prev.entries.map((e) =>
            e.id === id ? { ...e, phase } : e
          ),
        };
      });
    },
    []
  );

  // Feature 3: toggle selection of a pending entry
  const togglePendingSelect = useCallback((id: string) => {
    setPendingSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handlePrepareUpload = useCallback(async () => {
    if (appState.stage !== "queue") return;
    const pendingEntries = appState.entries.filter(
      (e) => e.phase.type === "pending" || e.phase.type === "error"
    );
    setConfirmPrice(null);
    setConfirmUsd(null);
    setShowConfirm(true);
    // Only files ABOVE Turbo's free tier actually cost anything — free-tier files (the common case)
    // must show as Free, not a phantom byte price. Bill just the over-limit files.
    const freeLimit = await getFreeUploadLimit();
    const billableBytes = pendingEntries.reduce((sum, e) => sum + (e.file.size > freeLimit ? e.file.size : 0), 0);
    if (billableBytes === 0) { setConfirmPrice("Free"); setConfirmUsd(0); return; }
    getUploadPrice(billableBytes).then(setConfirmPrice);
    // Same Turbo pricing the top-up uses, so the cost is shown in a currency the user can act on.
    getUploadUsd(billableBytes).then(setConfirmUsd).catch(() => setConfirmUsd(null));
  }, [appState]);

  const processQueue = useCallback(
    async (
      snapshot: { id: string; file: File; docType: DocumentType; tags: string[] }[],
      recipients: string[]
    ) => {
      setAppState((prev) =>
        prev.stage === "queue" ? { ...prev, running: true } : prev
      );

      // Phase A — encrypt every file first (master key is established at most
      // once, then cached). We collect the payloads so we can sign them all in
      // a single wallet approval below.
      const encrypted: {
        id: string;
        tags: string[];
        payload: EncryptedPayload;
      }[] = [];
      for (const { id, file, docType, tags } of snapshot) {
        try {
          updatePhase(id, { type: "encrypting", step: "reading" });
          const payload = await encryptFile(file, docType, (step) => {
            updatePhase(id, { type: "encrypting", step });
          }, recipients);
          payload.customTags = tags; // carried on-chain (Document-Tags) for recipients
          encrypted.push({ id, tags, payload });
        } catch (err: unknown) {
          const message =
            err instanceof Error ? err.message : "Encryption failed. Please retry.";
          updatePhase(id, { type: "error", message });
          addToast(message);
        }
      }

      // Phase B — sign all data items with ONE approval if the wallet supports
      // batchSignDataItem. Falls back to per-file signing (signedBodies stays
      // undefined) when unavailable.
      let signedBodies: (ArrayBuffer | undefined)[] = encrypted.map(() => undefined);
      if (encrypted.length > 1) {
        try {
          const { batchSignDocuments } = await import("@/lib/irys");
          const bodies = await batchSignDocuments(encrypted.map((e) => e.payload));
          if (bodies) signedBodies = bodies;
        } catch (err: any) {
          if (/cancel|reject|denied/i.test(err?.message ?? "")) {
            for (const e of encrypted) {
              updatePhase(e.id, { type: "error", message: "Upload cancelled by user." });
            }
            addToast("Upload cancelled by user.", "warning");
            setAppState((prev) =>
              prev.stage === "queue" ? { ...prev, running: false } : prev
            );
            return;
          }
          // non-cancel → fall back to per-file signing
        }
      }

      // Phase C — upload each (POSTing the pre-signed body when available).
      for (let i = 0; i < encrypted.length; i++) {
        const { id, tags, payload } = encrypted[i];
        try {
          updatePhase(id, {
            type: "uploading",
            status: "initializing",
          });
          const result = await uploadToArweave(payload, (status, detail) => {
            updatePhase(id, { type: "uploading", status, detail });
          }, signedBodies[i]);

          // Export the raw AES key so the vault can decrypt with no wallet
          // popup. Stored both in the durable vault record (rawKeyBase64) and in
          // a standalone cache key. Never uploaded to Arweave.
          let rawKeyBase64: string | undefined;
          if (payload.aesKey) {
            try {
              const rawKey = await crypto.subtle.exportKey("raw", payload.aesKey);
              rawKeyBase64 = toBase64(new Uint8Array(rawKey));
              localStorage.setItem(`gtv_aes_${result.txId}`, rawKeyBase64);
            } catch { /* non-critical */ }
          }

          // Persist to localStorage
          const stored: StoredUpload = {
            txId: result.txId,
            irysGatewayUrl: result.irysGatewayUrl,
            gatewayUrl: result.gatewayUrl,
            originalName: payload.originalName,
            originalType: payload.originalType,
            originalSize: payload.originalSize,
            documentType: payload.documentType,
            uploadedAt: Date.now(),
            ivBase64: toBase64(payload.iv),
            wrappedKeyBase64: toBase64(payload.wrappedKey),
            tags,
            rawKeyBase64,
            keyScheme: payload.keyScheme ?? "master",
            // Exact cost Turbo charged (winc → AR-equivalent); "0" ⇒ free tier.
            costAr: result.costWinc != null ? Number(result.costWinc) / 1e12 : undefined,
          };
          saveUpload(address, stored);
          // Track upload-time recipients so they show under Share immediately.
          if (payload.recipientWraps && payload.recipientWraps.length > 0) {
            const { recordShares } = await import("@/lib/sharing");
            recordShares(result.txId, payload.recipientWraps.map((r) => r.address));
          }
          updatePhase(id, { type: "done", payload, result });
        } catch (err: any) {
          console.error("FULL ERROR OBJECT:", err);
          if (err.isFundingPending) {
            updatePhase(id, {
              type: "error",
              message: err.message,
              isFundingPending: true,
            });
            addToast(err.message, "warning");
            // Break — funding is pending, no point uploading the rest now
            break;
          }
          let errorMsg = "Upload failed. ";
          if (err.response) {
            errorMsg += `Status: ${err.response.status}. Body: ${JSON.stringify(err.response.data || err.response.statusText)}`;
          } else if (err.toJSON) {
            errorMsg += JSON.stringify(err.toJSON());
          } else {
            errorMsg += err.message || String(err);
          }
          updatePhase(id, { type: "error", message: errorMsg });
          addToast(errorMsg);
        }
      }

      setAppState((prev) =>
        prev.stage === "queue" ? { ...prev, running: false } : prev
      );
    },
    [address, updatePhase, addToast]
  );

  const handleConfirmUpload = useCallback(() => {
    setShowConfirm(false);
    if (appState.stage !== "queue") return;
    const snapshot = appState.entries
      .filter((e) => e.phase.type === "pending" || e.phase.type === "error")
      .map((e) => ({ id: e.id, file: e.file, docType: e.docType, tags: e.tags }));
    // Recipients from the free-text field…
    const typed = recipientsInput.split(/[\s,]+/).map((a) => a.trim()).filter(Boolean);
    // …plus the selected authorized identities (prefer their public key so even
    // brand-new wallets work).
    const fromSelected = identities
      .filter((i) => selectedIdentities.has(i.address))
      .map((i) => i.publicKey ?? i.address);
    const recipients = Array.from(new Set([...typed, ...fromSelected]));
    processQueue(snapshot, recipients);
  }, [appState, processQueue, recipientsInput, identities, selectedIdentities]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const pendingOrErrorCount =
    appState.stage === "queue"
      ? appState.entries.filter(
          (e) => e.phase.type === "pending" || e.phase.type === "error"
        ).length
      : 0;

  const totalSizeForConfirm =
    appState.stage === "queue"
      ? appState.entries
          .filter((e) => e.phase.type === "pending" || e.phase.type === "error")
          .reduce((sum, e) => sum + e.file.size, 0)
      : 0;

  return (
    <>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {showCredits && address && <TurboCreditsModal address={address} onClose={() => setShowCredits(false)} onToast={addToast} />}

      {/* Confirmation overlay */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm pt-20">
          <div className="mx-4 w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-6 space-y-4 shadow-2xl">
            <h2 className="text-base font-semibold text-white">
              Upload {pendingOrErrorCount} file{pendingOrErrorCount !== 1 ? "s" : ""}
            </h2>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-slate-400">
                <span>Total size</span>
                <span className="text-slate-200">{formatBytes(totalSizeForConfirm)}</span>
              </div>
              <div className="flex justify-between text-xs text-slate-400">
                <span>Estimated cost</span>
                {confirmPrice === null ? (
                  <Spinner className="h-3.5 w-3.5 text-slate-400" />
                ) : confirmPrice === "Free" ? (
                  <span className="font-medium text-emerald-400">Free</span>
                ) : (
                  <span className="text-slate-200 font-medium">
                    {confirmUsd != null && confirmUsd > 0 && <span className="text-slate-100">≈ ${confirmUsd < 0.01 ? confirmUsd.toFixed(4) : confirmUsd.toFixed(2)}</span>}
                    {confirmUsd != null && confirmUsd > 0 && <span className="text-slate-500"> · </span>}
                    <span className={confirmUsd != null && confirmUsd > 0 ? "text-slate-400" : "text-slate-200"}>{confirmPrice}</span>
                  </span>
                )}
              </div>
              <div className="flex justify-end">
                <button onClick={() => setShowCredits(true)} className="text-[11px] text-indigo-300 hover:text-indigo-200 hover:underline">
                  Add Turbo credits
                </button>
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5">
                Share with (optional)
              </p>

              {identities.length > 0 && (
                <div className="mb-2 max-h-28 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/40 divide-y divide-slate-800">
                  {identities.map((i) => (
                    <label
                      key={i.address}
                      className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer hover:bg-slate-800/40"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIdentities.has(i.address)}
                        onChange={() =>
                          setSelectedIdentities((prev) => {
                            const next = new Set(prev);
                            if (next.has(i.address)) next.delete(i.address);
                            else next.add(i.address);
                            return next;
                          })
                        }
                        className="accent-indigo-500 shrink-0"
                      />
                      <span className="text-xs text-slate-200 truncate">{i.label}</span>
                      <span className="text-[10px] font-mono text-slate-600 ml-auto shrink-0">
                        {i.address.slice(0, 6)}…{i.address.slice(-4)}
                      </span>
                    </label>
                  ))}
                </div>
              )}

              <textarea
                value={recipientsInput}
                onChange={(e) => setRecipientsInput(e.target.value)}
                placeholder="…or paste a wallet address / public key"
                rows={2}
                className="w-full text-xs bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-2 text-slate-300 placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono resize-none"
              />
              <p className="text-[10px] text-slate-600 mt-1 leading-relaxed">
                Pick people you added in Access Keys, or paste an address/public key. Each recipient
                decrypts with their own wallet — you always retain access.
              </p>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              Wander will ask you to sign each upload. Approve to store permanently.
            </p>
            <div className="flex gap-3 justify-end pt-1">
              <button
                onClick={() => setShowConfirm(false)}
                className="text-sm text-slate-400 hover:text-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmUpload}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
              >
                Confirm Upload →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      {appState.stage === "idle" ? (
        <FileDropzone onFiles={addFiles} />
      ) : (
        <QueueView
          entries={appState.entries}
          running={appState.running}
          onFiles={addFiles}
          onRemove={removeEntry}
          onDocType={updateDocType}
          onUpdateTags={updateTags}
          onResetPhase={resetPhase}
          onPrepare={handlePrepareUpload}
          tagSuggestions={tagSuggestions}
          pendingSelected={pendingSelected}
          togglePendingSelect={togglePendingSelect}
          setPendingSelected={setPendingSelected}
          onBulkApply={(docType, tags) => {
            pendingSelected.forEach((id) => {
              updateDocType(id, docType);
              updateTags(id, tags);
            });
            setPendingSelected(new Set());
          }}
        />
      )}
    </>
  );
}

// ── QueueView ────────────────────────────────────────────────────────────────

function QueueView({
  entries,
  running,
  onFiles,
  onRemove,
  onDocType,
  onUpdateTags,
  onResetPhase,
  onPrepare,
  tagSuggestions,
  pendingSelected,
  togglePendingSelect,
  setPendingSelected,
  onBulkApply,
}: {
  entries: QueueEntry[];
  running: boolean;
  onFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  onDocType: (id: string, docType: DocumentType) => void;
  onUpdateTags: (id: string, tags: string[]) => void;
  onResetPhase: (id: string) => void;
  onPrepare: () => void;
  tagSuggestions: string[];
  pendingSelected: Set<string>;
  togglePendingSelect: (id: string) => void;
  setPendingSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
  onBulkApply: (docType: DocumentType, tags: string[]) => void;
}) {
  const hasPendingOrError = entries.some(
    (e) => e.phase.type === "pending" || e.phase.type === "error"
  );

  const pendingIds = entries.filter(e => e.phase.type === "pending").map(e => e.id);
  const allPendingSelected = pendingIds.length > 0 && pendingIds.every(id => pendingSelected.has(id));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">Encrypt &amp; Upload</h2>
      </div>

      {/* Secondary dropzone — normal width */}
      <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 overflow-hidden">
        <FileDropzone onFiles={onFiles} />
      </div>

      {/* Entry rows */}
      <div className="space-y-2">
        {/* Select all pending row */}
        {pendingIds.length > 0 && (
          <div className="flex items-center gap-2 px-1 pb-1 border-b border-slate-800">
            <input
              type="checkbox"
              checked={allPendingSelected}
              onChange={() => {
                if (allPendingSelected) setPendingSelected(new Set());
                else setPendingSelected(new Set(pendingIds));
              }}
              className="accent-indigo-500"
              aria-label="Select all pending"
            />
            <span className="text-xs text-slate-500">
              {allPendingSelected ? "Deselect all" : "Select all"} ({pendingIds.length} pending)
            </span>
          </div>
        )}

        {entries.map((entry) => (
          <EntryCard
            key={entry.id}
            entry={entry}
            running={running}
            onRemove={onRemove}
            onDocType={onDocType}
            onUpdateTags={onUpdateTags}
            onResetPhase={onResetPhase}
            tagSuggestions={tagSuggestions}
            isSelected={pendingSelected.has(entry.id)}
            onToggleSelect={() => togglePendingSelect(entry.id)}
          />
        ))}
      </div>

      {/* Feature 3: Bulk type assignment bar */}
      {pendingSelected.size > 0 && (
        <BulkTypeBar
          selectedCount={pendingSelected.size}
          tagSuggestions={tagSuggestions}
          onApply={(docType, tags) => onBulkApply(docType, tags)}
          onClear={() => setPendingSelected(new Set())}
        />
      )}

      {/* Footer */}
      {hasPendingOrError && (
        <div className="flex items-center justify-end gap-3 pt-1">
          {running && (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="w-3.5 h-3.5 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin shrink-0" />
              Processing…
            </div>
          )}
          <button
            onClick={onPrepare}
            disabled={running}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
          >
            Upload All →
          </button>
        </div>
      )}
    </div>
  );
}

// ── Shared pickers ───────────────────────────────────────────────────────────

// Trigger styling for the themed, searchable category combo (matches the app's other selects).
const CATEGORY_COMBO_CLASS =
  "flex shrink-0 w-44 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-600 focus:border-indigo-500 focus:outline-none";

function CategoryCombo({ value, onChange, className }: { value: DocumentType; onChange: (v: DocumentType) => void; className?: string }) {
  return (
    <ThemedCombo
      value={value}
      options={DOCUMENT_TYPES.map((t) => ({ value: t, label: t }))}
      onChange={(v) => onChange(v as DocumentType)}
      placeholder="Category"
      className={className ?? CATEGORY_COMBO_CLASS}
    />
  );
}

// A tag editor: chips for chosen tags + a themed autocomplete that suggests tags already
// used across the vault (free text is allowed; comma / Enter / picking a suggestion adds).
function TagField({ tags, onChange, suggestions, placeholder = "add tags…", className }: {
  tags: string[];
  onChange: (t: string[]) => void;
  suggestions: string[];
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const parts = raw.split(",").map((t) => t.trim()).filter(Boolean);
    if (parts.length === 0) { setDraft(""); return; }
    const next = [...tags];
    for (const p of parts) if (!next.includes(p)) next.push(p);
    onChange(next);
    setDraft("");
  };
  return (
    <div className={`flex min-h-[32px] flex-wrap items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-1.5 py-1 ${className ?? ""}`}>
      {tags.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-md bg-indigo-600/25 px-1.5 py-0.5 text-[11px] text-indigo-100">
          {t}
          <button type="button" onClick={() => onChange(tags.filter((x) => x !== t))} aria-label={`Remove ${t}`} className="text-indigo-300/80 hover:text-white">
            <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </span>
      ))}
      <div className="relative min-w-[5rem] flex-1">
        <ThemedAutocomplete
          value={draft}
          onChange={setDraft}
          onPick={(v) => add(v)}
          suggestions={suggestions.filter((s) => !tags.includes(s))}
          placeholder={tags.length ? "" : placeholder}
          className="w-full bg-transparent text-xs text-slate-200 placeholder-slate-600 focus:outline-none"
        />
      </div>
    </div>
  );
}

// ── BulkTypeBar ──────────────────────────────────────────────────────────────

function BulkTypeBar({
  selectedCount,
  tagSuggestions,
  onApply,
  onClear,
}: {
  selectedCount: number;
  tagSuggestions: string[];
  onApply: (docType: DocumentType, tags: string[]) => void;
  onClear: () => void;
}) {
  const [bulkType, setBulkType] = useState<DocumentType>("Other");
  const [bulkTags, setBulkTags] = useState<string[]>([]);

  return (
    <div className="flex items-center gap-3 rounded-xl border border-indigo-800/40 bg-indigo-950/20 px-4 py-2.5">
      <span className="text-xs text-slate-300 shrink-0">
        {selectedCount} file{selectedCount !== 1 ? "s" : ""} selected
      </span>
      <CategoryCombo value={bulkType} onChange={setBulkType} />
      <TagField tags={bulkTags} onChange={setBulkTags} suggestions={tagSuggestions} className="min-w-[12rem] flex-1" />
      <button
        onClick={() => onApply(bulkType, bulkTags)}
        className="shrink-0 text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg transition-colors"
      >
        Apply
      </button>
      <button
        onClick={onClear}
        className="shrink-0 text-xs text-slate-500 hover:text-slate-300 transition-colors"
      >
        Clear
      </button>
    </div>
  );
}

// ── EntryCard ────────────────────────────────────────────────────────────────

function EntryCard({
  entry,
  running,
  onRemove,
  onDocType,
  onUpdateTags,
  onResetPhase,
  tagSuggestions,
  isSelected,
  onToggleSelect,
}: {
  entry: QueueEntry;
  running: boolean;
  onRemove: (id: string) => void;
  onDocType: (id: string, docType: DocumentType) => void;
  onUpdateTags: (id: string, tags: string[]) => void;
  onResetPhase: (id: string) => void;
  tagSuggestions: string[];
  isSelected: boolean;
  onToggleSelect: () => void;
}) {
  const { id, file, docType, tags, phase } = entry;
  const canRemove = !running && phase.type === "pending";

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-3">
      {/* Main row */}
      <div className="flex items-center gap-3">
        {/* Feature 3: checkbox for pending entries */}
        {phase.type === "pending" && (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelect}
            className="accent-indigo-500 shrink-0"
            aria-label={`Select ${file.name}`}
          />
        )}

        {/* File icon */}
        <FileIcon type={file.type} />

        {/* Filename + size */}
        <div className="min-w-0 flex-1">
          <p className="text-sm text-white truncate">{file.name}</p>
          <p className="text-xs text-slate-500 mt-0.5">{formatBytes(file.size)}</p>
        </div>

        {/* Document category — searchable themed combo, pending only */}
        {phase.type === "pending" && (
          <CategoryCombo value={docType} onChange={(v) => onDocType(id, v)} className={`${CATEGORY_COMBO_CLASS} w-40`} />
        )}

        {/* Tags — chips + suggestions from tags already used in the vault, pending only */}
        {phase.type === "pending" && (
          <TagField tags={tags} onChange={(t) => onUpdateTags(id, t)} suggestions={tagSuggestions} className="w-52 shrink-0" />
        )}

        {/* Status area */}
        <div className="shrink-0 flex items-center gap-2">
          {phase.type === "encrypting" && (
            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin shrink-0" />
              <span className="text-xs text-slate-400">Encrypting…</span>
            </div>
          )}
          {phase.type === "uploading" && (
            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin shrink-0" />
              <span className="text-xs text-slate-400">
                {UPLOAD_STEPS[UPLOAD_STEP_ORDER.indexOf(phase.status)]?.label ?? phase.status}
              </span>
            </div>
          )}
          {phase.type === "done" && (
            <span className="text-xs text-emerald-400">
              <svg className="w-4 h-4 inline-block mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              {`${phase.result.txId.slice(0, 5)}…${phase.result.txId.slice(-4)}`}
            </span>
          )}
          {phase.type === "error" && (
            <span className="text-xs text-red-400">
              <svg className="w-4 h-4 inline-block mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              {phase.message.slice(0, 40)}{phase.message.length > 40 ? "…" : ""}
            </span>
          )}
        </div>

        {/* Remove button */}
        {canRemove && (
          <button
            onClick={() => onRemove(id)}
            className="shrink-0 text-slate-600 hover:text-red-400 transition-colors px-1"
            aria-label="Remove"
          >
            ×
          </button>
        )}
      </div>

      {/* Second row: done actions */}
      {phase.type === "done" && (
        <DoneContent payload={phase.payload} result={phase.result} />
      )}

      {/* Second row: error actions */}
      {phase.type === "error" && (
        <ErrorContent
          message={phase.message}
          isFundingPending={phase.isFundingPending}
          onRetry={() => onResetPhase(id)}
        />
      )}
    </div>
  );
}

// ── DoneContent ──────────────────────────────────────────────────────────────

function DoneContent({
  payload,
  result,
}: {
  payload: EncryptedPayload;
  result: UploadResult;
}) {
  const [copied, setCopied] = useState(false);
  const [decryptState, setDecryptState] = useState<
    "idle" | "decrypting" | "done" | "error"
  >("idle");
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [decryptError, setDecryptError] = useState<string | null>(null);

  const copyTxId = async () => {
    await navigator.clipboard.writeText(result.txId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const onDecrypt = async () => {
    setDecryptState("decrypting");
    setDecryptError(null);
    try {
      // payload.aesKey is set — no wallet popup needed
      const blob = await decryptFile(payload);
      const url = URL.createObjectURL(blob);
      setBlobUrl(url);
      setDecryptState("done");
      window.open(url, "_blank");
    } catch (err: unknown) {
      setDecryptError(
        err instanceof Error ? err.message : "Decryption failed. Please retry."
      );
      setDecryptState("error");
    }
  };

  const shortTxId = `${result.txId.slice(0, 8)}…${result.txId.slice(-6)}`;
  const viewblockUrl = `https://viewblock.io/arweave/tx/${result.txId}`;

  return (
    <div className="mt-3 space-y-2.5">
      {/* Green "Stored on Arweave" banner */}
      <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-800/40 px-3 py-2">
        <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
        <span className="text-xs font-medium text-emerald-300 flex-1">
          Stored on Arweave
        </span>
        <span className="text-[10px] font-mono text-slate-400">{shortTxId}</span>
        <button
          onClick={copyTxId}
          className="shrink-0 text-[10px] text-slate-500 hover:text-slate-200 transition-colors px-1.5 py-0.5 rounded border border-slate-700 hover:border-slate-500"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>

      {/* Decrypt row */}
      <div className="rounded-lg border border-slate-700 bg-slate-800/40 px-3 py-2.5 space-y-1.5">
        <p className="text-[10px] text-slate-500 uppercase tracking-wide">
          Decrypt &amp; View File
        </p>
        {decryptState === "idle" && (
          <button
            onClick={onDecrypt}
            className="flex items-center gap-2 text-xs font-medium text-emerald-300 border border-emerald-800/50 bg-emerald-500/10 hover:bg-emerald-500/20 px-3 py-1.5 rounded-lg transition-colors"
          >
            Decrypt &amp; View File
          </button>
        )}
        {decryptState === "decrypting" && (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="w-3.5 h-3.5 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin shrink-0" />
            Decrypting…
          </div>
        )}
        {decryptState === "done" && blobUrl && (
          <div className="flex flex-wrap gap-2">
            <a
              href={blobUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-emerald-300 border border-emerald-800/50 bg-emerald-500/10 hover:bg-emerald-500/20 px-3 py-1.5 rounded-lg transition-colors"
            >
              Open original file →
            </a>
            <a
              href={blobUrl}
              download={payload.originalName}
              className="text-xs text-slate-400 border border-slate-700 bg-slate-800/60 hover:bg-slate-700 px-3 py-1.5 rounded-lg transition-colors"
            >
              Download original
            </a>
          </div>
        )}
        {decryptState === "error" && (
          <div className="space-y-1">
            <p className="text-xs text-red-400">{decryptError}</p>
            <button
              onClick={() => setDecryptState("idle")}
              className="text-xs text-slate-500 underline hover:text-slate-300"
            >
              Try again
            </button>
          </div>
        )}
      </div>

      {/* Links */}
      <div className="flex flex-wrap gap-2">
        <a
          href={result.irysGatewayUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-indigo-300 border border-indigo-800/50 bg-indigo-500/10 hover:bg-indigo-500/20 px-2.5 py-1 rounded-lg transition-colors"
        >
          Encrypted File →
        </a>
        <a
          href={viewblockUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-slate-400 border border-slate-700 bg-slate-800/60 hover:bg-slate-700 px-2.5 py-1 rounded-lg transition-colors"
        >
          ViewBlock →
        </a>
        <a
          href={result.gatewayUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-slate-600 border border-slate-800 bg-slate-900/60 hover:text-slate-400 px-2.5 py-1 rounded-lg transition-colors"
        >
          Arweave →
        </a>
      </div>
    </div>
  );
}

// ── ErrorContent ─────────────────────────────────────────────────────────────

function ErrorContent({
  message,
  isFundingPending,
  onRetry,
}: {
  message: string;
  isFundingPending?: boolean;
  onRetry: () => void;
}) {
  if (isFundingPending) {
    return (
      <div className="mt-3 rounded-lg border border-amber-800/50 bg-amber-950/20 px-3 py-2.5 space-y-2">
        <div className="flex items-start gap-2">
          <span className="text-amber-400 text-sm shrink-0">⏳</span>
          <div>
            <p className="text-xs font-semibold text-amber-300 mb-0.5">
              Funding Submitted — Waiting for Confirmation
            </p>
            <p className="text-xs text-amber-200/80 leading-relaxed">{message}</p>
          </div>
        </div>
        <button
          onClick={onRetry}
          className="text-xs text-amber-400 border border-amber-800/50 hover:bg-amber-900/30 px-3 py-1 rounded-lg transition-colors"
        >
          Try Upload Again
        </button>
      </div>
    );
  }

  // A file that exceeded Turbo's free tier: surface a direct "Add credits" action.
  const needsCredits = /turbo credits/i.test(message);
  return (
    <div className="mt-3 rounded-lg border border-red-800/50 bg-red-950/20 px-3 py-2.5 space-y-2">
      <p className="text-xs text-red-400 leading-relaxed">{message}</p>
      <div className="flex flex-wrap items-center gap-2">
        {needsCredits && (
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("gtv:add-turbo-credits"))}
            className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1 rounded-lg transition-colors"
          >
            Add Turbo credits
          </button>
        )}
        <button
          onClick={onRetry}
          className="text-xs text-slate-400 border border-slate-700 hover:bg-slate-800 px-3 py-1 rounded-lg transition-colors"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

// ── Shared small components ──────────────────────────────────────────────────

function FileIcon({ type }: { type: string }) {
  const label = type.includes("pdf")
    ? "PDF"
    : type.includes("word") || type.includes("document")
    ? "DOC"
    : type.includes("png")
    ? "PNG"
    : type.includes("jpeg") || type.includes("jpg")
    ? "JPG"
    : "FILE";
  return (
    <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0">
      <span className="text-[10px] font-bold text-slate-400">{label}</span>
    </div>
  );
}

function DocTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    Will: "bg-amber-500/15 text-amber-300 border-amber-800/40",
    Deed: "bg-sky-500/15 text-sky-300 border-sky-800/40",
    Trust: "bg-violet-500/15 text-violet-300 border-violet-800/40",
    "Power of Attorney": "bg-rose-500/15 text-rose-300 border-rose-800/40",
    Other: "bg-slate-700 text-slate-300 border-slate-600",
  };
  const cls = colors[type] ?? colors["Other"];
  return (
    <span
      className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full border ${cls}`}
    >
      {type}
    </span>
  );
}
