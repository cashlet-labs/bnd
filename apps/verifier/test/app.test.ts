import {
  createBinding,
  createKeySigner,
  createLoginResponse,
  createNostrKeySigner,
  createSuccessor,
  deriveBchKey,
  deriveNostrKey,
  type AuthChallenge,
  type BchProofType,
  type VerifiedBinding,
} from "@cashlet-labs/bnd-core";
import { publishBinding } from "@cashlet-labs/bnd-nostr";
import { afterEach, describe, expect, it } from "vitest";
import { startDevRelay, type DevRelay } from "../../dev-relay/src/server.js";
import type { LoginLogEntry } from "../src/app.js";
import { startVerifier, type RunningVerifier, type StartVerifierOptions } from "../src/server.js";

const MNEMONIC = "leader monkey parrot ring guide accident before fence cannon height naive bean";
const nostr = deriveNostrKey(MNEMONIC);
const bch = deriveBchKey(MNEMONIC);
const bch1 = deriveBchKey(MNEMONIC, 0, 1);
const thiefBch = deriveBchKey(MNEMONIC, 0, 20);
const nostrSigner = createNostrKeySigner(nostr.privateKey);
const bchSigner = createKeySigner(bch.privateKey);

let cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanup.map((fn) => fn()));
  cleanup = [];
});

interface Env {
  verifier: RunningVerifier;
  relays: DevRelay[];
  logs: LoginLogEntry[];
}

async function env(
  options: Partial<StartVerifierOptions> & { relayCount?: number; minComplete?: number } = {},
): Promise<Env> {
  const relays: DevRelay[] = [];
  for (let i = 0; i < (options.relayCount ?? 2); i++) {
    const relay = await startDevRelay();
    relays.push(relay);
    cleanup.push(() => relay.close());
  }
  const logs: LoginLogEntry[] = [];
  const verifier = await startVerifier({
    currency: {
      relays: relays.map((r) => r.url),
      minComplete: options.minComplete ?? 2,
      connectTimeoutMs: 500,
      timeoutMs: 2000,
    },
    log: (entry) => logs.push(entry),
    ...options,
  });
  cleanup.push(() => verifier.close());
  return { verifier, relays, logs };
}

async function bind(createdAt: number, key = bch): Promise<VerifiedBinding> {
  return createBinding({
    nostrSigner,
    bchSigner: createKeySigner(key.privateKey),
    bchKeyHash: key.keyHash,
    network: "chipnet",
    proofType: "message",
    createdAt,
  });
}

/** Replace `previous` with the second BCH key, approved by both previous keys. */
async function rotate(previous: VerifiedBinding, createdAt: number): Promise<VerifiedBinding> {
  return createSuccessor({
    previous: previous.event,
    nostrSigner,
    bchSigner: createKeySigner(bch1.privateKey),
    bchKeyHash: bch1.keyHash,
    network: "chipnet",
    proofType: "message",
    approvers: { bch: { signer: bchSigner, proofType: "message" } },
    createdAt,
  });
}

async function publish(binding: VerifiedBinding, relays: DevRelay[]): Promise<void> {
  const result = await publishBinding(binding.event, { relays: relays.map((r) => r.url) });
  if (!result.ok) throw new Error("publish failed");
}

async function getChallenge(base: string, level?: string): Promise<AuthChallenge> {
  const response = await fetch(`${base}/challenge${level ? `?level=${level}` : ""}`);
  expect(response.status).toBe(200);
  return (await response.json()) as AuthChallenge;
}

