import type { MetadataRoute } from "next";

// Statically emitted at build time (works under output: "export"). Only the publicly
// indexable pages are listed — the rest of the app is wallet-gated and redirects to the
// landing page when not connected, so it carries no SEO value.
export const dynamic = "force-static";

const SITE_URL = "https://trustvault.foundation";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/help`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
  ];
}
