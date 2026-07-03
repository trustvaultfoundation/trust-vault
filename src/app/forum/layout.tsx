import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Forum",
  description:
    "The TrustVault community forum — feedback, ideas, bug reports and discussion. Public and permanent on Arweave; only display names are shown, never wallet addresses.",
  alternates: { canonical: "/forum" },
};

export default function ForumLayout({ children }: { children: React.ReactNode }) {
  return children;
}