async function login(
  base: string,
  binding: VerifiedBinding,
  options: {
    level?: string;
    proofType?: BchProofType;
    headers?: Record<string, string>;
    bchKey?: typeof bch;
  } = {},
) {
  const challenge = await getChallenge(base, options.level);
  const body = await createLoginResponse({
    challenge,
    binding: binding.event,
    nostrSigner,
    bchSigner: options.bchKey ? createKeySigner(options.bchKey.privateKey) : bchSigner,
    ...(challenge.level === "dual" ? { proofType: options.proofType ?? "message" } : {}),
    expectedOrigin: base,
  });
  return fetch(`${base}/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base, ...options.headers },
    body: JSON.stringify(body),
  });
}

function sessionCookie(response: Response): string {
  const header = response.headers.get("set-cookie") ?? "";
  return header.split(";")[0]!;
}

describe("verifier: full login flow over real relays", () => {
  it.each(["message", "tx"] as const)(
    "logs in at the dual level with a %s proof",
    async (proofType) => {
      const { verifier, relays, logs } = await env();
      const binding = await bind(Math.floor(Date.now() / 1000) - 60);
      await publish(binding, relays);

      const response = await login(verifier.url, binding, { proofType });
      expect(response.status).toBe(200);
      const session = (await response.json()) as { identity: { npub: string }; level: string };
      expect(session.level).toBe("dual");
      expect(session).toMatchObject({ bchProofType: proofType });

      const cookie = sessionCookie(response);
      const me = await fetch(`${verifier.url}/me`, { headers: { cookie } });
      expect(me.status).toBe(200);
      expect(((await me.json()) as { identity: { bindingId: string } }).identity.bindingId).toBe(
        binding.bindingId,
      );
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ event: "login", ok: true, level: "dual", proofType });
    },
  );

  it("logs in at the nostr level when asked", async () => {
    const { verifier, relays } = await env();
    const binding = await bind(Math.floor(Date.now() / 1000) - 60);
    await publish(binding, relays);
    const response = await login(verifier.url, binding, { level: "nostr" });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { level: string }).level).toBe("nostr");
  });

  it("issues dual challenges by default", async () => {
    const { verifier } = await env();
    const challenge = await getChallenge(verifier.url);
    expect(challenge.level).toBe("dual");
    expect(challenge.audience).toBe(`${verifier.url}/login`);
  });

  it("refuses a binding that is not published", async () => {
    const { verifier, logs } = await env();
    const response = await login(verifier.url, await bind(Math.floor(Date.now() / 1000) - 60));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "binding is not current: binding is not published on any relay that answered",
    });
    expect(logs[0]).toMatchObject({ ok: false });
    expect(logs[0]?.npub).toBeUndefined();
  });

  it("refuses an old binding once a successor is published", async () => {
    const { verifier, relays } = await env();
    const now = Math.floor(Date.now() / 1000);
    const old = await bind(now - 120);
    await publish(old, [relays[0]!]);
    await publish(await rotate(old, now - 60), [relays[1]!]);
    const response = await login(verifier.url, old);
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: string }).error).toBe(
      "binding is not current: a newer binding replaces this one",
    );
  });

  describe("pinning", () => {
    it("refuses a thief's binding that replaced the real one on every relay", async () => {
      const { verifier, relays } = await env();
      const now = Math.floor(Date.now() / 1000);
      const real = await bind(now - 120);
      await publish(real, relays);
      expect((await login(verifier.url, real)).status).toBe(200);
      // With the Nostr key alone, the thief publishes a newer first binding to
      // their own BCH key. Relays keep the newest, so the real one is gone.
      const fake = await bind(now - 60, thiefBch);
      await publish(fake, relays);
      const response = await login(verifier.url, fake, { bchKey: thiefBch });
      expect(response.status).toBe(401);
      expect(((await response.json()) as { error: string }).error).toBe(
        "binding is not current: this binding does not continue the one this service accepted before for the same key",
      );
    });

    it("without pins, the same attack succeeds: pins are what stop it", async () => {
      const { verifier, relays } = await env({ pinStore: false });
      const now = Math.floor(Date.now() / 1000);
      const real = await bind(now - 120);
      await publish(real, relays);
      expect((await login(verifier.url, real)).status).toBe(200);
      const fake = await bind(now - 60, thiefBch);
      await publish(fake, relays);
      expect((await login(verifier.url, fake, { bchKey: thiefBch })).status).toBe(200);
    });

    it("accepts a successor of the pinned binding", async () => {
      const { verifier, relays } = await env();
      const now = Math.floor(Date.now() / 1000);
      const first = await bind(now - 120);
      await publish(first, relays);
      expect((await login(verifier.url, first)).status).toBe(200);
      const next = await rotate(first, now - 60);
      await publish(next, relays);
      expect((await login(verifier.url, next, { bchKey: bch1 })).status).toBe(200);
    });
  });

  it("refuses when too few relays answer", async () => {
    const { verifier, relays } = await env();
    const binding = await bind(Math.floor(Date.now() / 1000) - 60);
    await publish(binding, relays);
    await relays[1]!.close();
    const response = await login(verifier.url, binding);
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: string }).error).toBe(
      "binding is not current: could not check: 1 of the required 2 relays answered",
    );
  });

  it("works with one relay when configured for one", async () => {
    const { verifier, relays } = await env({ relayCount: 1, minComplete: 1 });
    const binding = await bind(Math.floor(Date.now() / 1000) - 60);
    await publish(binding, relays);
    expect((await login(verifier.url, binding)).status).toBe(200);
  });

  it("refuses to replay a login", async () => {
    const { verifier, relays } = await env();
    const binding = await bind(Math.floor(Date.now() / 1000) - 60);
    await publish(binding, relays);
    const challenge = await getChallenge(verifier.url);
    const body = JSON.stringify(
      await createLoginResponse({
        challenge,
        binding: binding.event,
        nostrSigner,
        bchSigner,
        proofType: "message",
      }),
    );
    const post = () =>
      fetch(`${verifier.url}/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
    expect((await post()).status).toBe(200);
    const again = await post();
    expect(again.status).toBe(401);
    expect(await again.json()).toEqual({ error: "unknown or expired challenge" });
  });
});

