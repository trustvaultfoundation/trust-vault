"use client";

import DOMPurify from "dompurify";
import { showUserCard } from "@/lib/profileNav";

// Render stored rich text safely. Content is HTML (Tiptap); legacy plain text is
// wrapped as a paragraph. DOMPurify strips scripts/handlers and `javascript:`
// URLs; a hook forces external links to open in a new tab with noopener.
let hooked = false;
function clean(html: string): string {
  if (typeof window === "undefined") return "";
  if (!hooked) {
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if ((node as Element).tagName === "A") {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    });
    hooked = true;
  }
  return DOMPurify.sanitize(html, { ADD_ATTR: ["target", "rel"] });
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const isHtml = (s: string) => /<[a-z][\s\S]*>/i.test(s);

export function isEmptyHtml(html: string): boolean {
  return !html || !html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, "").trim();
}

export function RichTextView({ html, className }: { html: string; className?: string }) {
  // A rendered @mention pill ([data-mention]) opens the user card on click.
  const onClick = (e: React.MouseEvent) => {
    const pill = (e.target as HTMLElement).closest<HTMLElement>("[data-mention]");
    if (!pill) return;
    const id = pill.getAttribute("data-mention");
    if (!id) return;
    const r = pill.getBoundingClientRect();
    showUserCard({ address: id, label: pill.getAttribute("data-label") || (pill.textContent || "").replace(/^@/, ""), rect: { top: r.top, left: r.left, bottom: r.bottom } });
  };
  if (isEmptyHtml(html)) return null;
  const source = isHtml(html) ? html : `<p>${escape(html).replace(/\n/g, "<br>")}</p>`;
  return <div onClick={onClick} className={`gtv-rte ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: clean(source) }} />;
}
