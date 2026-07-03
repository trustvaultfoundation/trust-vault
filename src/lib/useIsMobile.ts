"use client";

import { useEffect, useState } from "react";

// Synchronous check — safe to call anywhere in the browser (returns false during SSR). Used by the
// wallet context to SKIP touching window.arweaveWallet on phones/tablets (we're desktop-only there,
// and probing the extension can trip its own injected-script bugs).
export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const phoneOrTablet = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const iPadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1; // iPadOS reports as Mac
  return phoneOrTablet || iPadOS;
}

// True on phones / tablets (iOS / iPadOS / Android). Computed after mount so a static
// prerender never hydration-mismatches. Shared by the landing + help pages.
export function useIsMobileDevice() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => { setMobile(isMobileDevice()); }, []);
  return mobile;
}
