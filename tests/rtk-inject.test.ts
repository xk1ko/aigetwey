import { describe, it, expect } from "vitest";
import { detectShape } from "../src/rtk/detect.js";
import { applyFilter } from "../src/rtk/filters.js";
import { compressMessages } from "../src/rtk/index.js";
import { buildInjection, injectInto } from "../src/inject/index.js";
import { cavemanPrompt } from "../src/inject/caveman.js";
import { ponytailPrompt } from "../src/inject/ponytail.js";
import type { CanonicalMessage, CanonicalRequest } from "../src/core/canonical.js";

describe("RTK detectShape", () => {
  it("detects a unified git diff", () => {
    expect(detectShape("diff --git a/x.ts b/x.ts\n@@ -1 +1 @@\n-old\n+new")).toBe("git-diff");
  });
  it("detects grep -n output", () => {
    expect(detectShape("src/a.ts:1:foo\nsrc/a.ts:2:bar\nsrc/b.ts:9:baz")).toBe("grep");
  });
  it("detects a tree listing", () => {
    expect(detectShape("root\n├── a\n└── b")).toBe("tree");
  });
  it("detects git status --porcelain", () => {
    expect(detectShape(" M src/a.ts\n?? new.ts")).toBe("git-status");
  });
  it("returns null for prose", () => {
    expect(detectShape("This is just a normal sentence with no structure.")).toBeNull();
  });
  it("returns null for empty input", () => {
    expect(detectShape("")).toBeNull();
  });
});

describe("RTK applyFilter", () => {
  it("caps matches per file in grep output", () => {
    const lines: string[] = [];
    for (let i = 1; i <= 30; i++) lines.push(`src/a.ts:${i}:match ${i}`);
    const out = applyFilter("grep", lines.join("\n"));
    expect(out).toContain("elided by rtk");
    expect(out.split("\n").length).toBeLessThan(30);
  });

  it("caps long listings", () => {
    const lines: string[] = [];
    for (let i = 0; i < 500; i++) lines.push(`./path/to/file_${i}.ts`);
    const out = applyFilter("find", lines.join("\n"));
    expect(out).toContain("elided by rtk");
  });

  it("truncates long diff hunks but keeps headers", () => {
    const lines = ["diff --git a/x b/x", "@@ -1,200 +1,200 @@"];
    for (let i = 0; i < 200; i++) lines.push(`+line ${i}`);
    const out = applyFilter("git-diff", lines.join("\n"));
    expect(out).toContain("diff --git a/x b/x");
    expect(out).toContain("@@ -1,200 +1,200 @@");
    expect(out).toContain("elided by rtk");
  });
});

describe("RTK compressMessages", () => {
  function toolMsg(content: string): CanonicalMessage {
    return { role: "tool", tool_call_id: "c1", content };
  }

  it("compresses a large grep tool result and reports stats", () => {
    const lines: string[] = [];
    for (let i = 1; i <= 50; i++) lines.push(`src/a.ts:${i}:hit ${i}`);
    const msgs: CanonicalMessage[] = [{ role: "user", content: "find foo" }, toolMsg(lines.join("\n"))];
    const stats = compressMessages(msgs);
    expect(stats.hits).toBe(1);
    expect(stats.bytesOut).toBeLessThan(stats.bytesIn);
    expect(stats.shapes).toContain("grep");
    expect(typeof msgs[1]!.content).toBe("string");
    expect((msgs[1]!.content as string).length).toBeLessThan(lines.join("\n").length);
  });

  it("leaves non-tool messages and prose untouched (no hits)", () => {
    const msgs: CanonicalMessage[] = [
      { role: "user", content: "diff --git a/x b/x\n@@ @@\n+lots" }, // diff but not a tool msg
      { role: "tool", tool_call_id: "c", content: "short answer, not a recognizable shape" },
    ];
    const before = JSON.stringify(msgs);
    const stats = compressMessages(msgs);
    expect(stats.hits).toBe(0);
    expect(JSON.stringify(msgs)).toBe(before);
  });

  it("never grows content (safety net): tiny matched output is kept as-is", () => {
    const msgs: CanonicalMessage[] = [{ role: "tool", tool_call_id: "c", content: "a.ts:1:x" }];
    const original = msgs[0]!.content;
    compressMessages(msgs);
    expect(msgs[0]!.content).toBe(original);
  });
});

describe("inject — prompts per level", () => {
  it("returns null for off, text otherwise", () => {
    expect(cavemanPrompt("off")).toBeNull();
    expect(ponytailPrompt("off")).toBeNull();
    expect(cavemanPrompt("full")).toBeTruthy();
    expect(ponytailPrompt("ultra")).toBeTruthy();
  });

  it("intensities differ", () => {
    expect(cavemanPrompt("lite")).not.toBe(cavemanPrompt("full"));
    expect(cavemanPrompt("full")).not.toBe(cavemanPrompt("ultra"));
  });
});

describe("inject — buildInjection stacking", () => {
  it("returns null when both off", () => {
    expect(buildInjection({ caveman: "off", ponytail: "off" })).toBeNull();
  });
  it("stacks both prompts when both on", () => {
    const text = buildInjection({ caveman: "full", ponytail: "full" })!;
    expect(text).toContain(cavemanPrompt("full")!);
    expect(text).toContain(ponytailPrompt("full")!);
  });
  it("includes only the active one", () => {
    const text = buildInjection({ caveman: "lite", ponytail: "off" })!;
    expect(text).toBe(cavemanPrompt("lite"));
  });
});

describe("inject — injectInto", () => {
  function req(): CanonicalRequest {
    return { model: "m", messages: [{ role: "user", content: "hi" }] };
  }

  it("prepends a leading system message", () => {
    const r = req();
    const did = injectInto(r, { caveman: "full", ponytail: "off" });
    expect(did).toBe(true);
    expect(r.messages[0]!.role).toBe("system");
    expect(r.messages[1]!.role).toBe("user");
  });

  it("does nothing when both toggles are off", () => {
    const r = req();
    const did = injectInto(r, { caveman: "off", ponytail: "off" });
    expect(did).toBe(false);
    expect(r.messages[0]!.role).toBe("user");
  });

  it("keeps the client's own system prompt separate (prepends before it)", () => {
    const r: CanonicalRequest = {
      model: "m",
      messages: [
        { role: "system", content: "client sys" },
        { role: "user", content: "hi" },
      ],
    };
    injectInto(r, { caveman: "full", ponytail: "off" });
    expect(r.messages[0]!.content).toContain("terse");
    expect(r.messages[1]!.content).toBe("client sys");
  });
});
