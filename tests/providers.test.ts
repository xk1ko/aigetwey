import { describe, it, expect, vi, beforeEach } from "vitest";

const requestMock = vi.fn();
vi.mock("undici", () => ({ request: (...args: unknown[]) => requestMock(...args) }));

import { fetchModels } from "../src/providers/free.js";
import { VertexAuth, _internal } from "../src/providers/vertex.js";
import { validateConfig } from "../src/config.js";
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function freeProvider() {
  const cfg = validateConfig({
    providers: [{ id: "oc", format: "openai", base_url: "https://opencode.ai/zen/v1", free: true, auto_models: true }],
  });
  return cfg.getProvider("oc")!;
}

function ok(json: unknown, statusCode = 200) {
  return { statusCode, body: { json: async () => json, text: async () => JSON.stringify(json), dump: async () => {} } };
}

beforeEach(() => requestMock.mockReset());

describe("free.fetchModels", () => {
  it("parses the OpenAI /models shape into ids", async () => {
    requestMock.mockResolvedValue(ok({ data: [{ id: "grok-free" }, { id: "qwen-free" }, { bogus: true }] }));
    const res = await fetchModels(freeProvider());
    expect(res.ok).toBe(true);
    expect(res.models.map((m) => m.id)).toEqual(["grok-free", "qwen-free"]);
    // free provider sends no auth header
    const [url, opts] = requestMock.mock.calls[0]!;
    expect(url).toBe("https://opencode.ai/zen/v1/models");
    expect((opts as { headers: Record<string, string> }).headers.authorization).toBeUndefined();
  });

  it("returns a structured error on a non-200 (never throws)", async () => {
    requestMock.mockResolvedValue(ok({}, 503));
    const res = await fetchModels(freeProvider());
    expect(res.ok).toBe(false);
    expect(res.models).toEqual([]);
    expect(res.error).toContain("503");
  });

  it("returns a structured error when the response body fails to parse", async () => {
    requestMock.mockResolvedValue({
      statusCode: 200,
      body: {
        json: async () => {
          throw new Error("ENOTFOUND");
        },
        text: async () => "",
        dump: async () => {},
      },
    });
    const res = await fetchModels(freeProvider());
    expect(res.ok).toBe(false);
    expect(res.error).toBe("ENOTFOUND");
  });
});

describe("vertex JWT assertion", () => {
  // a throwaway RSA key so signing actually runs (no network).
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const sa = { client_email: "svc@proj.iam.gserviceaccount.com", private_key: pem };

  it("builds a 3-part RS256 JWT with the right claims", () => {
    const jwt = _internal.buildAssertion(sa, 1_000_000);
    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);
    const header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString());
    const claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString());
    expect(header.alg).toBe("RS256");
    expect(claims.iss).toBe(sa.client_email);
    expect(claims.scope).toContain("cloud-platform");
    expect(claims.exp - claims.iat).toBe(3600);
  });

  it("loadServiceAccount rejects a file missing keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "vertex-"));
    const bad = join(dir, "sa.json");
    writeFileSync(bad, JSON.stringify({ client_email: "x" })); // no private_key
    expect(() => _internal.loadServiceAccount(bad)).toThrow(/private_key/);
  });
});

describe("VertexAuth.getToken — exchange, cache, refresh", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

  function writeSA(): string {
    const dir = mkdtempSync(join(tmpdir(), "vertex-"));
    const path = join(dir, "sa.json");
    writeFileSync(path, JSON.stringify({ client_email: "svc@p.iam.gserviceaccount.com", private_key: pem }));
    return path;
  }

  it("exchanges the JWT for an access token and caches it", async () => {
    requestMock.mockResolvedValue(ok({ access_token: "ya29.token", expires_in: 3600 }));
    let t = 1_000_000;
    const auth = new VertexAuth(writeSA(), () => t);

    expect(await auth.getToken()).toBe("ya29.token");
    // second call within TTL hits the cache, no new exchange
    expect(await auth.getToken()).toBe("ya29.token");
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("re-exchanges once the token nears expiry", async () => {
    requestMock
      .mockResolvedValueOnce(ok({ access_token: "first", expires_in: 3600 }))
      .mockResolvedValueOnce(ok({ access_token: "second", expires_in: 3600 }));
    let t = 1_000_000;
    const auth = new VertexAuth(writeSA(), () => t);

    expect(await auth.getToken()).toBe("first");
    t += 3600_000; // advance past expiry (minus skew)
    expect(await auth.getToken()).toBe("second");
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it("throws on a failed exchange", async () => {
    requestMock.mockResolvedValue(ok({ error: "invalid_grant" }, 400));
    const auth = new VertexAuth(writeSA(), () => 1_000_000);
    await expect(auth.getToken()).rejects.toThrow(/token exchange failed/);
  });
});
