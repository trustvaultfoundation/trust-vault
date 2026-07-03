"use client";

// A plain <input>/<textarea> with @mention autocomplete, for fields that aren't rich text
// (titles, notes). Typing "@" opens a portalled member picker; selecting inserts "@Label "
// as plain text. The mention source is the same address book used by the rich editor, so
// "@identity" works consistently everywhere. Value stays a plain string.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { placePopover } from "@/lib/popover";
import { filterPeople, type MentionPerson } from "@/lib/mentions";

type Common = {
  value: string;
  onChange: (v: string) => void;
  people: MentionPerson[];
  multiline?: boolean;
  className?: string;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  disabled?: boolean;
  maxLength?: number;
  onKeyDown?: (e: React.KeyboardEvent) => void;
};

export function MentionInput({ value, onChange, people, multiline, className, placeholder, rows, autoFocus, disabled, maxLength, onKeyDown }: Common) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null); // null = closed
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const caretToSet = useRef<number | null>(null);

  const items = query === null ? [] : filterPeople(people, query);
  useEffect(() => { setActive(0); }, [query]);

  // After we rewrite the value on select, restore the caret to just past the inserted mention.
  useLayoutEffect(() => {
    if (caretToSet.current != null && ref.current) {
      ref.current.selectionStart = ref.current.selectionEnd = caretToSet.current;
      caretToSet.current = null;
    }
  });

  useEffect(() => {
    if (query === null) return;
    const onScroll = () => detect();
    window.addEventListener("resize", onScroll);
    return () => window.removeEventListener("resize", onScroll);
  }, [query]);

  // Look at the text just before the caret for a "@word" token being typed.
  const detect = () => {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart ?? 0;
    const before = el.value.slice(0, caret);
    const m = before.match(/(?:^|\s)@(\w{0,30})$/);
    if (!m) { setQuery(null); return; }
    setQuery(m[1]);
    setPos(placePopover(el.getBoundingClientRect(), 224, 220));
  };

  const choose = (p: MentionPerson) => {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart ?? value.length;
    const before = value.slice(0, caret).replace(/@(\w{0,30})$/, "");
    const after = value.slice(caret);
    const insert = `@${p.label} `;
    caretToSet.current = before.length + insert.length;
    onChange(before + insert + after);
    setQuery(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (query !== null && items.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % items.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + items.length) % items.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); choose(items[active]); return; }
      if (e.key === "Escape") { e.preventDefault(); setQuery(null); return; }
    }
    onKeyDown?.(e);
  };

  const shared = {
    ref,
    value,
    placeholder,
    autoFocus,
    disabled,
    maxLength,
    className,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { onChange(e.target.value); requestAnimationFrame(detect); },
    onKeyUp: detect,
    onClick: detect,
    onBlur: () => setTimeout(() => setQuery(null), 120),
    onKeyDown: handleKeyDown,
  };

  return (
    <>
      {multiline ? <textarea {...shared} rows={rows} /> : <input {...shared} />}
      {query !== null && pos && createPortal(
        <div data-dateinput-pop="" style={{ position: "fixed", top: pos.top, left: pos.left, width: 224 }} className="z-[200] max-h-56 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-1 shadow-2xl">
          {items.length === 0 ? (
            <p className="px-2 py-2 text-[11px] text-slate-500">No people to mention</p>
          ) : items.map((p, i) => (
            <button key={p.id} type="button" onMouseDown={(e) => { e.preventDefault(); choose(p); }} onMouseEnter={() => setActive(i)}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${i === active ? "bg-slate-800" : "hover:bg-slate-800/60"}`}>
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-[10px] font-semibold text-violet-200">{(p.label[0] || "@").toUpperCase()}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{p.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
