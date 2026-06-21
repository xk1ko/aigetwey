import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // dashboard talks to the gateway only server-side (route handlers proxy
  // /admin/*), so no rewrites/CORS needed here.
  reactStrictMode: true,
  // allow dev HMR/resource requests from loopback hosts so client hydration
  // works regardless of which host name opens the app (localhost vs 127.0.0.1).
  allowedDevOrigins: ["localhost", "127.0.0.1"],
};

export default nextConfig;
