"use client";

// The app's single rotating loader. Same glyph the wallet-restore screen uses, so every
// "loading…" state across the app spins identically instead of showing plain text.
export function Spinner({ className = "h-5 w-5 text-indigo-400" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v3a5 5 0 0 0-5 5H4z" />
    </svg>
  );
}

// Centered spinner with an optional label — drop-in replacement for the old text-only
// "Loading…" placeholders. `className` lets each caller keep its own padding.
export function Loading({ label, className = "py-8", spinner = "h-5 w-5 text-indigo-400" }: { label?: string; className?: string; spinner?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 text-center ${className}`}>
      <Spinner className={spinner} />
      {label && <p className="text-xs text-slate-500">{label}</p>}
    </div>
  );
}
