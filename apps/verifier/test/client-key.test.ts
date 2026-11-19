import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { clientKeyFor } from "../src/app.js";

function request(remoteAddress: string, headers: Record<string, string | string[]> = {}) {
  return { socket: { remoteAddress }, headers } as unknown as IncomingMessage;
}

describe("clientKeyFor", () => {
  it("never returns the address itself", () => {
    const key = clientKeyFor(undefined)(request("203.0.113.7"));
    expect(key).not.toContain("203.0.113.7");
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("gives the same address the same key, and other addresses other keys", () => {
    const keyOf = clientKeyFor(undefined);
    expect(keyOf(request("203.0.113.7"))).toBe(keyOf(request("203.0.113.7")));
    expect(keyOf(request("203.0.113.7"))).not.toBe(keyOf(request("203.0.113.8")));
  });

  it("uses a new secret for each verifier, so keys cannot be matched across runs", () => {
    expect(clientKeyFor(undefined)(request("203.0.113.7"))).not.toBe(
      clientKeyFor(undefined)(request("203.0.113.7")),
    );
  });

  it("reads the trusted header, case-insensitively, and its first value", () => {
    const keyOf = clientKeyFor("X-Real-Ip");
    const direct = clientKeyFor(undefined);
    expect(keyOf(request("10.0.0.1", { "x-real-ip": " 203.0.113.7 " }))).toBe(
      keyOf(request("10.0.0.2", { "x-real-ip": "203.0.113.7" })),
    );
    expect(keyOf(request("10.0.0.1", { "x-real-ip": ["203.0.113.7", "x"] }))).toBe(
      keyOf(request("10.0.0.3", { "x-real-ip": "203.0.113.7" })),
    );
    // An empty or missing header falls back to the connection's address.
    expect(keyOf(request("10.0.0.1", { "x-real-ip": "" }))).toBe(keyOf(request("10.0.0.1")));
    expect(direct(request("10.0.0.1", { "x-real-ip": "203.0.113.7" }))).toBe(
      direct(request("10.0.0.1")),
    );
  });
});
