import type { NextConfig } from "next";

// Pages that receive a secret token in the query string (?token=...). Even though each page strips
// the token from the address bar on load, the initial document URL is what the browser would send
// as the Referer for its subresource requests and any link followed, so these pages send none.
const TOKEN_IN_URL_PAGES = ["/reset-password", "/verify-email"];

const nextConfig: NextConfig = {
  /* config options here */
  async headers() {
    return TOKEN_IN_URL_PAGES.map((source) => ({
      source,
      headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
    }));
  },
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
