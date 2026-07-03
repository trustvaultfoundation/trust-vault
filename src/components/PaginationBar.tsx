"use client";

// Shared page navigator (‹ Page X / Y ›) used under the height-fitted Profile / Vault / Service Desk
// tables. Renders nothing when there's only one page. `page` is 0-indexed.
export function PaginationBar({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
  if (totalPages <= 1) return null;
  const btn = "flex h-7 w-7 items-center justify-center rounded-lg border border-slate-700 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-400";
  return (
    <div className="flex shrink-0 items-center justify-center gap-3 border-t border-slate-800 bg-slate-900/40 px-3 py-2">
      <button onClick={() => onPage(Math.max(0, page - 1))} disabled={page === 0} title="Previous page" aria-label="Previous page" className={btn}>
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 6l-6 6 6 6" /></svg>
      </button>
      <span className="text-xs tabular-nums text-slate-400">Page {page + 1} <span className="text-slate-600">/</span> {totalPages}</span>
      <button onClick={() => onPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} title="Next page" aria-label="Next page" className={btn}>
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" /></svg>
      </button>
    </div>
  );
}
