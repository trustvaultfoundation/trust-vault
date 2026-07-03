"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Themed dropdown panel: portalled to <body> (so it can't be clipped by the
// scrolling drawer), positioned under its anchor, clamped to the viewport, and
// closed on outside-click / scroll / Esc. Replaces the unstyled native <select>.
function Dropdown({ anchor, onClose, children, width }: { anchor: HTMLElement | null; onClose: () => void; children: React.ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ position: "fixed", top: -9999, left: -9999, visibility: "hidden" });
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const a = anchor.getBoundingClientRect();
    const pad = 8;
    const minW = width ?? a.width;
    const maxW = window.innerWidth - pad * 2;
    // Size the panel to its content so option text is never clipped — but at least as wide as
    // the trigger, and never wider than the viewport. Measure the result to place it on-screen.
    const el = ref.current;
    el.style.width = "max-content";
    el.style.minWidth = `${minW}px`;
    el.style.maxWidth = `${maxW}px`;
    const m = el.getBoundingClientRect();
    let left = a.left;
    if (left + m.width > window.innerWidth - pad) left = window.innerWidth - m.width - pad;
    if (left < pad) left = pad;
    let top = a.bottom + 4;
    if (top + m.height > window.innerHeight - pad) top = Math.max(pad, a.top - m.height - 4);
    setStyle({ position: "fixed", top, left, width: "max-content", minWidth: minW, maxWidth: maxW, visibility: "visible" });
  }, [anchor, width]);
  useEffect(() => {
    // Capture phase so an outside click closes the panel even inside modals/editors that
    // stopPropagation on their own mousedown (e.g. the calendar event editor).
    const onDown = (e: MouseEvent) => { const t = e.target as Node; if (ref.current && !ref.current.contains(t) && anchor && !anchor.contains(t)) onClose(); };
    const onScroll = (e: Event) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown, true); window.removeEventListener("scroll", onScroll, true); window.removeEventListener("keydown", onKey); };
  }, [anchor, onClose]);
  return createPortal(
    <div ref={ref} style={style} className="z-[120] max-h-60 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 pb-1 shadow-2xl">{children}</div>,
    document.body,
  );
}

export interface Opt { value: string; label: string; dot?: string; disabled?: boolean }

