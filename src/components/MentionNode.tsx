"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactRenderer, ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import Suggestion, { type SuggestionProps, type SuggestionKeyDownProps } from "@tiptap/suggestion";
import type { MentionPerson } from "@/lib/mentions";
import { showUserCard } from "@/lib/profileNav";
import { placePopover } from "@/lib/popover";

// An @mention for the rich-text editor: a Tiptap inline atom that stores the person's
// stable id (wallet address) + a label, renders as a styled "@Name" pill, and survives
// in the saved HTML. Typing "@" opens a member picker (via @tiptap/suggestion) rendered
// as a portalled popover positioned at the caret. Only people you can already mention
// (your address book + the passed-in members) appear — it widens no access.

export interface MentionOptions {
  items: (query: string) => MentionPerson[];
}

const PILL = "inline-flex items-center rounded px-1 align-baseline text-[0.92em] font-medium ring-1 select-none bg-violet-500/15 text-violet-200 ring-violet-500/30 cursor-pointer hover:bg-violet-500/25";

function MentionView({ node }: NodeViewProps) {
  const id = (node.attrs.id as string) || "";
  const label = (node.attrs.label as string) || id || "someone";
  const onClick = (e: React.MouseEvent) => {
    if (!id) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    showUserCard({ address: id, label, rect: { top: r.top, left: r.left, bottom: r.bottom } });
  };
  return (
    <NodeViewWrapper as="span" className="inline align-baseline" contentEditable={false}>
      <span className={PILL} onClick={onClick}>@{label}</span>
    </NodeViewWrapper>
  );
}

type ListRef = { onKeyDown: (p: SuggestionKeyDownProps) => boolean };

const MentionList = forwardRef<ListRef, SuggestionProps<MentionPerson>>(function MentionList(props, ref) {
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [props.items]);

  const pick = (i: number) => { const p = props.items[i]; if (p) props.command({ id: p.id, label: p.label } as unknown as MentionPerson); };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowDown") { setActive((a) => (a + 1) % Math.max(props.items.length, 1)); return true; }
      if (event.key === "ArrowUp") { setActive((a) => (a - 1 + props.items.length) % Math.max(props.items.length, 1)); return true; }
      if (event.key === "Enter" || event.key === "Tab") { pick(active); return true; }
      return false;
    },
  }));

  if (props.items.length === 0) return <div className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-[11px] text-slate-500 shadow-2xl">No people to mention</div>;
  return (
    <div className="max-h-56 w-56 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-1 shadow-2xl">
      {props.items.map((p, i) => (
        <button key={p.id} type="button" onMouseDown={(e) => { e.preventDefault(); pick(i); }} onMouseEnter={() => setActive(i)}
          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${i === active ? "bg-slate-800" : "hover:bg-slate-800/60"}`}>
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-[10px] font-semibold text-violet-200">{(p.label[0] || "@").toUpperCase()}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{p.label}</span>
        </button>
      ))}
    </div>
  );
});

// Place the popover next to the caret, flipping above / clamping fully into the viewport.
function place(el: HTMLElement, rect: DOMRect | null) {
  if (!rect) return;
  const { top, left } = placePopover(rect, 224, el.offsetHeight || 220);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

export const Mention = Node.create<MentionOptions>({
  name: "mention",
  inline: true,
  group: "inline",
  atom: true,
  selectable: false,
  addOptions() {
    return { items: () => [] };
  },
  addAttributes() {
    return {
      id: { default: "", parseHTML: (el) => (el as HTMLElement).getAttribute("data-mention") || "", renderHTML: (a) => (a.id ? { "data-mention": a.id as string } : {}) },
      label: { default: "", parseHTML: (el) => (el as HTMLElement).getAttribute("data-label") || ((el as HTMLElement).textContent || "").replace(/^@/, ""), renderHTML: (a) => (a.label ? { "data-label": a.label as string } : {}) },
    };
  },
  parseHTML() { return [{ tag: "span[data-mention]" }]; },
  renderHTML({ HTMLAttributes, node }) {
    return ["span", mergeAttributes({ class: PILL }, HTMLAttributes), `@${(node.attrs.label as string) || (node.attrs.id as string) || ""}`];
  },
  renderText({ node }) { return `@${(node.attrs.label as string) || (node.attrs.id as string) || ""}`; },
  addNodeView() { return ReactNodeViewRenderer(MentionView); },
  addProseMirrorPlugins() {
    const options = this.options;
    return [
      Suggestion<MentionPerson>({
        editor: this.editor,
        char: "@",
        allowSpaces: false,
        startOfLine: false,
        items: ({ query }) => options.items(query),
        command: ({ editor, range, props }) => {
          editor.chain().focus().insertContentAt(range, [
            { type: "mention", attrs: { id: props.id, label: props.label } },
            { type: "text", text: " " },
          ]).run();
        },
        render: () => {
          let renderer: ReactRenderer<ListRef, SuggestionProps<MentionPerson>> | null = null;
          let el: HTMLDivElement | null = null;
          return {
            onStart: (props) => {
              renderer = new ReactRenderer(MentionList, { props, editor: props.editor });
              el = document.createElement("div");
              el.style.position = "fixed";
              el.style.zIndex = "300";
              el.appendChild(renderer.element);
              document.body.appendChild(el);
              place(el, props.clientRect?.() ?? null);
            },
            onUpdate: (props) => {
              renderer?.updateProps(props);
              if (el) place(el, props.clientRect?.() ?? null);
            },
            onKeyDown: (props) => {
              if (props.event.key === "Escape") { el?.remove(); return true; }
              return renderer?.ref?.onKeyDown(props) ?? false;
            },
            onExit: () => { el?.remove(); el = null; renderer?.destroy(); renderer = null; },
          };
        },
      }),
    ];
  },
});
