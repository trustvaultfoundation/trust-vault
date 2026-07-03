"use client";

// A deterministic gradient avatar with the first initial — wallets don't have photos,
// so we derive a stable colour from the address/label. Same seed → same look everywhere.

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const PALETTE: [string, string][] = [
  ["#6366f1", "#a855f7"], ["#0ea5e9", "#6366f1"], ["#10b981", "#0ea5e9"],
  ["#f59e0b", "#ef4444"], ["#ec4899", "#8b5cf6"], ["#14b8a6", "#22c55e"],
  ["#f43f5e", "#f59e0b"], ["#8b5cf6", "#6366f1"],
];

export function avatarColors(seed: string): { from: string; to: string } {
  const [from, to] = PALETTE[hash(seed || "?") % PALETTE.length];
  return { from, to };
}

export function UserAvatar({ seed, label, size = 32, className }: { seed: string; label?: string; size?: number; className?: string }) {
  const { from, to } = avatarColors(seed || label || "?");
  const initial = ((label && label.trim()[0]) || seed?.[0] || "?").toUpperCase();
  return (
    <span
      style={{ width: size, height: size, background: `linear-gradient(135deg, ${from}, ${to})`, fontSize: Math.round(size * 0.42) }}
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white ${className ?? ""}`}
    >
      {initial}
    </span>
  );
}
