"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Image } from "@tiptap/extension-image";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import { OrderedList } from "@tiptap/extension-list";
import { Whiteboard } from "./WhiteboardNode";
import { DocAttachment } from "./DocAttachmentNode";
import { AttachPicker } from "./AttachPicker";
import { RefChip, RefPicker } from "./RefChipNode";
import { Mention } from "./MentionNode";
import { mentionPeople, filterPeople, type MentionPerson } from "@/lib/mentions";

type Toast = (m: string, t?: "error" | "info" | "warning") => void;

// Ordered list that remembers its marker style (1 / a / A / i) as the HTML `type`.
const TypedOrderedList = OrderedList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      listType: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute("type"), renderHTML: (a: { listType?: string }) => (a.listType ? { type: a.listType } : {}) },
    };
  },
});

// WYSIWYG editor (Tiptap): formatting, links, images, tables; `allowWhiteboard`
// adds an inline Excalidraw scheme block; `bare` drops the box border (docs).
export function RichTextEditor({
  value,
  onChange,
  placeholder,
  compact,
  bare,
  allowWhiteboard,
  allowAttachments,
  allowRefs,
  refBoardId,
  address,
  onToast,
  onOpenTicket,
  onOpenEvent,
  onOpenItsm,
  editable = true,
  mentions,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  compact?: boolean;
  bare?: boolean;
  allowWhiteboard?: boolean;
  allowAttachments?: boolean;
  allowRefs?: boolean;
  refBoardId?: string;
  address?: string;
  onToast?: Toast;
  onOpenTicket?: (boardId: string, ticketId: string) => void;
  onOpenEvent?: (eventId: string) => void;
  onOpenItsm?: (recordId: string) => void;
  editable?: boolean;
  /** Extra people (board/chat members) to offer for @mentions on top of the address book. */
  mentions?: MentionPerson[];
}) {
  // @mention source — the address book plus any contextual members. Kept in a ref so the
  // suggestion (created once with the editor) always sees the latest list.
  const people = useMemo(() => mentionPeople(address ?? null, mentions ?? []), [address, mentions]);
  const peopleRef = useRef(people);
  peopleRef.current = people;
  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit.configure({
        orderedList: false,
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        link: { openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"], HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" } },
      }),
      TypedOrderedList,
      Image.configure({ allowBase64: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      ...(allowWhiteboard ? [Whiteboard] : []),
      ...(allowAttachments ? [DocAttachment] : []),
      ...(allowRefs ? [RefChip.configure({ address: address ?? null, onOpenTicket, onOpenEvent, onOpenItsm })] : []),
      ...(address ? [Mention.configure({ items: (q: string) => filterPeople(peopleRef.current, q) })] : []),
    ],
    content: value || "",
    editorProps: {
      attributes: {
        class: `gtv-rte ${bare ? "min-h-[55vh]" : compact ? "min-h-[3rem]" : "min-h-[6rem]"} w-full px-2.5 py-2 text-sm text-slate-100 focus:outline-none`,
        "data-placeholder": placeholder ?? "",
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // Keep the editor's editable flag in sync when the prop flips (view ↔ edit).
  useEffect(() => { editor?.setEditable(editable); }, [editor, editable]);

  return (
    <div className={bare ? "" : "rounded-lg border border-slate-700 bg-slate-800 focus-within:border-indigo-500"}>
      {editable && <Toolbar editor={editor} bare={bare} allowWhiteboard={allowWhiteboard} allowAttachments={allowAttachments} allowRefs={allowRefs} refBoardId={refBoardId} address={address} onToast={onToast} />}
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({ editor, bare, allowWhiteboard, allowAttachments, allowRefs, refBoardId, address, onToast }: { editor: Editor | null; bare?: boolean; allowWhiteboard?: boolean; allowAttachments?: boolean; allowRefs?: boolean; refBoardId?: string; address?: string; onToast?: Toast }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [refOpen, setRefOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const linkBoxRef = useRef<HTMLDivElement>(null);
  // Re-render the toolbar on every editor transaction so context-sensitive controls
  // stay in sync with the cursor — in particular the table options, which must
  // revert to the insert squares the moment the selection leaves a table. (useEditor
  // alone doesn't re-render on selection-only changes.)
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!editor) return;
    const update = () => force();
    editor.on("transaction", update);
    return () => { editor.off("transaction", update); };
  }, [editor]);
  // Close the themed link popover on an outside click.
  useEffect(() => {
    if (!linkOpen) return;
    const h = (e: MouseEvent) => { if (linkBoxRef.current && !linkBoxRef.current.contains(e.target as Node)) setLinkOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [linkOpen]);
  if (!editor) return <div className="h-8 border-b border-slate-700/60" />;
  const openLink = () => { setLinkValue((editor.getAttributes("link").href as string) || ""); setLinkOpen(true); };
  const applyLink = () => {
    const u0 = linkValue.trim();
    if (u0 === "") { editor.chain().focus().unsetLink().run(); setLinkOpen(false); return; }
    let u = u0;
    if (!/^(https?:|mailto:)/i.test(u)) u = `https://${u.replace(/^\/+/, "")}`;
    editor.chain().focus().extendMarkRange("link").setLink({ href: u }).run();
    setLinkOpen(false);
  };
  const removeLink = () => { editor.chain().focus().unsetLink().run(); setLinkOpen(false); };
  const onImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) { const r = new FileReader(); r.onload = () => editor.chain().focus().setImage({ src: r.result as string }).run(); r.readAsDataURL(f); }
    e.target.value = "";
  };
  return (
    <div className={`flex flex-wrap items-center gap-0.5 border-b border-slate-700/60 px-1 py-1 ${bare ? "sticky top-0 z-10 bg-slate-900/90 backdrop-blur" : ""}`}>
      <TBtn active={false} onClick={() => editor.chain().focus().undo().run()} title="Undo">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9l6-6M3 9h12a6 6 0 010 12h-3" /></svg>
      </TBtn>
      <TBtn active={false} onClick={() => editor.chain().focus().redo().run()} title="Redo">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 15l6-6-6-6M21 9H9a6 6 0 000 12h3" /></svg>
      </TBtn>
      <span className="mx-0.5 h-4 w-px bg-slate-700" />
      <HeadingMenu editor={editor} />
      <TBtn active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold"><span className="text-[11px] font-bold">B</span></TBtn>
      <TBtn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic"><span className="text-[11px] italic">I</span></TBtn>
      <TBtn active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough"><span className="text-[11px] line-through">S</span></TBtn>
      <span className="mx-0.5 h-4 w-px bg-slate-700" />
      <TBtn active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="1" fill="currentColor" /><circle cx="4" cy="12" r="1" fill="currentColor" /><circle cx="4" cy="18" r="1" fill="currentColor" /></svg>
      </TBtn>
      <TBtn active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M10 6h11M10 12h11M10 18h11" /><path strokeWidth={1.7} d="M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" /></svg>
      </TBtn>
      <TBtn active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Quote"><span className="text-sm leading-none">&ldquo;</span></TBtn>
      <TBtn active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()} title="Inline code"><span className="text-[11px] font-mono">{"</>"}</span></TBtn>
      <span className="mx-0.5 h-4 w-px bg-slate-700" />
      <div ref={linkBoxRef} className="relative">
        <TBtn active={editor.isActive("link") || linkOpen} onClick={() => (linkOpen ? setLinkOpen(false) : openLink())} title="Link">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.5 1.5M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.5-1.5" /></svg>
        </TBtn>
        {linkOpen && (
          <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-lg border border-slate-700 bg-slate-900 p-2 shadow-2xl">
            <input autoFocus value={linkValue} onChange={(e) => setLinkValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyLink(); } else if (e.key === "Escape") { e.preventDefault(); setLinkOpen(false); } }} placeholder="https://… or mailto:…" className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none" />
            <div className="mt-1.5 flex items-center justify-between gap-2">
              {editor.isActive("link") ? <button type="button" onClick={removeLink} className="rounded px-2 py-1 text-[11px] text-rose-300 hover:bg-rose-500/10">Remove</button> : <span />}
              <div className="flex gap-1.5">
                <button type="button" onClick={() => setLinkOpen(false)} className="rounded px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200">Cancel</button>
                <button type="button" onClick={applyLink} className="rounded-md bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-indigo-500">Apply</button>
              </div>
            </div>
          </div>
        )}
      </div>
      <TBtn active={false} onClick={() => fileRef.current?.click()} title="Insert image">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9" r="1.5" /><path strokeLinecap="round" strokeLinejoin="round" d="M21 16l-5-5L5 20" /></svg>
      </TBtn>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onImage} />
      <TableMenu editor={editor} />
      {allowRefs && address && (
        <div className="relative">
          <TBtn active={refOpen} onClick={() => setRefOpen((v) => !v)} title="Link a board ticket or calendar event">
            <span className="flex items-center">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.6 3.6h7.2l9.6 9.6-7.2 7.2-9.6-9.6z" /><circle cx="7.6" cy="7.6" r="1.2" /></svg>
              <svg className="-ml-0.5 h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M12 6v12M6 12h12" /></svg>
            </span>
          </TBtn>
          {refOpen && (
            <RefPicker
              address={address}
              boardId={refBoardId}
              onClose={() => setRefOpen(false)}
              onInsert={(ref) => {
                editor.chain().focus().insertContent({ type: "refChip", attrs: { token: ref.token, kind: ref.kind, label: ref.label } }).insertContent(" ").run();
                setRefOpen(false);
              }}
            />
          )}
        </div>
      )}
      {allowAttachments && address && (
        <TBtn active={false} onClick={() => setAttachOpen(true)} title="Attach document (vault or upload)">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21.44 11.05l-9.19 9.19a5 5 0 01-7.07-7.07l9.19-9.19a3 3 0 014.24 4.24l-9.2 9.19a1 1 0 01-1.41-1.41l8.49-8.49" /></svg>
        </TBtn>
      )}
      {allowWhiteboard && (
        <TBtn active={false} onClick={() => editor.chain().focus().insertContent({ type: "whiteboard", attrs: { scene: "" } }).run()} title="Insert whiteboard (scheme)">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="5" width="8" height="6" rx="1" /><rect x="14" y="9" width="7" height="8" rx="1" /><path strokeLinecap="round" d="M11 8h3" /></svg>
        </TBtn>
      )}
      {attachOpen && address && (
        <AttachPicker
          address={address}
          existing={[]}
          onClose={() => setAttachOpen(false)}
          onAttach={(docs) => { docs.forEach((d) => editor.chain().focus().insertContent({ type: "docAttachment", attrs: { txId: d.txId, name: d.originalName, type: d.originalType, size: d.originalSize ?? 0, preview: false } }).run()); }}
          onToast={onToast ?? (() => {})}
        />
      )}
    </div>
  );
}

