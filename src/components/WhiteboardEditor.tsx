"use client";

import dynamic from "next/dynamic";
import { useRef } from "react";
import "@excalidraw/excalidraw/index.css";
import { Loading } from "@/components/Spinner";

// Excalidraw is browser-only (touches window/workers at import), so load it with
// SSR disabled. It's the "scheme/whiteboard" (Miro-like) page type.
const Excalidraw = dynamic(() => import("@excalidraw/excalidraw").then((m) => m.Excalidraw), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center"><Loading label="Loading whiteboard…" /></div>,
}) as React.ComponentType<Record<string, unknown>>;

export function WhiteboardEditor({ value, onChange, readOnly }: { value: string; onChange: (json: string) => void; readOnly?: boolean }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  let initial: { elements?: unknown[]; appState?: Record<string, unknown> } | null = null;
  try { initial = value ? JSON.parse(value) : null; } catch { initial = null; }

  return (
    <div className="h-[72vh] w-full overflow-hidden rounded-lg border border-slate-800">
      <Excalidraw
        theme="dark"
        viewModeEnabled={!!readOnly}
        initialData={initial ? { elements: initial.elements ?? [], appState: { viewBackgroundColor: (initial.appState?.viewBackgroundColor as string) ?? "#0f172a" }, scrollToContent: true } : { appState: { viewBackgroundColor: "#0f172a" } }}
        onChange={(elements: unknown, appState: { viewBackgroundColor?: string }) => {
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            try { onChange(JSON.stringify({ elements, appState: { viewBackgroundColor: appState?.viewBackgroundColor ?? "#0f172a" } })); } catch { /* ignore */ }
          }, 800);
        }}
      />
    </div>
  );
}