describe("verifier: sessions and cookies", () => {
  async function loggedIn(level?: string) {
    const e = await env();
    const binding = await bind(Math.floor(Date.now() / 1000) - 60);
    await publish(binding, e.relays);
    const response = await login(e.verifier.url, binding, level ? { level } : {});
    return { ...e, response, cookie: sessionCookie(response), binding };
  }

  it("sets an HttpOnly, SameSite=Strict cookie scoped to the site", async () => {
    const { response } = await loggedIn();
    const header = response.headers.get("set-cookie") ?? "";
    expect(header).toMatch(/^bnd_session=[0-9a-f]{64}; /);
    expect(header).toContain("Path=/");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Strict");
    expect(header).toContain("Max-Age=28800");
    expect(header).not.toContain("Domain");
  });

  it("uses the __Host- prefix and Secure on https", async () => {
    const { relays } = await env({ relayCount: 1, minComplete: 1 });
    const verifier = await startVerifier({
      publicUrl: "https://app.example",
      currency: { relays: relays.map((r) => r.url), minComplete: 1 },
      log: false,
    });
    cleanup.push(() => verifier.close());
    const binding = await bind(Math.floor(Date.now() / 1000) - 60);
    await publish(binding, relays);
    // The service believes it is https://app.example; requests reach it directly.
    const port = (verifier.server.address() as { port: number }).port;
    const direct = `http://127.0.0.1:${port}`;
    const challenge = (await (await fetch(`${direct}/challenge`)).json()) as AuthChallenge;
    expect(challenge.audience).toBe("https://app.example/login");
    const body = await createLoginResponse({
      challenge,
      binding: binding.event,
      nostrSigner,
      bchSigner,
      proofType: "message",
    });
    const response = await fetch(`${direct}/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://app.example" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    const header = response.headers.get("set-cookie") ?? "";
    expect(header).toMatch(/^__Host-bnd_session=[0-9a-f]{64}; Path=\/; /);
    expect(header).toContain("Secure");
  });

  it("issues a new session ID at every login", async () => {
    const { verifier, cookie, binding } = await loggedIn();
    const second = await login(verifier.url, binding, { headers: { cookie } });
    expect(second.status).toBe(200);
    const newCookie = sessionCookie(second);
    expect(newCookie).not.toBe(cookie);
    expect((await fetch(`${verifier.url}/me`, { headers: { cookie } })).status).toBe(401);
    expect((await fetch(`${verifier.url}/me`, { headers: { cookie: newCookie } })).status).toBe(
      200,
    );
  });

  it("ends the session at logout", async () => {
    const { verifier, cookie } = await loggedIn();
    const out = await fetch(`${verifier.url}/logout`, {
      method: "POST",
      headers: { cookie, origin: verifier.url },
    });
    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await fetch(`${verifier.url}/me`, { headers: { cookie } })).status).toBe(401);
  });

  it("refuses /me without a session", async () => {
    const { verifier } = await env();
    const response = await fetch(`${verifier.url}/me`);
    expect(response.status).toBe(401);
    expect(
      (await fetch(`${verifier.url}/me`, { headers: { cookie: "bnd_session=" + "ab".repeat(32) } }))
        .status,
    ).toBe(401);
  });

  it("asks a nostr-level session to log in with both keys for a dual-only action", async () => {
    const { verifier, cookie } = await loggedIn("nostr");
    const response = await fetch(`${verifier.url}/me?require=dual`, { headers: { cookie } });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "this needs a login with both keys" });
    expect((await fetch(`${verifier.url}/me?require=nostr`, { headers: { cookie } })).status).toBe(
      200,
    );
  });

  it("accepts a dual session for a dual-only action", async () => {
    const { verifier, cookie } = await loggedIn();
    expect((await fetch(`${verifier.url}/me?require=dual`, { headers: { cookie } })).status).toBe(
      200,
    );
  });

  it("logs a shortened npub and nothing secret", async () => {
    const { logs } = await loggedIn();
    const entry = logs[0]!;
    expect(entry.npub).toMatch(/^npub1.{7}….{6}$/);
    expect(Object.keys(entry).sort()).toEqual([
      "event",
      "level",
      "npub",
      "ok",
      "proofType",
      "time",
    ]);
  });
});

describe("verifier: request handling", () => {
  it("refuses a cross-origin POST", async () => {
    const { verifier } = await env();
    const response = await fetch(`${verifier.url}/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: "{}",
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("refuses the wrong content type, bad JSON and large bodies", async () => {
    const { verifier } = await env();
    const post = (body: string, type = "application/json") =>
      fetch(`${verifier.url}/login`, { method: "POST", headers: { "content-type": type }, body });
    expect((await post("{}", "text/plain")).status).toBe(415);
    expect((await post("{not json")).status).toBe(400);
    expect((await post(`"${"x".repeat(70_000)}"`)).status).toBe(413);
    const malformed = await post("{}");
    expect(malformed.status).toBe(401);
  });

  it("refuses an unknown level", async () => {
    const { verifier } = await env();
    expect((await fetch(`${verifier.url}/challenge?level=bch`)).status).toBe(400);
  });

  it("refuses a level the operator turned off", async () => {
    const { verifier } = await env({ levels: ["dual"] });
    expect((await fetch(`${verifier.url}/challenge?level=nostr`)).status).toBe(400);
  });

  it("rate-limits challenges per client", async () => {
    const { verifier } = await env({ challengesPerMinute: 3 });
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await fetch(`${verifier.url}/challenge`)).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it("ignores a client-sent address header unless told to trust one", async () => {
    const { verifier } = await env({ challengesPerMinute: 2 });
    const statuses = [];
    for (let i = 0; i < 3; i++) {
      const headers = { "X-Real-Ip": `203.0.113.${i}` };
      statuses.push((await fetch(`${verifier.url}/challenge`, { headers })).status);
    }
    expect(statuses).toEqual([200, 200, 429]);
  });

  it("limits per address from a trusted proxy header", async () => {
    const { verifier } = await env({ challengesPerMinute: 2, clientIpHeader: "X-Real-Ip" });
    const ask = async (ip?: string) =>
      (await fetch(`${verifier.url}/challenge`, ip ? { headers: { "x-real-ip": ip } } : {})).status;
    expect([await ask("203.0.113.1"), await ask("203.0.113.1"), await ask("203.0.113.1")]).toEqual([
      200, 200, 429,
    ]);
    expect(await ask("203.0.113.2")).toBe(200);
    // Without the header, the connection's address is used.
    expect([await ask(), await ask(), await ask()]).toEqual([200, 200, 429]);
  });

  it("answers unknown routes and methods with 404", async () => {
    const { verifier } = await env();
    expect((await fetch(`${verifier.url}/health`)).status).toBe(404);
    expect((await fetch(`${verifier.url}/login`)).status).toBe(404);
    expect((await fetch(`${verifier.url}/challenge`, { method: "POST" })).status).toBe(404);
  });

  it("sends no-store and nosniff headers", async () => {
    const { verifier } = await env();
    const response = await fetch(`${verifier.url}/challenge`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("can turn logging off", async () => {
    const { verifier, relays } = await env({ relayCount: 1, minComplete: 1, log: false });
    const binding = await bind(Math.floor(Date.now() / 1000) - 60);
    await publish(binding, relays);
    expect((await login(verifier.url, binding)).status).toBe(200);
  });

  it("rejects an invalid public URL", () => {
    return expect(
      startVerifier({ publicUrl: "ftp://x", currency: false, log: false }),
    ).rejects.toThrow(TypeError);
  });
});
