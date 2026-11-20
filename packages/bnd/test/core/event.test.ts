import { finalizeEvent, getEventHash, verifyEvent } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { eventId, isEventShape, signEvent, verifyEventSignature } from "../../src/core/event.js";
import { deriveNostrKey } from "../../src/core/keys.js";

const MNEMONIC = "leader monkey parrot ring guide accident before fence cannon height naive bean";
const key = deriveNostrKey(MNEMONIC);
const template = {
  kind: 30078,
  created_at: 1_700_000_000,
  tags: [
    ["d", "bnd1"],
    ["b", "ab".repeat(20)],
  ],
  content: '{"a":1,"text":"caf\u00e9 \\u0001 \\" "}',
};

describe("event ID and signature", () => {
  it("matches the nostr-tools event hash", () => {
    const event = signEvent(key.privateKey, template);
    expect(event.id).toBe(getEventHash(event));
    expect(eventId(event)).toBe(getEventHash(event));
  });

  it("produces events that nostr-tools verifies", () => {
    expect(verifyEvent(signEvent(key.privateKey, template))).toBe(true);
  });

  it("verifies events signed by nostr-tools", () => {
    const event = finalizeEvent(structuredClone(template), key.privateKey);
    expect(verifyEventSignature(event)).toBe(true);
  });

  it("uses the public key of the signing key", () => {
    expect(signEvent(key.privateKey, template).pubkey).toBe(key.publicKey);
  });

  it("keeps the template fields", () => {
    const event = signEvent(key.privateKey, template);
    expect(event).toMatchObject(template);
  });

  it("gives the NIP-01 example event hash form: a fixed serialization", () => {
    const id = eventId({
      pubkey: "ab".repeat(32),
      created_at: 1,
      kind: 1,
      tags: [],
      content: "hi",
    });
    expect(id).toBe(
      getEventHash({ pubkey: "ab".repeat(32), created_at: 1, kind: 1, tags: [], content: "hi" }),
    );
  });

  describe("rejections", () => {
    const event = signEvent(key.privateKey, template);

    it("rejects a changed content, tag, kind, time or key", () => {
      expect(verifyEventSignature({ ...event, content: `${event.content} ` })).toBe(false);
      expect(verifyEventSignature({ ...event, tags: [["d", "bnd2"]] })).toBe(false);
      expect(verifyEventSignature({ ...event, kind: 30079 })).toBe(false);
      expect(verifyEventSignature({ ...event, created_at: event.created_at + 1 })).toBe(false);
      expect(verifyEventSignature({ ...event, pubkey: "00".repeat(32) })).toBe(false);
    });

    it("rejects an ID that does not match the content", () => {
      expect(verifyEventSignature({ ...event, id: "00".repeat(32) })).toBe(false);
    });

    it("rejects a signature from a different key", () => {
      const other = signEvent(deriveNostrKey(MNEMONIC, 1).privateKey, template);
      expect(verifyEventSignature({ ...event, sig: other.sig })).toBe(false);
    });

    it("rejects a corrupted or zero signature", () => {
      const flipped = event.sig.slice(0, -1) + (event.sig.endsWith("0") ? "1" : "0");
      expect(verifyEventSignature({ ...event, sig: flipped })).toBe(false);
      expect(verifyEventSignature({ ...event, sig: "00".repeat(64) })).toBe(false);
    });

    it("rejects an off-curve public key without throwing", () => {
      const bad = { ...event, pubkey: "0".repeat(62) + "05" };
      bad.id = eventId(bad);
      expect(verifyEventSignature(bad)).toBe(false);
    });

    it.each([
      ["null", null],
      ["a string", "event"],
      ["an array", []],
      ["a missing field", { ...event, sig: undefined }],
      ["uppercase hex", { ...event, id: event.id.toUpperCase() }],
      ["a fractional time", { ...event, created_at: 1.5 }],
      ["a negative kind", { ...event, kind: -1 }],
      ["a kind above 65535", { ...event, kind: 65536 }],
      ["non-string tag values", { ...event, tags: [["d", 1]] }],
      ["tags that are not an array", { ...event, tags: "d" }],
      ["non-string content", { ...event, content: 5 }],
    ])("rejects %s", (_name, value) => {
      expect(isEventShape(value)).toBe(false);
      expect(verifyEventSignature(value)).toBe(false);
    });
  });
});
