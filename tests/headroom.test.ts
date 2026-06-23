import { describe, it, expect } from "vitest";
import { validateConfig, setHeadroom } from "../src/config.js";
import { formatHeadroomLog } from "../src/headroom/compress.js";

function base() {
  return validateConfig({
    providers: [{ id: "oa", format: "openai", base_url: "https://oa.test/v1", api_key: "sk-oa" }],
  }).raw;
}

describe("headroom config", () => {
  it("endpoint carries a disabled headroom block by default", () => {
    const c = base();
    expect(c.endpoint.headroom).toEqual({
      enabled: false,
      url: "http://localhost:8787",
      compress_user_messages: false,
    });
  });

  it("setHeadroom toggles enabled + sets url + compress flag", () => {
    const c = setHeadroom(base(), { enabled: true, url: "http://localhost:9000", compress_user_messages: true });
    expect(c.endpoint.headroom).toEqual({
      enabled: true,
      url: "http://localhost:9000",
      compress_user_messages: true,
    });
  });

  it("setHeadroom blanks url back to the default", () => {
    const c = setHeadroom(base(), { url: "   " });
    expect(c.endpoint.headroom.url).toBe("http://localhost:8787");
  });

  it("setHeadroom leaves untouched fields alone", () => {
    const once = setHeadroom(base(), { enabled: true });
    const twice = setHeadroom(once, { compress_user_messages: true });
    expect(twice.endpoint.headroom.enabled).toBe(true);
    expect(twice.endpoint.headroom.url).toBe("http://localhost:8787");
  });
});

describe("formatHeadroomLog", () => {
  it("formats saved/before with a percentage", () => {
    expect(formatHeadroomLog({ tokens_before: 1000, tokens_after: 600, tokens_saved: 400 })).toBe(
      "saved 400 tokens / 1000 (40.0%) after=600",
    );
  });
  it("returns null for null stats", () => {
    expect(formatHeadroomLog(null)).toBeNull();
  });
});
