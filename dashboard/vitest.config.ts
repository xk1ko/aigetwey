import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));

// Same alias resolution as next.config.ts / tsconfig.json's "paths" — @/gw/*
// points at the compiled dist/ output (the gateway core), not TS source, so
// `npm run build` at the repo root must run before these tests do.
export default defineConfig({
  test: {
    environment: "node",
    css: false,
  },
  resolve: {
    alias: {
      "@/gw": resolve(root, "../dist"),
      "@": resolve(root, "src"),
      // "server-only"'s default export throws outside Next's "react-server"
      // condition (which vitest doesn't set) — dashboard/src/lib/gw.ts imports
      // it as a marker. Redirect to its own no-op build instead of setting the
      // react-server condition globally (which would also change how React
      // itself resolves).
      "server-only": resolve(root, "node_modules/server-only/empty.js"),
    },
  },
  // Vite auto-discovers postcss.config.mjs at the project root regardless of
  // `test.css: false` — it's written for Tailwind v4 + Next's own pipeline
  // (array-of-strings plugin shorthand) and Vite's loader rejects that shape.
  // These tests don't touch CSS at all, so short-circuit discovery entirely.
  css: { postcss: { plugins: [] } },
});
