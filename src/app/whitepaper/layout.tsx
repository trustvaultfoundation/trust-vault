import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Whitepaper",
  description:
    "The TrustVault whitepaper — a free, encrypted workspace with on-chain DePM transparency and one-wallet-one-vote governance. Plain language, topic by topic.",
  alternates: { canonical: "/whitepaper" },
};

export default function WhitepaperLayout({ children }: { children: React.ReactNode }) {
  return children;
}
