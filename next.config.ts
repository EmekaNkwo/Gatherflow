import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `experimental.agentFeedback` shipped on in the scaffold. It expects an
  // agent harness to be attached, and without one `next dev` exits as soon as
  // it reports ready, so it stays off for ordinary local development.
  // Cache Components and instant-navigation validation both assume a segment
  // can render meaningfully on the server. GatherFlow has no server data at
  // all: every page waits for the browser's own storage, so these only add
  // dev-time noise here.
  cacheComponents: false,
  partialPrefetching: false,
  turbopack: {
    // Pins the workspace root; the repository lives below the user's home
    // directory, which otherwise makes Turbopack guess.
    root: path.resolve(import.meta.dirname),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
