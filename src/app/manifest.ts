import type { MetadataRoute } from "next";

// Statically emitted at build time (works under output: "export").
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TrustVault — Encrypted workspace, kept forever",
    short_name: "TrustVault",
    description:
      "The all-in-one, end-to-end encrypted workspace — boards, service desk, docs, chat, calendar and a document vault — stored permanently on Arweave.",
    start_url: "/",
    display: "standalone",
    background_color: "#020617",
    theme_color: "#020617",
    categories: ["productivity", "business", "security"],
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
