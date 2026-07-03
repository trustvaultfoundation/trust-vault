import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms & Privacy",
  description:
    "TrustVault Terms & Conditions and Privacy Policy — a non-custodial, end-to-end-encrypted, serverless workspace on Arweave. How keys, permanence, public content (forum/DePM) and privacy work.",
  alternates: { canonical: "/terms" },
};

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
