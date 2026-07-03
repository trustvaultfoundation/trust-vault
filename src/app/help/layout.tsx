import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Help & guide",
  description:
    "Learn how TrustVault works — the vault, sharing & access keys, dashboard, boards, service desk, chat, calendar and documents. The full guide, also built into the app.",
  alternates: { canonical: "/help" },
};

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return children;
}
