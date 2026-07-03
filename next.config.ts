import type { NextConfig } from "next";

// Empty stub for Node sub-paths that have no browser polyfill equivalent.
const EMPTY_STUB = "./src/stubs/empty.js";

const nextConfig: NextConfig = {
  // ── Static export for Arweave/ArNS hosting (npm run build:static) ───────────
  // STATIC_EXPORT=1 emits ./out as fully static files (no server). The build:static
  // script strips the one remaining server route first. Normal build/dev unaffected.
  ...(process.env.STATIC_EXPORT === "1"
    ? { output: "export" as const, images: { unoptimized: true }, trailingSlash: true }
    : {}),

  // ── Turbopack (default dev bundler in Next.js 16) ──────────────────────────
  // resolveAlias values must be strings (package names or relative paths).
  turbopack: {
    resolveAlias: {
      // Real browser polyfills — provide the base classes @irys/sdk extends.
      stream: "stream-browserify",
      crypto: "crypto-browserify",
      os: "os-browserify",
      path: "path-browserify",
      // Plain stubs — no meaningful browser equivalent needed.
      fs: EMPTY_STUB,
      net: EMPTY_STUB,
      tls: EMPTY_STUB,
      // stream/promises is not covered by stream-browserify; stub it out.
      "stream/promises": EMPTY_STUB,
      // Real Buffer polyfill.
      buffer: "buffer",
    },
  },

  // ── Webpack (next build / CI) ───────────────────────────────────────────────
  // `false` = empty module; require.resolve() = real polyfill bundle.
  webpack(config, { isServer }) {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        stream: require.resolve("stream-browserify"),
        crypto: require.resolve("crypto-browserify"),
        os: require.resolve("os-browserify/browser"),
        path: require.resolve("path-browserify"),
        fs: false,
        net: false,
        tls: false,
        "stream/promises": false,
        buffer: require.resolve("buffer/"),
      };
    }
    return config;
  },
};

export default nextConfig;
