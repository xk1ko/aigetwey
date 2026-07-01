import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolveRealIp } = require("../net-preload.cjs") as {
  resolveRealIp: (socketIp: string, headers: Record<string, string | string[] | undefined>) => string;
};

describe("net-preload trust boundary", () => {
  it("honors X-Forwarded-For when the TCP peer itself is loopback (a local reverse proxy)", () => {
    expect(resolveRealIp("127.0.0.1", { "x-forwarded-for": "203.0.113.5" })).toBe("203.0.113.5");
    expect(resolveRealIp("::1", { "x-forwarded-for": "203.0.113.5" })).toBe("203.0.113.5");
  });

  it("IGNORES a spoofed X-Forwarded-For from a genuinely remote (non-loopback) peer — the actual bug #1 fix", () => {
    // An attacker connecting directly claims to be loopback to bypass the
    // "no api_keys configured — loopback only" gate in src/middleware/auth.ts.
    expect(resolveRealIp("203.0.113.9", { "x-forwarded-for": "127.0.0.1" })).toBe("203.0.113.9");
  });

  it("takes only the first hop of a comma-separated X-Forwarded-For chain", () => {
    expect(resolveRealIp("127.0.0.1", { "x-forwarded-for": "203.0.113.5, 10.0.0.1" })).toBe("203.0.113.5");
  });

  it("prefers X-Real-IP over X-Forwarded-For when both are present, from a loopback peer", () => {
    expect(
      resolveRealIp("127.0.0.1", { "x-real-ip": "203.0.113.7", "x-forwarded-for": "203.0.113.5" }),
    ).toBe("203.0.113.7");
  });

  it("falls back to the raw socket address when no forwarding header is present", () => {
    expect(resolveRealIp("203.0.113.9", {})).toBe("203.0.113.9");
    expect(resolveRealIp("127.0.0.1", {})).toBe("127.0.0.1");
  });
});
