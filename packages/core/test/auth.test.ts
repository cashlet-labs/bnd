import { sha256 } from "@noble/hashes/sha2.js";
import { describe, expect, it } from "vitest";
import { createKeySigner, proveBchControl, type BchSigner } from "../src/bch-proof.js";
import {
  AUTH_EVENT_KIND,
  authEventTemplate,
  authStatement,
  checkLoginResponse,
  createLoginResponse,
  issueChallenge,
  parseChallenge,
  verifyLogin,
  type AuthChallenge,
  type AuthLevel,
  type LoginResponse,
} from "../src/auth.js";
import { createBinding, createNostrKeySigner, type VerifiedBinding } from "../src/binding-event.js";
import { bytesToHex } from "../src/bytes.js";
import { ChallengeStoreFullError, MemoryChallengeStore } from "../src/challenge-store.js";
import { signEvent } from "../src/event.js";
import { deriveBchKey, deriveNostrKey } from "../src/keys.js";
import { npubEncode } from "../src/npub.js";
import { bindingTxCommitment } from "../src/tx-proof.js";

const MNEMONIC = "leader monkey parrot ring guide accident before fence cannon height naive bean";
const nostrKey = deriveNostrKey(MNEMONIC);
const otherNostr = deriveNostrKey(MNEMONIC, 1);
const bchKey = deriveBchKey(MNEMONIC);
const otherBch = deriveBchKey(MNEMONIC, 0, 1);

const AUDIENCE = "https://app.example/login";
const T0 = 1_700_000_000;

const nostrSigner = createNostrKeySigner(nostrKey.privateKey);
const bchSigner = createKeySigner(bchKey.privateKey);

let binding: VerifiedBinding;
async function getBinding(): Promise<VerifiedBinding> {
  binding ??= await createBinding({
    nostrSigner,
    bchSigner,
    bchKeyHash: bchKey.keyHash,
    network: "chipnet",
    proofType: "message",
    createdAt: T0 - 1000,
  });
  return binding;
}

function setup(level: AuthLevel = "dual") {
  let clock = T0;
  const store = new MemoryChallengeStore({ now: () => clock });
  return {
    store,
    level,
    setClock: (t: number) => void (clock = t),
    now: () => clock,
    issue: () => issueChallenge(store, { audience: AUDIENCE, level, now: clock }),
  };
}

async function respond(
  challenge: AuthChallenge,
  proofType: "message" | "tx" = "message",
  now: () => number = () => T0,
): Promise<LoginResponse> {
  const b = await getBinding();
  return createLoginResponse({
    challenge,
    binding: b.event,
    nostrSigner,
    bchSigner,
    proofType,
    now,
  });
}

describe("authStatement", () => {
  it("builds the exact text", async () => {
    const b = await getBinding();
    const challenge: AuthChallenge = {
      nonce: "ab".repeat(32),
      audience: AUDIENCE,
      level: "dual",
      issuedAt: T0,
      expiresAt: T0 + 300,
    };
    const statement = authStatement(challenge, b.record);
    expect(statement.text).toBe(
      [
        "bnd/1/auth",
        "audience: https://app.example/login",
        "level: dual",
        `nonce: ${"ab".repeat(32)}`,
        `binding: ${b.bindingId}`,
        `nostr: ${nostrKey.publicKey}`,
        `bch: ${b.bch.address}`,
        `issued: ${T0}`,
        `expires: ${T0 + 300}`,
      ].join("\n"),
    );
    expect(statement.digest).toBe(bytesToHex(sha256(new TextEncoder().encode(statement.text))));
  });

  it("changes when any field changes", async () => {
    const b = await getBinding();
    const base: AuthChallenge = {
      nonce: "ab".repeat(32),
      audience: AUDIENCE,
      level: "dual",
      issuedAt: T0,
      expiresAt: T0 + 300,
    };
    const digests = new Set([
      authStatement(base, b.record).digest,
      authStatement({ ...base, nonce: "cd".repeat(32) }, b.record).digest,
      authStatement({ ...base, audience: "https://other.example/login" }, b.record).digest,
      authStatement({ ...base, level: "nostr" }, b.record).digest,
      authStatement({ ...base, issuedAt: T0 + 1 }, b.record).digest,
      authStatement({ ...base, expiresAt: T0 + 301 }, b.record).digest,
    ]);
    expect(digests.size).toBe(6);
  });

  it("uses a different transaction commitment from a binding proof", async () => {
    const b = await getBinding();
    const challenge = await setup().issue();
    const login = authStatement(challenge, b.record).commitment;
    const bind = bindingTxCommitment(b.record);
    expect(login.tag).not.toBe(bind.tag);
    expect(login.outpointDomain).not.toBe(bind.outpointDomain);
    expect(bytesToHex(login.digest)).not.toBe(bytesToHex(bind.digest));
    expect(login.prompt.length).toBeLessThanOrEqual(200);
    expect(login.prompt).toContain("app.example");
  });
});

