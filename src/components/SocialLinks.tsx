"use client";

import { socialUrl, type Social, type SocialKind } from "@/lib/accessKeys";

function Icon({ kind, className = "h-4 w-4" }: { kind: SocialKind; className?: string }) {
  // Clean LINE versions (outline / single-stroke) so they match the rest of the app's line icons
  // (left nav, email, etc.) — borderless, just the glyph drawn as a line in the shape of the logo.
  const p = { className, fill: "none" as const, viewBox: "0 0 24 24", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (kind) {
    case "x": return <svg {...p}><path d="M4 3.5h4.2l4.3 5.9 5-5.9h2.4l-6.2 7.3 7 9.7h-4.2l-4.8-6.6L7 20.5H4.6l6.6-7.8L4 3.5Z" /></svg>;
    case "github": return <svg {...p}><path d="M9 19c-4.7 1.4-4.7-2.4-6.6-2.9m13.2 5.3v-3.6a3.1 3.1 0 0 0-.9-2.4c2.9-.3 6-1.4 6-6.4a5 5 0 0 0-1.4-3.4 4.6 4.6 0 0 0-.1-3.4s-1.1-.3-3.6 1.4a12.4 12.4 0 0 0-6.4 0C6.7 1.4 5.6 1.7 5.6 1.7a4.6 4.6 0 0 0-.1 3.4A5 5 0 0 0 4 8.5c0 5 3.1 6.1 6 6.4a3.1 3.1 0 0 0-.9 2.4V21" /></svg>;
    case "linkedin": return <svg {...p}><rect x="2.2" y="2.2" width="19.6" height="19.6" rx="4.2" /><path d="M7.2 10.8v6.8" /><path d="M7.2 7.1h.01" /><path d="M11 17.6v-6.8m0 2.6a2.6 2.6 0 0 1 5.2 0v4.2" /></svg>;
    case "telegram": return <svg {...p}><path d="M21.5 4.3 2.9 11.5c-.9.35-.86 1.62.06 1.9l4.6 1.43 1.78 5.27c.25.74 1.2.94 1.73.36l2.6-2.86 4.62 3.4c.6.44 1.46.1 1.6-.63L23 5.3c.18-.93-.7-1.7-1.5-1Z" /><path d="m7.6 14.8 9-6.4-6.2 6.8" /></svg>;
    case "discord": return <svg {...p}><path d="M8.4 6.2A16.6 16.6 0 0 1 15.6 6.2M7.6 18a14 14 0 0 0 8.8 0M8.4 6.2 7.7 4.8a16 16 0 0 0-4 1.3C2 9 1.3 12.6 1.6 16.2a14.7 14.7 0 0 0 4.5 2.3l1-1.7M15.6 6.2l.7-1.4a16 16 0 0 1 4 1.3C22 9 22.7 12.6 22.4 16.2a14.7 14.7 0 0 1-4.5 2.3l-1-1.7" /><circle cx="9" cy="12.5" r="1.3" /><circle cx="15" cy="12.5" r="1.3" /></svg>;
    case "website": return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" /></svg>;
    case "email": return <svg {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M4 7l8 6 8-6" /></svg>;
  }
}

export function SocialLinks({ socials, className }: { socials: Social[]; className?: string }) {
  const list = socials.filter((s) => s.value.trim());
  if (list.length === 0) return null;
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className ?? ""}`}>
      {list.map((s, i) => (
        <a key={i} href={socialUrl(s)} target="_blank" rel="noopener noreferrer" title={s.value} onClick={(e) => e.stopPropagation()}
          className="text-slate-400 transition-colors hover:text-white">
          <Icon kind={s.kind} className="h-[18px] w-[18px]" />
        </a>
      ))}
    </div>
  );
}

export { Icon as SocialIcon };