// Text-style dropdown: Normal (paragraph) + Heading 1–6.
function HeadingMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, open, () => setOpen(false));
  const levels = [1, 2, 3, 4, 5, 6] as const;
  const cur = levels.find((l) => editor.isActive("heading", { level: l }));
  const apply = (l: number) => { const c = editor.chain().focus(); if (l === 0) c.setParagraph().run(); else c.setHeading({ level: l as 1 | 2 | 3 | 4 | 5 | 6 }).run(); setOpen(false); };
  const sizes: Record<number, string> = { 1: "text-lg", 2: "text-base", 3: "text-sm", 4: "text-xs", 5: "text-[11px]", 6: "text-[10px]" };
  return (
    <div ref={ref} className="relative">
      <TBtn active={!!cur} onClick={() => setOpen((v) => !v)} title="Text style">
        <span className="flex items-center gap-0.5">
          <span className="text-[11px] font-bold">{cur ? `H${cur}` : "¶"}</span>
          <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M6 9l6 6 6-6" /></svg>
        </span>
      </TBtn>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-40 rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-2xl">
          <button onMouseDown={(e) => { e.preventDefault(); apply(0); }} className={`flex w-full items-center justify-between px-2.5 py-1.5 text-left text-sm hover:bg-slate-800 ${!cur ? "text-indigo-300" : "text-slate-200"}`}>Normal<span className="text-[10px] text-slate-500">¶</span></button>
          {levels.map((l) => (
            <button key={l} onMouseDown={(e) => { e.preventDefault(); apply(l); }} className={`flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-slate-800 ${cur === l ? "text-indigo-300" : "text-slate-200"}`}>
              <span className={`${sizes[l]} font-semibold leading-none`}>Heading {l}</span><span className="text-[10px] text-slate-500">H{l}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Table control. When the cursor is in a table the edit options appear AUTOMATICALLY
// inline, to the right of the (highlighted) table icon — no click, no dropdown — so
// they read as part of the toolbar's table options. The +/- sits to the LEFT of a
// column and ABOVE a row. When NOT in a table the icon opens a size-grid picker to
// insert one (the only place a click/popover remains).
function TableMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState({ r: 0, c: 0 });
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, open, () => setOpen(false));
  const N = 8;

  if (editor.isActive("table")) {
    return (
      <div className="flex items-center gap-0.5">
        <span className="flex h-6 min-w-[1.5rem] items-center justify-center rounded bg-slate-700 px-1 text-indigo-300" title="Table options">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M3 10h18M3 15h18M9 4v16M15 4v16" /></svg>
        </span>
        <TBtn active={false} onClick={() => editor.chain().focus().addColumnAfter().run()} title="Add column"><svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="12.5" y="4" width="6" height="16" rx="1.5" /><path strokeLinecap="round" d="M5 9.5v5M2.5 12h5" /></svg></TBtn>
        <TBtn active={false} onClick={() => editor.chain().focus().deleteColumn().run()} title="Delete column"><svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="12.5" y="4" width="6" height="16" rx="1.5" /><path strokeLinecap="round" d="M2.5 12h5" /></svg></TBtn>
        <TBtn active={false} onClick={() => editor.chain().focus().addRowAfter().run()} title="Add row"><svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="4" y="12.5" width="16" height="6" rx="1.5" /><path strokeLinecap="round" d="M12 2.5v5M9.5 5h5" /></svg></TBtn>
        <TBtn active={false} onClick={() => editor.chain().focus().deleteRow().run()} title="Delete row"><svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="4" y="12.5" width="16" height="6" rx="1.5" /><path strokeLinecap="round" d="M9.5 5h5" /></svg></TBtn>
        <TBtn danger active={false} onClick={() => editor.chain().focus().deleteTable().run()} title="Delete table"><svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M10 11v6M14 11v6" /></svg></TBtn>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <TBtn active={open} onClick={() => setOpen((v) => !v)} title="Insert table">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M3 10h18M3 15h18M9 4v16M15 4v16" /></svg>
      </TBtn>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-max rounded-lg border border-slate-700 bg-slate-900 p-2 shadow-2xl">
          <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${N}, 1.15rem)` }} onMouseLeave={() => setHover({ r: 0, c: 0 })}>
            {Array.from({ length: N * N }).map((_, i) => {
              const r = Math.floor(i / N), c = i % N;
              const on = r <= hover.r && c <= hover.c;
              return (
                <div
                  key={i}
                  onMouseEnter={() => setHover({ r, c })}
                  onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().insertTable({ rows: r + 1, cols: c + 1, withHeaderRow: true }).run(); setOpen(false); }}
                  className={`h-[1.15rem] w-[1.15rem] cursor-pointer rounded-sm border transition-colors ${on ? "border-indigo-400 bg-indigo-500/40" : "border-slate-600 bg-slate-800 hover:border-slate-500"}`}
                />
              );
            })}
          </div>
          <p className="mt-2 text-center text-[11px] text-slate-400">{hover.c + 1} × {hover.r + 1}</p>
        </div>
      )}
    </div>
  );
}

function useClickOutside(ref: React.RefObject<HTMLElement | null>, when: boolean, onOut: () => void) {
  useEffect(() => {
    if (!when) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onOut(); };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [ref, when, onOut]);
}

function TBtn({ active, onClick, title, children, danger }: { active: boolean; onClick: () => void; title: string; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className={`flex h-6 min-w-[1.5rem] items-center justify-center rounded px-1 transition-colors ${active ? "bg-slate-700 text-indigo-300" : danger ? "text-slate-400 hover:bg-red-500/10 hover:text-red-400" : "text-slate-400 hover:bg-slate-700/60 hover:text-slate-200"}`}
    >
      {children}
    </button>
  );
}
