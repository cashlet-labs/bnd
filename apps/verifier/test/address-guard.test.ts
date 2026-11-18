import { describe, expect, it } from "vitest";
import { isPublicAddress, resolvesToPublicAddresses } from "../src/address-guard.js";

describe("isPublicAddress", () => {
  it.each(["1.1.1.1", "8.8.8.8", "::ffff:1.1.1.1", "2606:4700:4700::1111", "2a01:4f8::1"])(
    "accepts %s",
    (ip) => {
      expect(isPublicAddress(ip)).toBe(true);
    },
  );

  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "192.0.2.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "64:ff9b::a00:1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "not an ip",
    "",
  ])("rejects %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });
});

describe("resolvesToPublicAddresses", () => {
  const fake = (answers: Record<string, string[]>) => async (host: string) => {
    const list = answers[host];
    if (!list) throw new Error("ENOTFOUND");
    return list.map((address) => ({ address }));
  };

  it("accepts a name with only public addresses", async () => {
    const resolve = fake({ "relay.example": ["1.1.1.1", "2606:4700:4700::1111"] });
    expect(await resolvesToPublicAddresses("wss://relay.example", resolve)).toBe(true);
  });

  it("rejects a name with any private address", async () => {
    const resolve = fake({ "relay.example": ["1.1.1.1", "10.0.0.5"] });
    expect(await resolvesToPublicAddresses("wss://relay.example", resolve)).toBe(false);
  });

  it("rejects a name that points at the cloud metadata address", async () => {
    const resolve = fake({ "evil.example": ["169.254.169.254"] });
    expect(await resolvesToPublicAddresses("wss://evil.example", resolve)).toBe(false);
  });

  it("rejects a name that does not resolve or has no answers", async () => {
    expect(await resolvesToPublicAddresses("wss://missing.example", fake({}))).toBe(false);
    expect(
      await resolvesToPublicAddresses("wss://empty.example", fake({ "empty.example": [] })),
    ).toBe(false);
  });

  it("rejects a malformed URL", async () => {
    expect(await resolvesToPublicAddresses("not a url", fake({}))).toBe(false);
  });
});
