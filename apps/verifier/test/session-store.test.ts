import { describe, expect, it } from "vitest";
import { RateLimiter } from "../src/rate-limit.js";
import { MemorySessionStore, type Session } from "../src/session-store.js";

const session = (createdAt: number): Session => ({
  identity: {
    nostrPublicKey: "ab".repeat(32),
    npub: "npub1example",
    bch: { network: "chipnet", keyHash: "cd".repeat(20), address: "bchtest:qexample" },
    bindingId: "ef".repeat(32),
  },
  level: "dual",
  createdAt,
  lastSeenAt: createdAt,
});

describe("MemorySessionStore", () => {
  it("issues random 32-byte tokens", () => {
    const store = new MemorySessionStore();
    const a = store.create(session(0));
    const b = store.create(session(0));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it("ends a session after 30 idle minutes", () => {
    const store = new MemorySessionStore();
    const token = store.create(session(1000));
    expect(store.use(token, 1000 + 1800)).toBeDefined();
    expect(store.use(token, 1000 + 1800 + 1800 + 1)).toBeUndefined();
  });

  it("keeps an active session alive until the 8 hour limit", () => {
    const store = new MemorySessionStore();
    const token = store.create(session(0));
    for (let t = 1500; t <= 28_800; t += 1500) expect(store.use(token, t)).toBeDefined();
    expect(store.use(token, 28_801)).toBeUndefined();
  });

  it("deletes a session", () => {
    const store = new MemorySessionStore();
    const token = store.create(session(0));
    store.delete(token);
    expect(store.use(token, 1)).toBeUndefined();
  });

  it("rejects malformed tokens without lookup", () => {
    const store = new MemorySessionStore();
    expect(store.use("x", 0)).toBeUndefined();
    expect(store.use("AB".repeat(32), 0)).toBeUndefined();
  });

  it("drops the oldest sessions when full", () => {
    const store = new MemorySessionStore({ maxSessions: 2 });
    const first = store.create(session(0));
    const second = store.create(session(0));
    const third = store.create(session(0));
    expect(store.use(first, 1)).toBeUndefined();
    expect(store.use(second, 1)).toBeDefined();
    expect(store.use(third, 1)).toBeDefined();
  });

  it("does not let callers change a stored session through a returned copy", () => {
    const store = new MemorySessionStore();
    const token = store.create(session(0));
    const copy = store.use(token, 1)!;
    copy.level = "nostr";
    expect(store.use(token, 2)?.level).toBe("dual");
  });
});

describe("RateLimiter", () => {
  it("allows up to the limit per window, then refuses", () => {
    const limiter = new RateLimiter(3, 60);
    expect([1, 2, 3, 4].map(() => limiter.allow("a", 0))).toEqual([true, true, true, false]);
    expect(limiter.allow("b", 0)).toBe(true);
    expect(limiter.allow("a", 60)).toBe(true);
  });

  it("forgets old keys when it holds too many", () => {
    const limiter = new RateLimiter(1, 60, 2);
    limiter.allow("a", 0);
    limiter.allow("b", 0);
    expect(limiter.allow("c", 0)).toBe(true);
    expect(limiter.allow("c", 0)).toBe(false);
  });

  it("rejects an invalid limit", () => {
    expect(() => new RateLimiter(0, 60)).toThrow(RangeError);
  });
});
