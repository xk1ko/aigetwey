import { describe, it, expect } from "vitest";
import { getPricingForModel } from "../src/providers/pricing.js";
import { computeCost } from "../src/db.js";

describe("getPricingForModel", () => {
  it("resolves a canonical model by exact id", () => {
    expect(getPricingForModel(null, "claude-opus-4-6")).toMatchObject({ input: 5, output: 25 });
  });

  it("strips a provider prefix before lookup", () => {
    expect(getPricingForModel("Huki", "Huki/claude-opus-4-6")).toMatchObject({ input: 5, output: 25 });
  });

  it("falls back to a glob pattern", () => {
    const p = getPricingForModel(null, "claude-opus-4-99");
    expect(p?.input).toBe(5);
    expect(p?.output).toBe(25);
  });

  it("returns null for an unknown model", () => {
    expect(getPricingForModel(null, "totally-made-up-model-xyz")).toBeNull();
  });
});

describe("cost from resolved pricing", () => {
  it("computes a non-zero cost from the table rate", () => {
    const p = getPricingForModel(null, "claude-opus-4-6")!;
    // 1M in + 1M out at 5/25 per 1M = $30
    expect(computeCost({ tokensIn: 1_000_000, tokensOut: 1_000_000, cachedTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0, priceIn: p.input, priceOut: p.output, priceCached: 0, priceCacheCreation: 0, priceReasoning: 0 })).toBeCloseTo(30, 5);
  });
});
