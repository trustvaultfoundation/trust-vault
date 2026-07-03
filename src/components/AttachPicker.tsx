"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { StoredUpload, loadStoredUploads, fetchSharedDocuments } from "@/lib/vault";
import { DOCUMENT_TYPES, type DocumentType, formatBytes } from "@/lib/crypto";
import { uploadDocument } from "@/lib/upload";
import { ThemedCombo } from "./BoardDropdowns";
import { Loading } from "@/components/Spinner";

type Toast = (m: string, t?: "error" | "info" | "warning") => void;

// Attach files to a ticket: upload a new encrypted document, or browse/filter the
// wallet's existing vault uploads and pick one or more.
export function AttachPicker({
  address,
  existing,
  onClose,
  onAttach,
  onToast,
}: {
  address: string;
  existing: string[];
  onClose: () => void;
  onAttach: (docs: StoredUpload[]) => void | Promise<void>;
  onToast: Toast;
}) {
  const [tab, setTab] = useState<"browse" | "upload">("browse");
  const [busy, setBusy] = useState(false);
  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div onMouseDown={(e) => e.stopPropagation()} className="relative flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <span className="text-sm font-medium text-slate-200">Attach files</span>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200"><svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>
        <div className="flex gap-1 border-b border-slate-800 px-3 pt-2">
          {(["browse", "upload"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-t-lg px-3 py-1.5 text-xs font-medium ${tab === t ? "bg-slate-800 text-slate-100" : "text-slate-500 hover:text-slate-300"}`}>
              {t === "browse" ? "Browse vault" : "Upload new"}
            </button>
          ))}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {tab === "browse" ? (
            <BrowseTab address={address} existing={existing} busy={busy} onClose={onClose} onAttach={async (d) => { setBusy(true); try { await onAttach(d); onClose(); } finally { setBusy(false); } }} />
          ) : (
            <UploadTab address={address} onToast={onToast} busy={busy} setBusy={setBusy} onClose={onClose} onAttach={async (d) => { await onAttach(d); onClose(); }} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function BrowseTab({ address, existing, busy, onAttach }: { address: string; existing: string[]; busy: boolean; onClose: () => void; onAttach: (docs: StoredUpload[]) => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [shared, setShared] = useState<StoredUpload[]>([]);
  const [loadingShared, setLoadingShared] = useState(true);

  // Owned uploads load instantly; documents shared WITH this wallet are fetched
  // from Arweave and merged in (so they can be attached too).
  useEffect(() => {
    let alive = true;
    setLoadingShared(true);
    fetchSharedDocuments(address)
      .then((docs) => { if (alive) setShared(docs); })
      .catch(() => {})
      .finally(() => { if (alive) setLoadingShared(false); });
    return () => { alive = false; };
  }, [address]);

  const uploads = useMemo(() => {
    const map = new Map<string, StoredUpload>();
    for (const u of [...loadStoredUploads(address), ...shared]) if (!map.has(u.txId)) map.set(u.txId, u);
    return [...map.values()].filter((u) => !existing.includes(u.txId));
  }, [address, shared, existing]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return uploads;
    return uploads.filter((u) => u.originalName.toLowerCase().includes(q) || u.documentType.toLowerCase().includes(q) || (u.tags ?? []).some((t) => t.toLowerCase().includes(q)));
  }, [uploads, query]);
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="space-y-3">
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, tag or type…" className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none" />
      <div className="max-h-80 space-y-1 overflow-y-auto">
        {filtered.length === 0 && !loadingShared && <p className="py-6 text-center text-xs text-slate-600">{uploads.length === 0 ? "No vault documents yet." : "No matches."}</p>}
        {filtered.map((u) => (
          <label key={u.txId} className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-800 bg-slate-800/40 px-2.5 py-2 hover:border-slate-700">
            <input type="checkbox" checked={picked.has(u.txId)} onChange={() => toggle(u.txId)} className="accent-indigo-500" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-slate-200">{u.originalName}</p>
              <p className="truncate text-[10px] text-slate-500">{u.documentType}{u.originalSize ? ` · ${formatBytes(u.originalSize)}` : ""}{u.tags?.length ? ` · ${u.tags.join(", ")}` : ""}</p>
            </div>
            {!u.rawKeyBase64 && <span className="shrink-0 text-[9px] text-amber-500" title="Shared with you — can be attached but not re-shared to other board members">shared</span>}
          </label>
        ))}
        {loadingShared && <Loading label="Loading documents shared with you…" className="py-2" spinner="h-4 w-4 text-indigo-400" />}
      </div>
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-[11px] text-slate-500">{picked.size} selected</span>
        <button
          disabled={picked.size === 0 || busy}
          onClick={() => onAttach(uploads.filter((u) => picked.has(u.txId)))}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? "Attaching…" : `Attach ${picked.size || ""}`.trim()}
        </button>
      </div>
    </div>
  );
}

function UploadTab({ address, onToast, busy, setBusy, onAttach }: { address: string; onToast: Toast; busy: boolean; setBusy: (b: boolean) => void; onClose: () => void; onAttach: (docs: StoredUpload[]) => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<DocumentType>(DOCUMENT_TYPES[DOCUMENT_TYPES.length - 1] as DocumentType);
  const [status, setStatus] = useState("");

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setStatus("Encrypting…");
    try {
      const doc = await uploadDocument(file, docType, address, (s) => setStatus(s));
      onToast("File uploaded & attached.", "info");
      await onAttach([doc]);
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Upload failed.", "error");
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  return (
    <div className="space-y-3">
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-700 bg-slate-800/40 px-4 py-8 text-center hover:border-indigo-500">
        <svg className="h-7 w-7 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></svg>
        <span className="text-xs text-slate-300">{file ? file.name : "Choose a file to encrypt & attach"}</span>
        <input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <div>
        <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">Document type</label>
        <ThemedCombo value={docType} options={DOCUMENT_TYPES.map((dt) => ({ value: dt, label: dt }))} onChange={(v) => setDocType(v as DocumentType)} placeholder="Category" />
      </div>
      <div className="flex items-center gap-2">
        {status && <span className="text-[11px] text-slate-500">{status}</span>}
        <button disabled={!file || busy} onClick={upload} className="ml-auto rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50">{busy ? "Uploading…" : "Upload & attach"}</button>
      </div>
      <p className="text-[10px] text-slate-600">Encrypted in your browser and stored in your vault — the same as the Uploads tab. On a shared board it’s also shared with members so they can open it.</p>
    </div>
  );
}
