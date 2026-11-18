import { describe, expect, it } from "vitest";

describe("toolchain", () => {
  it("runs TypeScript tests", () => {
    expect(1 + 1).toBe(2);
  });

  it("has Web Crypto available", async () => {
    const digest = await crypto.subtle.digest("SHA-256", new Uint8Array());
    expect(digest.byteLength).toBe(32);
  });
});