describe("parseChallenge", () => {
  const valid = {
    nonce: "ab".repeat(32),
    audience: AUDIENCE,
    level: "dual",
    issuedAt: T0,
    expiresAt: T0 + 300,
  };

  it("accepts a valid challenge", () => {
    expect(parseChallenge(valid)).toEqual(valid);
  });

  it.each([
    ["an extra member", { ...valid, extra: 1 }],
    ["a missing member", { ...valid, level: undefined }],
    ["a short nonce", { ...valid, nonce: "ab" }],
    ["an uppercase nonce", { ...valid, nonce: "AB".repeat(32) }],
    ["a non-http audience", { ...valid, audience: "ftp://app.example/login" }],
    ["an audience with whitespace", { ...valid, audience: "https://app.example/lo gin" }],
    ["an audience with a newline", { ...valid, audience: "https://app.example/\nx" }],
    ["an audience with a fragment", { ...valid, audience: "https://app.example/login#x" }],
    ["an unknown level", { ...valid, level: "bch" }],
    ["an expiry before the issue time", { ...valid, expiresAt: T0 }],
    ["fractional times", { ...valid, issuedAt: 1.5 }],
    ["null", null],
    ["an array", []],
  ])("rejects %s", (_name, value) => {
    expect(() => parseChallenge(value)).toThrow(TypeError);
  });
});

describe("issueChallenge and MemoryChallengeStore", () => {
  it("issues a stored challenge with a five minute life", async () => {
    const env = setup();
    const challenge = await env.issue();
    expect(challenge.expiresAt - challenge.issuedAt).toBe(300);
    expect(env.store.get(challenge.nonce)).toEqual(challenge);
    expect(challenge.level).toBe("dual");
  });

  it("issues unique nonces", async () => {
    const env = setup();
    const nonces = new Set(
      (await Promise.all([1, 2, 3, 4, 5].map(() => env.issue()))).map((c) => c.nonce),
    );
    expect(nonces.size).toBe(5);
  });

  it("forgets an expired challenge", async () => {
    const env = setup();
    const challenge = await env.issue();
    env.setClock(T0 + 301);
    expect(env.store.get(challenge.nonce)).toBeUndefined();
    expect(env.store.consume(challenge.nonce)).toBe(false);
  });

  it("consumes a challenge exactly once", async () => {
    const env = setup();
    const challenge = await env.issue();
    expect(env.store.consume(challenge.nonce)).toBe(true);
    expect(env.store.consume(challenge.nonce)).toBe(false);
  });

  it("discards a challenge after too many failed attempts", async () => {
    const env = setup();
    const challenge = await env.issue();
    for (let i = 0; i < 4; i++) env.store.fail(challenge.nonce);
    expect(env.store.get(challenge.nonce)).toBeDefined();
    env.store.fail(challenge.nonce);
    expect(env.store.get(challenge.nonce)).toBeUndefined();
  });

  it("refuses new challenges when full and recovers as they expire", async () => {
    let clock = T0;
    const store = new MemoryChallengeStore({ maxOutstanding: 2, now: () => clock });
    await issueChallenge(store, { audience: AUDIENCE, level: "nostr", now: clock });
    await issueChallenge(store, { audience: AUDIENCE, level: "nostr", now: clock });
    await expect(
      issueChallenge(store, { audience: AUDIENCE, level: "nostr", now: clock }),
    ).rejects.toThrow(ChallengeStoreFullError);
    clock = T0 + 301;
    expect(store.size).toBe(0);
    await expect(
      issueChallenge(store, { audience: AUDIENCE, level: "nostr", now: clock }),
    ).resolves.toBeDefined();
  });

  it("rejects an invalid audience when issuing", async () => {
    await expect(
      issueChallenge(new MemoryChallengeStore(), { audience: "not a url", level: "dual" }),
    ).rejects.toThrow(TypeError);
  });
});

