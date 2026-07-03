"use client";

/** A small "?" help icon that reveals an explanatory popup on hover. */
export function HelpTip({
  text,
  side = "bottom",
}: {
  text: string;
  side?: "bottom" | "top" | "right";
}) {
  const pos =
    side === "top"
      ? "bottom-full mb-2 left-1/2 -translate-x-1/2"
      : side === "right"
      ? "left-full ml-2 top-1/2 -translate-y-1/2"
      : "top-full mt-2 left-1/2 -translate-x-1/2";
  return (
    <span className="group/tip relative inline-flex align-middle">
      <span className="flex items-center justify-center w-4 h-4 rounded-full border border-slate-600 text-slate-400 text-[10px] leading-none cursor-help select-none hover:border-slate-400 hover:text-slate-200 transition-colors">
        ?
      </span>
      <span
        className={`pointer-events-none absolute ${pos} w-60 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-[11px] font-normal text-slate-300 leading-relaxed shadow-xl opacity-0 group-hover/tip:opacity-100 transition-opacity z-[60]`}
      >
        {text}
      </span>
    </span>
  );
}
