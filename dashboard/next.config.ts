import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  serverExternalPackages: ["undici", "yaml", "zod"],
  turbopack: {
    root,
    resolveAlias: {
      "@/gw": resolve(root, "../dist"),
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@/gw": resolve(root, "../dist"),
    };
    return config;
  },
};

export default nextConfig;
