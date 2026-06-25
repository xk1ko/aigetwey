import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const nextConfig: NextConfig = {
  // dashboard talks to the gateway only server-side (route handlers proxy
  // /admin/*), so no rewrites/CORS needed here.
  reactStrictMode: true,
  // allow dev HMR/resource requests from loopback hosts so client hydration
  // works regardless of which host name opens the app (localhost vs 127.0.0.1).
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  // this dashboard is its own npm package (own lockfile) nested in the gateway
  // repo (which also has one). Pin Turbopack's root so it stops warning about an
  // ambiguous workspace root and picks the dashboard.
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
};

export default nextConfig;
