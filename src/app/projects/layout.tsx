import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "DePM — Public projects",
  description:
    "DePM (Decentralized Project Management): teams on TrustVault who made a board public, so anyone can study their real, on-chain progress — transparency for companies and the people who back them.",
  alternates: { canonical: "/projects" },
};

export default function ProjectsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
