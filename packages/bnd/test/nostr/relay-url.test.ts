import { describe, expect, it } from "vitest";
import { isSafeRelayUrl, normalizeRelayUrl } from "../../src/nostr/relay-url.js";

describe("isSafeRelayUrl", () => {
  it.each(["wss://nos.lol", "wss://relay.example.com/", "wss://relay.example.com:8443/nostr"])(
    "accepts %s",
    (url) => {
      expect(isSafeRelayUrl(url)).toBe(true);
    },
  );

  it.each([
    ["plain ws", "ws://relay.example.com"],
    ["http", "https://relay.example.com"],
    ["an IPv4 address", "wss://10.0.0.1"],
    ["a loopback address", "wss://127.0.0.1:7777"],
    ["an IPv6 address", "wss://[::1]"],
    ["localhost", "wss://localhost"],
    ["a localhost subdomain", "wss://relay.localhost"],
    ["a single-label host", "wss://intranet"],
    ["a .local name", "wss://printer.local"],
    ["a .internal name", "wss://metadata.google.internal"],
    ["a home.arpa name", "wss://nas.home.arpa"],
    ["credentials", "wss://user:pass@relay.example.com"],
    ["a query", "wss://relay.example.com/?x=1"],
    ["a fragment", "wss://relay.example.com/#x"],
    ["a trailing dot", "wss://relay.example.com."],
    ["garbage", "not a url"],
    ["an empty string", ""],
    ["a very long URL", `wss://${"a".repeat(250)}.com`],
    ["a number", 5],
  ])("rejects %s", (_name, url) => {
    expect(isSafeRelayUrl(url)).toBe(false);
  });

  it("rejects an IPv4 address written as a decimal number", () => {
    // URL parsing turns this into 127.0.0.1.
    expect(isSafeRelayUrl("wss://2130706433")).toBe(false);
  });
});

describe("normalizeRelayUrl", () => {
  it("drops a trailing slash and lowercases the host", () => {
    expect(normalizeRelayUrl("wss://Relay.Example.com/")).toBe("wss://relay.example.com");
    expect(normalizeRelayUrl("wss://relay.example.com/nostr/")).toBe(
      "wss://relay.example.com/nostr",
    );
    expect(normalizeRelayUrl("ws://127.0.0.1:7777")).toBe("ws://127.0.0.1:7777");
  });
});
