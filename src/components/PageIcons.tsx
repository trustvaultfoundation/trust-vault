"use client";

// Static (resting-state) copies of the left-nav page icons, with the hover animations
// stripped — used on the Profile page (activity rows, filter chips, the message button)
// so each row/chip reads with the same glyph as the sidebar, but holds still.

export type PageIconKind = "board" | "timesheet" | "calendar" | "itsm" | "chat" | "docs" | "uploads";

const SVG = { fill: "none" as const, viewBox: "0 0 24 24", stroke: "currentColor", strokeWidth: 2 };

export function PageIcon({ kind, className = "h-4 w-4" }: { kind: PageIconKind; className?: string }) {
  switch (kind) {
    case "board":
      return (
        <span className={`inline-flex items-center justify-center ${className}`}>
          <span className="-ml-[1.15px] h-3 w-[5px] rounded-l-[2.5px] shadow-[inset_0_0_0_1.25px_currentColor]" />
          <span className="-ml-[1.15px] h-3 w-[5px] shadow-[inset_0_0_0_1.25px_currentColor]" />
          <span className="-ml-[1.15px] h-3 w-[5px] rounded-r-[2.5px] shadow-[inset_0_0_0_1.25px_currentColor]" />
        </span>
      );
    case "timesheet":
      return (
        <svg className={className} {...SVG}>
          <circle cx="12" cy="12" r="8.5" />
          <path strokeLinecap="round" d="M12 12h2.6M12 12V6.8" />
        </svg>
      );
    case "calendar":
      return (
        <svg className={className} {...SVG}>
          <rect x="3" y="5" width="18" height="16" rx="2.5" />
          <path strokeLinecap="round" d="M3 9.5h18M8 3.5v3M16 3.5v3" />
        </svg>
      );
    case "itsm":
      return (
        <svg className={className} {...SVG}>
          <path strokeLinecap="round" d="M5.5 13V11.5A6.5 6.5 0 0 1 18.5 11.5V13" />
          <rect x="3.7" y="12" width="3.5" height="5.5" rx="1.7" />
          <rect x="16.8" y="12" width="3.5" height="5.5" rx="1.7" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M5.45 17.5V19A2.3 2.3 0 0 0 7.75 21.3H8.2" />
          <rect x="8" y="19.8" width="3.2" height="3" rx="1.5" />
        </svg>
      );
    case "chat":
      return (
        <svg className={className} {...SVG}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 5h12a3 3 0 013 3v6a3 3 0 01-3 3H10l-4 3v-3a3 3 0 01-3-3V8a3 3 0 013-3z" />
        </svg>
      );
    case "docs":
      return (
        <svg className={className} {...SVG}>
          <path strokeLinecap="round" d="M12 6.5v13" />
          <path strokeLinejoin="round" d="M12 6.5C10.3 5.5 7.8 5 5.5 5S3 5.3 3 5.3v11.7s1.2-.3 3.5-.3 4.8.8 5.5 1.8z" />
          <path strokeLinejoin="round" d="M12 6.5C13.7 5.5 16.2 5 18.5 5S21 5.3 21 5.3v11.7s-1.2-.3-3.5-.3-4.8.8-5.5 1.8z" />
        </svg>
      );
    case "uploads":
      return (
        <svg className={className} {...SVG}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M12 16V4m0 0L8 8m4-4 4 4" />
        </svg>
      );
  }
}

// A phone handset (the "Call" action).
export function CallIcon({ className = "h-4 w-4" }: { className?: string }) {
  return <svg className={className} {...SVG}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 5.5A1.5 1.5 0 0 1 6 4h2.2a1 1 0 0 1 1 .8l.7 3a1 1 0 0 1-.5 1.1L8 9.8a11 11 0 0 0 5 5l.9-1.4a1 1 0 0 1 1.1-.5l3 .7a1 1 0 0 1 .8 1V17a1.5 1.5 0 0 1-1.5 1.5A12.5 12.5 0 0 1 4.5 5.5Z" /></svg>;
}
