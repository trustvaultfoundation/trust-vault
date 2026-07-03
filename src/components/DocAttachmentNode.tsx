"use client";

import { useEffect, useState } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { fetchAndDecryptByTxId } from "@/lib/viewer";
import { formatBytes } from "@/lib/crypto";
import { Loading } from "@/components/Spinner";

// An inline file embed in a document: a chip (name / size / open) with an OPTIONAL
// preview the reader can toggle. The file itself stays encrypted on Arweave — only
// its metadata (txId/name/type/size) lives in the doc HTML; the preview decrypts on
// demand using the cached per-doc key (gtv_aes_<txId>), like board attachments.
function DocAttachmentView({ node, updateAttributes, deleteNode, editor }: NodeViewProps) {
  const txId = (node.attrs.txId as string) || "";
  const name = (node.attrs.name as string) || "File";
  const type = (node.attrs.type as string) || "";
  const size = (node.attrs.size as number) || 0;

  // Local toggle (works in view mode too); persisted to the node when editing.
  const [show, setShow] = useState<boolean>(!!node.attrs.preview);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [opening, setOpening] = useState(false);

  // The node view doesn't re-render on setEditable, so track editability ourselves.
  const [isEditable, setIsEditable] = useState(editor.isEditable);
  useEffect(() => {
    const sync = () => setIsEditable(editor.isEditable);
    editor.on("update", sync);
    editor.on("transaction", sync);
    return () => { editor.off("update", sync); editor.off("transaction", sync); };
  }, [editor]);

  const decrypt = async () => {
    const raw = (typeof window !== "undefined" && localStorage.getItem(`gtv_aes_${txId}`)) || undefined;
    return fetchAndDecryptByTxId(txId, raw ? { rawKeyB64: raw } : undefined);
  };

  // Fetch + decrypt only while the preview is open; revoke the object URL on close.
  useEffect(() => {
    if (!show || !txId) return;
    let dead = false; let obj = "";
    setLoading(true); setError(""); setUrl("");
    decrypt()
      .then((doc) => { if (dead) return; obj = URL.createObjectURL(doc.blob); setUrl(obj); })
      .catch((e) => { if (!dead) setError(e instanceof Error ? e.message : "Couldn't load the file."); })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; if (obj) URL.revokeObjectURL(obj); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, txId]);

  const toggle = () => { const next = !show; setShow(next); if (isEditable) updateAttributes({ preview: next }); };
  const open = async () => {
    setOpening(true); setError("");
    try { const doc = await decrypt(); const u = URL.createObjectURL(doc.blob); window.open(u, "_blank"); setTimeout(() => URL.revokeObjectURL(u), 60_000); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't open the file."); }
    finally { setOpening(false); }
  };

  const isImg = type.startsWith("image/");
  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <div className="overflow-hidden rounded-lg border border-slate-700 bg-slate-800/50">
        <div className="flex items-center gap-2.5 px-3 py-2">
          <svg className="h-4 w-4 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            {isImg ? (<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9" r="1.5" /><path strokeLinecap="round" strokeLinejoin="round" d="M21 16l-5-5L5 20" /></>)
                   : (<><path strokeLinecap="round" strokeLinejoin="round" d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" /><path strokeLinecap="round" strokeLinejoin="round" d="M14 3v5h5" /></>)}
          </svg>
          <button onClick={open} disabled={opening} title={`Open ${name}`} className="min-w-0 flex-1 truncate text-left text-sm text-slate-100 hover:text-indigo-300 hover:underline disabled:opacity-60">{opening ? "opening…" : name}</button>
          {size > 0 && <span className="shrink-0 text-[10px] text-slate-500">{formatBytes(size)}</span>}
          <button onClick={toggle} title={show ? "Hide preview" : "Show preview"} className={`shrink-0 rounded p-1 transition-colors ${show ? "text-indigo-300" : "text-slate-500 hover:text-slate-300"}`}>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {show ? <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.4 5.2A9.6 9.6 0 0112 5c6.5 0 10 7 10 7a13.2 13.2 0 01-2.2 2.9M6.2 6.2A13.3 13.3 0 002 12s3.5 7 10 7a9.5 9.5 0 004-.9" />
                    : <><path strokeLinecap="round" strokeLinejoin="round" d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></>}
            </svg>
          </button>
          <button onClick={open} title="Open in new tab" className="shrink-0 rounded p-1 text-slate-500 hover:text-slate-300">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M14 5h5v5M19 5l-8 8M19 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h6" /></svg>
          </button>
          {isEditable && (
            <button onClick={() => deleteNode()} title="Remove" className="shrink-0 rounded p-1 text-slate-500 hover:text-red-400">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          )}
        </div>
        {show && (
          <div className="border-t border-slate-700 bg-slate-900/50 p-2">
            {loading ? (
              <Loading label="Loading preview…" className="py-6" spinner="h-4 w-4 text-indigo-400" />
            ) : error ? (
              <p className="py-4 text-center text-xs text-red-400">{error}</p>
            ) : url ? (
              isImg ? (
                <img src={url} alt={name} className="mx-auto max-h-[28rem] rounded" />
              ) : type === "application/pdf" ? (
                <iframe src={url} title={name} className="h-[28rem] w-full rounded bg-white" />
              ) : type.startsWith("text/") ? (
                <iframe src={url} title={name} className="h-64 w-full rounded bg-slate-950" />
              ) : (
                <p className="py-4 text-center text-xs text-slate-500">No inline preview for this file type — use Open.</p>
              )
            ) : null}
          </div>
        )}
        {!show && error && <p className="px-3 pb-2 text-[11px] text-red-400">{error}</p>}
      </div>
    </NodeViewWrapper>
  );
}

export const DocAttachment = Node.create({
  name: "docAttachment",
  group: "block",
  atom: true,
  draggable: false,
  selectable: false,
  addAttributes() {
    return {
      txId: { default: "", parseHTML: (el) => (el as HTMLElement).getAttribute("data-tx-id") || "", renderHTML: (a) => (a.txId ? { "data-tx-id": a.txId as string } : {}) },
      name: { default: "", parseHTML: (el) => (el as HTMLElement).getAttribute("data-name") || "", renderHTML: (a) => (a.name ? { "data-name": a.name as string } : {}) },
      type: { default: "", parseHTML: (el) => (el as HTMLElement).getAttribute("data-type") || "", renderHTML: (a) => (a.type ? { "data-type": a.type as string } : {}) },
      size: { default: 0, parseHTML: (el) => Number((el as HTMLElement).getAttribute("data-size")) || 0, renderHTML: (a) => (a.size ? { "data-size": String(a.size) } : {}) },
      preview: { default: false, parseHTML: (el) => (el as HTMLElement).getAttribute("data-preview") === "true", renderHTML: (a) => ({ "data-preview": a.preview ? "true" : "false" }) },
    };
  },
  parseHTML() { return [{ tag: "div[data-doc-attachment]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes({ "data-doc-attachment": "" }, HTMLAttributes)]; },
  addNodeView() { return ReactNodeViewRenderer(DocAttachmentView); },
});
