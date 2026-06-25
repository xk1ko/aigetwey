import { describe, it, expect, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { validateConfig, setServerKeyScope } from "../src/config.js";
import { registerV1Routes } from "../src/routes/v1.js";
import { GatewayState } from "../src/core/state.js";

let app: FastifyInstance;

/** A gateway with one key `friend-key` whose expiry is `expiresAt`. */
function buildState(expiresAt: number): GatewayState {
  const base = validateConfig({ server: { api_keys: ["friend-key"] }, providers: [], models: [] });
  const raw = setServerKeyScope(base.raw, 0, { expires: expiresAt });
  return new GatewayState("config.yaml", validateConfig(raw));
}

afterEach(async () => {
  if (app) await app.close();
});

describe("/v1 key expiry enforcement", () => {
  it("returns 403 key expired for an expired key", async () => {
    app = Fastify();
    registerV1Routes(app, buildState(Date.now() - 1));
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer friend-key", "content-type": "application/json" },
      payload: { model: "x", messages: [] },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "key expired" });
  });

  it("a non-expired key passes the expiry gate (does not 403 here)", async () => {
    app = Fastify();
    registerV1Routes(app, buildState(Date.now() + 60_000));
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer friend-key", "content-type": "application/json" },
      payload: { model: "x", messages: [] },
    });
    expect(res.statusCode).not.toBe(403); // routing/upstream may fail later, but NOT on expiry
  });
});
