import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { WalletProvider } from "@/context/WalletContext";
import { CookieConsent } from "@/components/CookieConsent";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Canonical, indexable home of the site. Used to absolutize OG/canonical URLs.
const SITE_URL = "https://trustvault.foundation";
const SITE_NAME = "TrustVault";
const DESCRIPTION =
  "TrustVault is the all-in-one, end-to-end encrypted workspace — boards, timesheet, a service desk, docs, chat, calendar and a document vault — free to use and stored permanently on Arweave.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "TrustVault — Encrypted workspace, kept forever",
    template: "%s · TrustVault",
  },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "encrypted workspace",
    "end-to-end encryption",
    "Arweave",
    "permanent storage",
    "document vault",
    "kanban board",
    "service desk",
    "ITSM",
    "team collaboration",
    "decentralized",
    "Wander wallet",
    "secure file storage",
  ],
  authors: [{ name: SITE_NAME }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  category: "productivity",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: "TrustVault — Encrypted workspace, kept forever",
    description: DESCRIPTION,
    locale: "en_US",
    images: [{ url: "/og.svg", width: 1200, height: 630, alt: "TrustVault — the all-in-one encrypted workspace" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "TrustVault — Encrypted workspace, kept forever",
    description: DESCRIPTION,
    images: ["/og.svg"],
  },
  // Icons (favicon.ico + icon.svg) and the web manifest (manifest.ts) are emitted from
  // their file conventions in app/, which auto-inject the <head> tags — no need to repeat
  // them here (doing so would duplicate the links).
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
};

export const viewport: Viewport = {
  themeColor: "#020617",
  colorScheme: "dark",
};

// Structured data so search engines can render a rich result for the app.
const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: SITE_NAME,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  url: SITE_URL,
  description: DESCRIPTION,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geist.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col bg-slate-950 text-slate-100" suppressHydrationWarning>
        {/* Apply the saved sidebar-collapsed state before first paint so the menu never animates
            open→collapsed on load (the no-flash technique). */}
        <script dangerouslySetInnerHTML={{ __html: "try{if(localStorage.getItem('gtv_sidebar_collapsed')==='1')document.documentElement.classList.add('gtv-sb-collapsed')}catch(e){}" }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
        <WalletProvider>{children}</WalletProvider>
        <CookieConsent />
      </body>
    </html>
  );
}
