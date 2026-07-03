"use client";

import { useEffect, useState } from "react";

// Turbo uploads are served by turbo-gateway.com within minutes, but arweave.net can take ~25 min to
// index them — so an <img> pointed straight at arweave.net 404s right after upload. This tries the
// fast gateway first and falls back to arweave.net on error. `override` (e.g. a local object URL) is
// shown as-is for instant preview right after an upload, before it's indexed anywhere.
const GATEWAYS = ["https://turbo-gateway.com", "https://arweave.net"];

export function PublicImg({ txId, alt, className, override }: { txId: string; alt: string; className?: string; override?: string }) {
  const [i, setI] = useState(0);
  useEffect(() => { setI(0); }, [txId]);
  const src = override || `${GATEWAYS[i]}/${txId}`;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => { if (!override && i < GATEWAYS.length - 1) setI(i + 1); }}
    />
  );
}
