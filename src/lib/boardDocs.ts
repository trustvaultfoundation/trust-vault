// Per-board documentation pages (a personal wiki). Stored locally
// per board (`gtv_boarddocs_<boardId>`); these are private notes for the user, not
// synced to other members.

import { newId } from "./board";

export interface DocPage {
  id: string;
  title: string;
  kind: "page" | "whiteboard"; // page = rich text; whiteboard = Excalidraw scheme
  content: string; // HTML (Tiptap) for a page, or Excalidraw scene JSON for a whiteboard
  parentId: string | null; // tree (nesting)
  order: number; // sort among siblings
  createdAt: number;
  updatedAt: number;
  createdBy?: string; // wallet address that created the page
  updatedBy?: string; // wallet address of the last edit (shown as a clickable author)
}

const docsKey = (boardId: string) => `gtv_boarddocs_${boardId}`;

export function loadDocs(boardId: string): DocPage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(docsKey(boardId));
    if (!raw) return [];
    return (JSON.parse(raw) as DocPage[]).map((d, i) => ({ ...d, kind: d.kind ?? "page", parentId: d.parentId ?? null, order: d.order ?? d.createdAt ?? i }));
  } catch {
    return [];
  }
}

export function saveDocs(boardId: string, docs: DocPage[]): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(docsKey(boardId), JSON.stringify(docs)); } catch {}
}

export function newDoc(title = "Untitled", parentId: string | null = null, order = Date.now(), kind: "page" | "whiteboard" = "page", author?: string): DocPage {
  const now = Date.now();
  return { id: newId(), title, kind, content: "", parentId, order, createdAt: now, updatedAt: now, createdBy: author, updatedBy: author };
}
