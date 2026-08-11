import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root to this repo — otherwise Next.js may infer it from
  // an unrelated lockfile higher up in the home directory.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
