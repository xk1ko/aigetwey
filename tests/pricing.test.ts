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

  it("resolves a vendor model from the auto-synced (models.dev) table", () => {
    const p = getPricingForModel(null, "claude-sonnet-4-5-20250929");
    expect(p?.input).toBe(3);
    expect(p?.output).toBe(15);
  });

  it("falls back to the hand table for a custom model not on models.dev", () => {
    const p = getPricingForModel(null, "oswe-vscode-prime");
    expect(p?.input).toBe(1);
    expect(p?.output).toBe(4);
  });
});

describe("cost from resolved pricing", () => {
  it("computes a non-zero cost from the table rate", () => {
    const p = getPricingForModel(null, "claude-opus-4-6")!;
    // 1M in + 1M out at 5/25 per 1M = $30
    expect(computeCost(1_000_000, 1_000_000, p.input, p.output)).toBeCloseTo(30, 5);
  });
});
