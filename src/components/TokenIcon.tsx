"use client";

import { useState } from "react";

// ── Token coin icons (real logos, with a colored-coin fallback) ───────────────
// Shared so the landing header and the in-app dashboard header render the EXACT
// same Arweave (AR) coin.

export function TokenImg({
  src,
  label,
  bg,
  invert = false,
}: {
  src: string;
  label: string;
  bg: string;
  invert?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className="w-4 h-4 rounded-full overflow-hidden shrink-0 flex items-center justify-center"
      style={{ background: bg }}
    >
      {failed ? (
        <span className="text-[6px] font-bold text-white leading-none">{label}</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={label}
          width={16}
          height={16}
          className="w-full h-full object-contain"
          // invert recolors a dark monochrome mark to pure white on the coin.
          style={invert ? { filter: "brightness(0) invert(1)" } : undefined}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

export function ArweaveTokenIcon() {
  return (
    <TokenImg
      src="https://s2.coinmarketcap.com/static/img/coins/64x64/5632.png"
      label="AR"
      bg="#000000"
      invert
    />
  );
}