// Themed single-select (button + dropdown).
export function ThemedSelect({ value, options, onChange, disabled, className }: { value: string; options: Opt[]; onChange: (v: string) => void; disabled?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const sel = options.find((o) => o.value === value);
  return (
    <>
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={className ?? "flex w-full items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-100 hover:border-slate-600 focus:border-indigo-500 focus:outline-none disabled:opacity-60"}
      >
        {sel?.dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${sel.dot}`} />}
        <span className="truncate">{sel?.label ?? "—"}</span>
        <svg className={`ml-auto h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <Dropdown anchor={ref.current} onClose={() => setOpen(false)}>
          {options.map((o) => (
            <button key={o.value} type="button" disabled={o.disabled} onClick={() => { onChange(o.value); setOpen(false); }} className={`flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-xs ${o.disabled ? "cursor-not-allowed text-slate-600" : o.value === value ? "bg-indigo-600/20 text-indigo-200" : "text-slate-200 hover:bg-slate-800"}`}>
              {o.dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${o.dot}`} />}
              <span className="whitespace-nowrap">{o.label}</span>
            </button>
          ))}
        </Dropdown>
      )}
    </>
  );
}

// Themed SEARCHABLE single-select: the trigger opens a dropdown with a search box
// that filters the options by label (free text isn't kept — it only filters). For
// ticket pickers the label is "CODE-NUM · Title" so typing a key OR a title both
// match. `allowClear` turns the chevron into an × when something is selected.
export function ThemedCombo({ value, options, onChange, placeholder, allowClear, disabled, className }: {
  value: string;
  options: Opt[];
  onChange: (v: string) => void;
  placeholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0); // keyboard-highlighted option
  const ref = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const sel = options.find((o) => o.value === value);
  const needle = q.trim().toLowerCase();
  const filtered = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
  useEffect(() => { if (open) { setQ(""); const id = setTimeout(() => inputRef.current?.focus(), 0); return () => clearTimeout(id); } }, [open]);
  useEffect(() => { setActive(0); }, [q, open]);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: "nearest" }); }, [active]);
  const choose = (o: Opt) => { if (o.disabled) return; onChange(o.value); setOpen(false); };
  // Arrow keys move the highlight, Enter picks it, Esc closes — same as the other search fields.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); return; }
    if (!filtered.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(filtered.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); const o = filtered[active]; if (o) choose(o); }
  };
  return (
    <>
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={className ?? "flex w-full items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs hover:border-slate-600 focus:border-indigo-500 focus:outline-none disabled:opacity-60"}
      >
        {sel?.dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${sel.dot}`} />}
        <span className={`truncate ${sel ? "text-slate-100" : "text-slate-500"}`}>{sel?.label ?? placeholder ?? "—"}</span>
        {allowClear && value ? (
          <span role="button" tabIndex={-1} aria-label="Clear" title="Clear" onClick={(e) => { e.stopPropagation(); onChange(""); setOpen(false); }} className="ml-auto shrink-0 rounded p-0.5 text-slate-500 hover:text-slate-200">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
          </span>
        ) : (
          <svg className={`ml-auto h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 9l6 6 6-6" /></svg>
        )}
      </button>
      {open && (
        <Dropdown anchor={ref.current} onClose={() => setOpen(false)} width={Math.max(ref.current?.offsetWidth ?? 0, 256)}>
          <div className="sticky top-0 z-10 border-b border-slate-800 bg-slate-900 p-1.5">
            <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Search…" className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none" />
          </div>
          {filtered.length === 0 ? (
            <p className="px-2.5 py-2 text-xs text-slate-500">No matches</p>
          ) : (
            filtered.map((o, i) => (
              <button key={o.value} ref={i === active ? activeRef : undefined} type="button" onMouseMove={() => setActive(i)} onClick={() => choose(o)} className={`flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-xs ${o.value === value ? "bg-indigo-600/20 text-indigo-200" : i === active ? "bg-slate-800 text-slate-100" : "text-slate-200 hover:bg-slate-800"}`}>
                {o.dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${o.dot}`} />}
                <span className="truncate">{o.label}</span>
              </button>
            ))
          )}
        </Dropdown>
      )}
    </>
  );
}

// Themed input with a suggestions dropdown (free text allowed). `onChange` updates
// the text; `onPick` fires when a suggestion is chosen or Enter is pressed.
export function ThemedAutocomplete({ value, onChange, onPick, suggestions, placeholder, disabled, className, listId }: {
  value: string;
  onChange: (v: string) => void;
  onPick: (v: string) => void;
  suggestions: string[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  listId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1); // -1 = keep the free text the user typed
  const ref = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const q = value.trim().toLowerCase();
  const filtered = suggestions.filter((s) => s.toLowerCase().includes(q)).slice(0, 8);
  useEffect(() => { setActive(-1); }, [value, open]);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: "nearest" }); }, [active]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); if (!open) { setOpen(true); return; } if (filtered.length) setActive((a) => Math.min(filtered.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(-1, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); const pick = active >= 0 && filtered[active] ? filtered[active] : value; onPick(pick); setOpen(false); }
  };
  return (
    <>
      <input
        ref={ref}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onBlur={() => onPick(value)}
        className={className}
        data-list={listId}
      />
      {open && filtered.length > 0 && (
        <Dropdown anchor={ref.current} onClose={() => setOpen(false)}>
          {filtered.map((s, i) => (
            <button key={s} ref={i === active ? activeRef : undefined} type="button" onMouseMove={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); onPick(s); setOpen(false); }} className={`block w-full truncate px-2.5 py-1.5 text-left text-xs ${i === active ? "bg-slate-800 text-slate-100" : "text-slate-200 hover:bg-slate-800"}`}>{s}</button>
          ))}
        </Dropdown>
      )}
    </>
  );
}
