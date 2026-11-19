import { afterEach, describe, expect, it, vi } from "vitest";

async function load(env: Record<string, string>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  return import("../src/relays");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("site relays", () => {
  it("default to the local demo relay", async () => {
    const relays = await load({ VITE_RELAYS: "", VITE_RELAYS_LABEL: "" });
    expect(relays.SITE_RELAYS).toEqual(["ws://127.0.0.1:7777"]);
    expect(relays.SITE_RELAYS_LABEL).toBe("Local demo relay");
    // A phone signer cannot reach a loopback relay, so NIP-46 gets public ones only.
    expect(relays.NOSTR_CONNECT_RELAYS).toEqual(["wss://relay.damus.io", "wss://nos.lol"]);
  });

  it("come from VITE_RELAYS and VITE_RELAYS_LABEL, and go first everywhere", async () => {
    const relays = await load({
      VITE_RELAYS: " wss://relay.septemlabs.com , wss://relay.bongacash.co.ke,",
      VITE_RELAYS_LABEL: "Cashlet relays",
    });
    expect(relays.SITE_RELAYS).toEqual([
      "wss://relay.septemlabs.com",
      "wss://relay.bongacash.co.ke",
    ]);
    expect(relays.SITE_RELAYS_LABEL).toBe("Cashlet relays");
    expect(relays.NOSTR_CONNECT_RELAYS).toEqual([
      "wss://relay.septemlabs.com",
      "wss://relay.bongacash.co.ke",
      "wss://relay.damus.io",
      "wss://nos.lol",
    ]);
    const both = relays.selectedRelays({ site: true, public: true });
    expect(both.slice(0, 2)).toEqual(["wss://relay.septemlabs.com", "wss://relay.bongacash.co.ke"]);
    expect(both.length).toBe(2 + relays.PUBLIC_RELAYS.length);
    expect(relays.selectedRelays({ site: true, public: false })).toEqual(relays.SITE_RELAYS);
    expect(relays.selectedRelays({ site: false, public: false })).toEqual([]);
  });

  it("lists a relay once when it is both a site and a public relay", async () => {
    const relays = await load({ VITE_RELAYS: "wss://nos.lol" });
    const both = relays.selectedRelays({ site: true, public: true });
    expect(both.filter((url) => url === "wss://nos.lol")).toHaveLength(1);
    expect(relays.NOSTR_CONNECT_RELAYS.filter((url) => url === "wss://nos.lol")).toHaveLength(1);
  });
});
