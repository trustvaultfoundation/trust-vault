import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Governance",
  description:
    "TrustVault governance — free, one wallet one vote. Anyone can vote on proposals that steer the roadmap; no token, no gas. Plus optional ways to support the project.",
  alternates: { canonical: "/governance" },
};

export default function GovernanceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
