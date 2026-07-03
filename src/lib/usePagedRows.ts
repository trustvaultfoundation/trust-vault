"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// Fit a list/table to the height it's given and page the overflow — the shared logic behind the
// Profile activity list, the Vault documents table and the Service Desk records table. It measures
// the scroll container (minus an optional sticky <thead>) and the REAL height of a rendered row
// (any element tagged `data-row`), then shows exactly as many rows as fit — so the table fills the
// space and only overflow spills onto the next page. `rowH` is just a fallback used before a row
// exists (empty list). `resetKey` sends you back to page 1 when the filter/context changes.
export function usePagedRows<T>(items: T[], rowH = 50, resetKey?: unknown) {
  // Callback ref (not useRef): the measured container often mounts LATER than this hook — e.g. the
  // Vault hook lives in the always-mounted AppShell but its table only appears on the Vault tab. A
  // callback ref re-runs the measuring effect the moment the node actually attaches.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const containerRef = useCallback((node: HTMLDivElement | null) => setContainer(node), []);
  const headerRef = useRef<HTMLTableSectionElement>(null); // optional — a table header to subtract
  const [pageSize, setPageSize] = useState(8);
  const [page, setPage] = useState(0);

  useLayoutEffect(() => {
    if (!container) return;
    const measure = () => {
      const head = headerRef.current?.offsetHeight ?? 0;
      const avail = container.clientHeight - head;
      const sample = container.querySelector<HTMLElement>("[data-row]");
      const rh = sample?.offsetHeight || rowH; // real row height when we have one, else the estimate
      setPageSize(Math.max(1, Math.floor(avail / rh)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
    // re-measure when the node attaches or rows first appear (empty → populated)
  }, [container, rowH, items.length]);

  useEffect(() => { setPage(0); }, [resetKey]);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const curPage = Math.min(page, totalPages - 1);
  const pageItems = items.slice(curPage * pageSize, curPage * pageSize + pageSize);
  return { containerRef, headerRef, page: curPage, setPage, totalPages, pageItems, pageSize };
}
