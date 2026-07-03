// The TrustVault wordmark — the plain readable text (no icon), with "Vault" in indigo. Shared by
// the landing, app shell, help and 404 headers. `BrandMark` (the shield-and-keyhole logo, same as
// the favicon / logo.svg) is exported separately for anywhere that wants the icon on its own.

/** The brand mark on its own — a rounded indigo tile with a white shield (Trust) + keyhole (Vault). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className ?? "h-6 w-6"} role="img" aria-label="TrustVault">
      <defs>
        <linearGradient id="tv-mark-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#818cf8" />
          <stop offset="1" stopColor="#4338ca" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="url(#tv-mark-bg)" />
      <path d="M32 11 L49 17.5 V31 C49 41.4 41.6 49.4 32 53 C22.4 49.4 15 41.4 15 31 V17.5 Z" fill="#fff" />
      <circle cx="32" cy="29" r="5.2" fill="#4338ca" />
      <path d="M30 30.5 H34 L35.6 43 H28.4 Z" fill="#4338ca" />
    </svg>
  );
}

export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span className={`text-xl font-bold tracking-tight text-white ${className ?? ""}`}>
      Trust<span className="text-indigo-400">Vault</span>
    </span>
  );
}
