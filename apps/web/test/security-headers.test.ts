import { describe, expect, it } from "vitest";
import { nginxHeaders, parseRelayList, securityHeaders } from "../security-headers";

describe("securityHeaders", () => {
  it("allows a plain ws:// site relay explicitly, next to any wss: relay", () => {
    const csp = securityHeaders(["ws://127.0.0.1:7777"])["Content-Security-Policy"];
    expect(csp).toContain("connect-src 'self' ws://127.0.0.1:7777 wss:");
  });

  it("needs nothing extra for wss:// site relays", () => {
    const csp = securityHeaders(["wss://relay.septemlabs.com"])["Content-Security-Policy"];
    expect(csp).toContain("connect-src 'self' wss:;");
    expect(csp).not.toContain("relay.septemlabs.com");
  });

  it("keeps the strict policy", () => {
    const headers = securityHeaders([]);
    expect(headers["Content-Security-Policy"]).toBe(
      "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; " +
        "img-src 'self' data:; font-src 'self'; connect-src 'self' wss:; base-uri 'none'; " +
        "form-action 'none'; frame-ancestors 'none'; object-src 'none'",
    );
    expect(headers).toMatchObject({
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Opener-Policy": "same-origin",
    });
  });
});

describe("nginxHeaders", () => {
  it("writes one add_header line per header, sent on errors too", () => {
    expect(
      nginxHeaders({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" }),
    ).toBe(
      'add_header X-Content-Type-Options "nosniff" always;\nadd_header Referrer-Policy "no-referrer" always;',
    );
  });

  it("refuses values nginx would misread", () => {
    expect(() => nginxHeaders({ X: 'a"b' })).toThrow(/cannot be written/);
    expect(() => nginxHeaders({ X: "a\nb" })).toThrow(/cannot be written/);
  });
});

describe("parseRelayList", () => {
  it("splits, trims and drops empty entries, with a fallback", () => {
    expect(parseRelayList(" wss://a , ,wss://b ", [])).toEqual(["wss://a", "wss://b"]);
    expect(parseRelayList(undefined, ["ws://x"])).toEqual(["ws://x"]);
    expect(parseRelayList(" , ", ["ws://x"])).toEqual(["ws://x"]);
  });
});