describe("login: successful flows", () => {
  const cases: [string, AuthLevel, "message" | "tx"][] = [
    ["nostr level", "nostr", "message"],
    ["dual level with a message proof", "dual", "message"],
    ["dual level with a transaction proof", "dual", "tx"],
  ];

  for (const [name, level, proofType] of cases) {
    it(`accepts ${name}`, async () => {
      const env = setup(level);
      const challenge = await env.issue();
      const response = await respond(challenge, proofType);
      const result = await verifyLogin(env.store, response, { now: env.now() });
      expect(result).toMatchObject({ ok: true, level });
      if (!result.ok) return;
      const b = await getBinding();
      expect(result.identity).toEqual({
        nostrPublicKey: nostrKey.publicKey,
        npub: npubEncode(nostrKey.publicKey),
        bch: b.bch,
        bindingId: b.bindingId,
      });
      expect(result.bchProofType).toBe(level === "dual" ? proofType : undefined);
      expect(response.bchProof === undefined).toBe(level === "nostr");
    });
  }

  it("produces a NIP-98 shaped Nostr event", async () => {
    const env = setup("nostr");
    const challenge = await env.issue();
    const { event } = await respond(challenge);
    expect(event.kind).toBe(AUTH_EVENT_KIND);
    expect(event.content).toBe("");
    expect(event.tags[0]).toEqual(["u", AUDIENCE]);
    expect(event.tags[1]).toEqual(["method", "POST"]);
    expect(event.tags.map((t) => t[0])).toEqual([
      "u",
      "method",
      "challenge",
      "binding",
      "statement",
    ]);
  });

  it("works with a response that went through JSON", async () => {
    const env = setup();
    const challenge = await env.issue();
    const response = JSON.parse(JSON.stringify(await respond(challenge, "tx"))) as unknown;
    expect((await verifyLogin(env.store, response, { now: env.now() })).ok).toBe(true);
  });

  it("works without an options argument", async () => {
    const store = new MemoryChallengeStore();
    const challenge = await issueChallenge(store, { audience: AUDIENCE, level: "nostr" });
    const response = await createLoginResponse({
      challenge,
      binding: (await getBinding()).event,
      nostrSigner,
    });
    expect((await verifyLogin(store, response)).ok).toBe(true);
  });
});

