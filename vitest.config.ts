import { defineConfig } from "vitest/config";

// Without this, vitest's default discovery also picks up dashboard/**/*.test.ts —
// those need dashboard/vitest.config.ts's @/ and @/gw/* alias resolution and
// must run via `cd dashboard && npm test` instead.
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "dashboard/**"],
  },
});
