"use client";

import { useEffect, useState } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { WhiteboardEditor } from "./WhiteboardEditor";

// React node-view: an Excalidraw whiteboard embedded inline in a document, so you
// can read text and see the scheme together. The scene JSON lives in the node's
// `scene` attribute (serialized into the doc HTML as data-scene).
//
// Excalidraw registers its keyboard/clipboard listeners on `document`, so events
// MUST be allowed to bubble up there — we deliberately do NOT stopPropagation on
// copy/cut/paste/key events here (doing so broke copy inside the canvas). Instead
// the node view's `stopEvent: () => true` tells ProseMirror to ignore those events
// without blocking DOM propagation. The node is also non-draggable so the browser's
// native drag can't preempt Excalidraw's pointer interactions (drawing/moving).
function WhiteboardNodeView({ node, updateAttributes, deleteNode, editor }: NodeViewProps) {
  const scene = (node.attrs.scene as string) || "";
  // The node view doesn't re-render when the editor flips editable (`setEditable`
  // doesn't change the node), so track it ourselves — this is what actually switches
  // Excalidraw between view and edit mode. `setEditable` emits "update"; the setState
  // bails out when the value is unchanged, so frequent updates don't re-render us.
  const [isEditable, setIsEditable] = useState(editor.isEditable);
  useEffect(() => {
    const sync = () => setIsEditable(editor.isEditable);
    editor.on("update", sync);
    editor.on("transaction", sync);
    return () => { editor.off("update", sync); editor.off("transaction", sync); };
  }, [editor]);
  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <div className="relative">
        {isEditable && (
          <button
            onClick={() => deleteNode()}
            title="Remove whiteboard"
            className="absolute right-2 top-2 z-20 flex h-6 w-6 items-center justify-center rounded-md border border-slate-700 bg-slate-900/80 text-slate-300 hover:text-red-400"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        )}
        <WhiteboardEditor value={scene} onChange={(json) => updateAttributes({ scene: json })} readOnly={!isEditable} />
      </div>
    </NodeViewWrapper>
  );
}

export const Whiteboard = Node.create({
  name: "whiteboard",
  group: "block",
  atom: true,
  draggable: false,
  selectable: false,
  addAttributes() {
    return {
      scene: {
        default: "",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-scene") || "",
        renderHTML: (attrs) => (attrs.scene ? { "data-scene": attrs.scene as string } : {}),
      },
    };
  },
  parseHTML() { return [{ tag: "div[data-whiteboard]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes({ "data-whiteboard": "" }, HTMLAttributes)]; },
  addNodeView() { return ReactNodeViewRenderer(WhiteboardNodeView, { stopEvent: () => true }); },
});