describe("login: replay and races", () => {
  it("rejects a second use of the same response", async () => {
    const env = setup();
    const response = await respond(await env.issue());
    expect((await verifyLogin(env.store, response, { now: env.now() })).ok).toBe(true);
    expect(await verifyLogin(env.store, response, { now: env.now() })).toEqual({
      ok: false,
      reason: "unknown or expired challenge",
    });
  });

  it("lets exactly one of two simultaneous attempts succeed", async () => {
    const env = setup();
    const response = await respond(await env.issue());
    const results = await Promise.all([
      verifyLogin(env.store, response, { now: env.now() }),
      verifyLogin(env.store, response, { now: env.now() }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("reports the race loser as already used when the store is shared", async () => {
    const env = setup();
    const response = await respond(await env.issue());
    // A store whose consume loses the race after the checks passed.
    const racing = {
      put: env.store.put.bind(env.store),
      get: env.store.get.bind(env.store),
      fail: env.store.fail.bind(env.store),
      consume: () => false,
    };
    expect(await verifyLogin(racing, response, { now: env.now() })).toEqual({
      ok: false,
      reason: "challenge already used",
    });
  });

  it("rejects a response after the challenge expired", async () => {
    const env = setup();
    const response = await respond(await env.issue());
    env.setClock(T0 + 400);
    expect(await verifyLogin(env.store, response, { now: env.now() })).toEqual({
      ok: false,
      reason: "unknown or expired challenge",
    });
  });

  it("rejects a response for a challenge this server never issued", async () => {
    const issuer = setup();
    const response = await respond(await issuer.issue());
    const other = setup();
    expect((await verifyLogin(other.store, response, { now: T0 })).ok).toBe(false);
  });

  it("limits repeated failed attempts", async () => {
    const env = setup();
    const challenge = await env.issue();
    const good = await respond(challenge);
    const bad: LoginResponse = { ...good, event: { ...good.event, sig: "00".repeat(64) } };
    for (let i = 0; i < 5; i++) {
      expect((await verifyLogin(env.store, bad, { now: env.now() })).ok).toBe(false);
    }
    expect(await verifyLogin(env.store, good, { now: env.now() })).toEqual({
      ok: false,
      reason: "unknown or expired challenge",
    });
  });
});

describe("login: rejections", () => {
  async function failure(env: ReturnType<typeof setup>, response: unknown, now = env.now()) {
    const result = await verifyLogin(env.store, response, { now });
    expect(result.ok).toBe(false);
    return (result as { reason: string }).reason;
  }

  it("rejects a login event time that is too old or too new", async () => {
    const env = setup("nostr");
    const challenge = await env.issue();
    const good = await respond(challenge);
    const record = (await getBinding()).record;
    for (const offset of [-61, 61, 3600]) {
      const event = signEvent(
        nostrKey.privateKey,
        authEventTemplate(challenge, record, T0 + offset),
      );
      expect(await failure(env, { ...good, event })).toBe(
        "login event time is too far from the current time",
      );
    }
  });

  it("rejects a client whose clock is far off before it sends anything", async () => {
    const env = setup();
    const challenge = await env.issue();
    await expect(respond(challenge, "message", () => T0 - 100)).rejects.toThrow(
      "login event is older than the challenge",
    );
  });

  it("accepts an event within the 60 second window", async () => {
    const env = setup();
    const challenge = await env.issue();
    const response = await respond(challenge, "message", () => T0 + 59);
    expect((await verifyLogin(env.store, response, { now: T0 })).ok).toBe(true);
  });

  it("rejects an event signed by a key other than the bound one", async () => {
    const env = setup("nostr");
    const challenge = await env.issue();
    const good = await respond(challenge);
    const b = await getBinding();
    const forged = signEvent(otherNostr.privateKey, authEventTemplate(challenge, b.record, T0));
    expect(await failure(env, { ...good, event: forged })).toBe(
      "login event was not signed by the bound Nostr key",
    );
  });

  it("rejects an event that names another audience, binding or statement", async () => {
    const env = setup("nostr");
    const challenge = await env.issue();
    const good = await respond(challenge);
    for (const [index, value] of [
      [0, "https://evil.example/login"],
      [1, "GET"],
      [3, "00".repeat(32)],
      [4, "00".repeat(32)],
    ] as const) {
      const template = authEventTemplate(challenge, (await getBinding()).record, T0);
      template.tags[index] = [template.tags[index]![0]!, value];
      const forged = signEvent(nostrKey.privateKey, template);
      expect(await failure(env, { ...good, event: forged })).toBe(
        "login event does not match the challenge and binding",
      );
    }
  });

  it("rejects an event with an extra tag or content", async () => {
    const env = setup("nostr");
    const challenge = await env.issue();
    const good = await respond(challenge);
    const template = authEventTemplate(challenge, (await getBinding()).record, T0);
    const extraTag = signEvent(nostrKey.privateKey, {
      ...template,
      tags: [...template.tags, ["x", "y"]],
    });
    const withContent = signEvent(nostrKey.privateKey, { ...template, content: "hi" });
    expect(await failure(env, { ...good, event: extraTag })).toContain("does not match");
    expect(await failure(env, { ...good, event: withContent })).toContain("does not match");
  });

  it("rejects an event of the wrong kind", async () => {
    const env = setup("nostr");
    const challenge = await env.issue();
    const good = await respond(challenge);
    const template = authEventTemplate(challenge, (await getBinding()).record, T0);
    const wrong = signEvent(nostrKey.privateKey, { ...template, kind: 1 });
    expect(await failure(env, { ...good, event: wrong })).toBe("login event has the wrong kind");
  });

  it("rejects a bad Nostr signature", async () => {
    const env = setup("nostr");
    const good = await respond(await env.issue());
    expect(await failure(env, { ...good, event: { ...good.event, sig: "00".repeat(64) } })).toBe(
      "login event signature is invalid",
    );
  });

  it("rejects a binding that belongs to another Nostr key", async () => {
    const env = setup("nostr");
    const challenge = await env.issue();
    const good = await respond(challenge);
    const theirs = await createBinding({
      nostrSigner: createNostrKeySigner(otherNostr.privateKey),
      bchSigner,
      bchKeyHash: bchKey.keyHash,
      network: "chipnet",
      proofType: "message",
      createdAt: T0 - 1000,
    });
    expect(await failure(env, { ...good, binding: theirs.event })).toBe(
      "login event was not signed by the bound Nostr key",
    );
  });

  it("rejects an invalid binding", async () => {
    const env = setup("nostr");
    const good = await respond(await env.issue());
    const reason = await failure(env, {
      ...good,
      binding: { ...good.binding, sig: "00".repeat(64) },
    });
    expect(reason).toBe("binding is invalid: Nostr signature is invalid");
  });

  it("requires a BCH proof at the dual level and refuses one at the nostr level", async () => {
    const dual = setup("dual");
    const dualResponse = await respond(await dual.issue());
    const withoutProof = { binding: dualResponse.binding, event: dualResponse.event };
    expect(await failure(dual, withoutProof)).toBe("this challenge needs a BCH proof");

    const nostrOnly = setup("nostr");
    const nostrResponse = await respond(await nostrOnly.issue());
    expect(await failure(nostrOnly, { ...nostrResponse, bchProof: dualResponse.bchProof })).toBe(
      "this challenge does not take a BCH proof",
    );
  });

  it.each(["message", "tx"] as const)(
    "rejects a binding %s proof used as a login proof",
    async (type) => {
      const env = setup("dual");
      const challenge = await env.issue();
      const good = await respond(challenge, type);
      const b = await getBinding();
      const bindingProof = await proveBchControl(bchSigner, b.record, type);
      const reason = await failure(env, { ...good, bchProof: bindingProof });
      expect(reason).toMatch(/^BCH proof is invalid/);
    },
  );

  it.each(["message", "tx"] as const)(
    "rejects a %s proof made for another challenge",
    async (type) => {
      const env = setup("dual");
      const first = await env.issue();
      const second = await env.issue();
      const forFirst = await respond(first, type);
      const forSecond = await respond(second, type);
      const reason = await failure(env, { ...forSecond, bchProof: forFirst.bchProof });
      expect(reason).toMatch(/^BCH proof is invalid/);
    },
  );

  it("rejects a BCH proof from a different key", async () => {
    const env = setup("dual");
    const challenge = await env.issue();
    const good = await respond(challenge);
    const b = await getBinding();
    const stranger = createKeySigner(otherBch.privateKey);
    const statement = authStatement(challenge, b.record);
    const wrong = await stranger.signMessage(statement.text);
    expect(
      await failure(env, { ...good, bchProof: { type: "message", signature: wrong } }),
    ).toMatch(/^BCH proof is invalid/);
  });

  it("does not throw on malformed responses", async () => {
    const env = setup();
    const good = await respond(await env.issue());
    for (const value of [
      null,
      undefined,
      "login",
      5,
      [],
      {},
      { binding: good.binding },
      { ...good, extra: 1 },
      { ...good, binding: "x" },
      { ...good, bchProof: "x" },
      { ...good, bchProof: { type: "other" } },
      { binding: good.binding, event: { ...good.event, tags: [] } },
      {
        binding: good.binding,
        event: { ...good.event, tags: [...good.event.tags, ["challenge", "00".repeat(32)]] },
      },
    ]) {
      const result = await verifyLogin(env.store, value, { now: env.now() });
      expect(result.ok).toBe(false);
    }
  });

  it("does not use up the challenge when a check fails", async () => {
    const env = setup("nostr");
    const challenge = await env.issue();
    const good = await respond(challenge);
    await verifyLogin(
      env.store,
      { ...good, event: { ...good.event, sig: "00".repeat(64) } },
      { now: env.now() },
    );
    expect((await verifyLogin(env.store, good, { now: env.now() })).ok).toBe(true);
  });
});

describe("login: currency check", () => {
  it("accepts when the binding is current", async () => {
    const env = setup("nostr");
    const response = await respond(await env.issue());
    const seen: string[] = [];
    const result = await verifyLogin(env.store, response, {
      now: env.now(),
      isCurrent: async (b) => {
        seen.push(b.bindingId);
        return { ok: true };
      },
    });
    expect(result.ok).toBe(true);
    expect(seen).toEqual([(await getBinding()).bindingId]);
  });

  it("rejects a binding that is not current and keeps the challenge", async () => {
    const env = setup("nostr");
    const response = await respond(await env.issue());
    const stale = await verifyLogin(env.store, response, {
      now: env.now(),
      isCurrent: () => ({ ok: false, reason: "a newer binding exists" }),
    });
    expect(stale).toEqual({ ok: false, reason: "binding is not current: a newer binding exists" });
    expect((await verifyLogin(env.store, response, { now: env.now() })).ok).toBe(true);
  });

  it("does not run the currency check when a local check fails", async () => {
    const env = setup("nostr");
    const good = await respond(await env.issue());
    let called = false;
    await verifyLogin(
      env.store,
      { ...good, event: { ...good.event, sig: "00".repeat(64) } },
      {
        now: env.now(),
        isCurrent: () => {
          called = true;
          return { ok: true };
        },
      },
    );
    expect(called).toBe(false);
  });
});

describe("createLoginResponse", () => {
  it("refuses an expired challenge", async () => {
    const env = setup();
    const challenge = await env.issue();
    await expect(respond(challenge, "message", () => T0 + 301)).rejects.toThrow(
      "challenge has expired",
    );
  });

  it("refuses a Nostr signer that is not the bound key", async () => {
    const env = setup("nostr");
    await expect(
      createLoginResponse({
        challenge: await env.issue(),
        binding: (await getBinding()).event,
        nostrSigner: createNostrKeySigner(otherNostr.privateKey),
        now: env.now,
      }),
    ).rejects.toThrow("the Nostr signer is not the key in the binding");
  });

  it("refuses an invalid binding", async () => {
    const env = setup("nostr");
    const b = await getBinding();
    await expect(
      createLoginResponse({
        challenge: await env.issue(),
        binding: { ...b.event, sig: "00".repeat(64) },
        nostrSigner,
        now: env.now,
      }),
    ).rejects.toThrow(/binding is invalid/);
  });

  it("needs a BCH signer and proof type at the dual level", async () => {
    const env = setup("dual");
    const b = await getBinding();
    await expect(
      createLoginResponse({
        challenge: await env.issue(),
        binding: b.event,
        nostrSigner,
        now: env.now,
      }),
    ).rejects.toThrow("this challenge needs a BCH signer and a proof type");
  });

  it("does not switch proof types", async () => {
    const env = setup("dual");
    const messageOnly: BchSigner = { signMessage: bchSigner.signMessage };
    await expect(
      createLoginResponse({
        challenge: await env.issue(),
        binding: (await getBinding()).event,
        nostrSigner,
        bchSigner: messageOnly,
        proofType: "tx",
        now: env.now,
      }),
    ).rejects.toThrow("this signer cannot sign transactions");
  });

  it("refuses a wallet that signs with the wrong key", async () => {
    const env = setup("dual");
    await expect(
      createLoginResponse({
        challenge: await env.issue(),
        binding: (await getBinding()).event,
        nostrSigner,
        bchSigner: createKeySigner(otherBch.privateKey),
        proofType: "message",
        now: env.now,
      }),
    ).rejects.toThrow(/signer returned an invalid proof/);
  });

  it("refuses a challenge meant for another site", async () => {
    const env = setup("nostr");
    const options = {
      challenge: await env.issue(),
      binding: (await getBinding()).event,
      nostrSigner,
      now: env.now,
    };
    await expect(
      createLoginResponse({ ...options, expectedOrigin: "https://evil.example" }),
    ).rejects.toThrow("challenge is for a different site");
    await expect(
      createLoginResponse({ ...options, expectedOrigin: "https://app.example/anything" }),
    ).resolves.toBeDefined();
  });

  it("asks the Nostr signer last so the event time is fresh", async () => {
    const env = setup("dual");
    const order: string[] = [];
    const b = await getBinding();
    await createLoginResponse({
      challenge: await env.issue(),
      binding: b.event,
      nostrSigner: {
        getPublicKey: () => nostrKey.publicKey,
        signEvent: (template) => {
          order.push("nostr");
          return nostrSigner.signEvent(template);
        },
      },
      bchSigner: {
        signMessage: (message) => {
          order.push("bch");
          return bchSigner.signMessage(message);
        },
      },
      proofType: "message",
      now: env.now,
    });
    expect(order).toEqual(["bch", "nostr"]);
  });

  it("rejects a Nostr signer that changes the event", async () => {
    const env = setup("nostr");
    const tampering = {
      getPublicKey: () => nostrKey.publicKey,
      signEvent: (template: Parameters<typeof nostrSigner.signEvent>[0]) =>
        nostrSigner.signEvent({ ...template, tags: [...template.tags, ["x", "y"]] }),
    };
    await expect(
      createLoginResponse({
        challenge: await env.issue(),
        binding: (await getBinding()).event,
        nostrSigner: tampering,
        now: env.now,
      }),
    ).rejects.toThrow(/login response is invalid/);
  });
});

describe("checkLoginResponse", () => {
  it("is pure and does not touch a store", async () => {
    const env = setup("nostr");
    const challenge = await env.issue();
    const response = await respond(challenge);
    expect(checkLoginResponse(challenge, response, T0).ok).toBe(true);
    expect(checkLoginResponse(challenge, response, T0).ok).toBe(true);
    expect(checkLoginResponse(challenge, response, T0 + 301)).toEqual({
      ok: false,
      reason: "challenge has expired",
    });
  });
});
