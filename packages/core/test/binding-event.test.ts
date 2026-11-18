import { describe, expect, it } from "vitest";
import { createKeySigner, proveBchControl, type BchSigner } from "../src/bch-proof.js";
import { buildBinding, type BindingRecord } from "../src/binding.js";
import {
  BINDING_D_TAG,
  BINDING_EVENT_KIND,
  buildBindingEventTemplate,
  createBinding,
  createNostrKeySigner,
  parseBindingEvent,
  pickCurrentBinding,
  verifyBinding,
  type NostrSigner,
} from "../src/binding-event.js";
import { bytesToHex } from "../src/bytes.js";
import { canonicalize } from "../src/canonical.js";
import { eventId, signEvent, type NostrEvent } from "../src/event.js";
import { deriveBchKey, deriveNostrKey } from "../src/keys.js";

const MNEMONIC = "leader monkey parrot ring guide accident before fence cannon height naive bean";
const nostrKey = deriveNostrKey(MNEMONIC);
const bchKey = deriveBchKey(MNEMONIC);
const otherBchKey = deriveBchKey(MNEMONIC, 0, 1);
const CREATED_AT = 1_700_000_000;

const nostrSigner = createNostrKeySigner(nostrKey.privateKey);
const bchSigner = createKeySigner(bchKey.privateKey);

async function make(
  options: { proofType?: "message" | "tx"; createdAt?: number; previous?: string } = {},
) {
  return createBinding({
    nostrSigner,
    bchSigner,
    bchKeyHash: bchKey.keyHash,
    network: "chipnet",
    proofType: options.proofType ?? "message",
    createdAt: options.createdAt ?? CREATED_AT,
    ...(options.previous === undefined ? {} : { previous: options.previous }),
  });
}

/** Re-sign a modified copy of a binding event so only the rule under test fails. */
function resign(event: NostrEvent, change: (e: NostrEvent) => void): NostrEvent {
  const copy = structuredClone(event);
  change(copy);
  return signEvent(nostrKey.privateKey, copy);
}

describe("createBinding", () => {
  it("creates a verified binding with a message proof", async () => {
    const binding = await make({ proofType: "message" });
    expect(binding.proofType).toBe("message");
    expect(binding.nostrPublicKey).toBe(nostrKey.publicKey);
    expect(binding.bch.keyHash).toBe(bytesToHex(bchKey.keyHash));
    expect(binding.bch.address).toMatch(/^bchtest:q/);
    expect(binding.event.kind).toBe(BINDING_EVENT_KIND);
    expect(binding.event.created_at).toBe(CREATED_AT);
  });

  it("creates a verified binding with a transaction proof", async () => {
    const binding = await make({ proofType: "tx" });
    expect(binding.proofType).toBe("tx");
    expect(verifyBinding(binding.event).ok).toBe(true);
  });

  it("produces an event that carries exactly the d and b tags", async () => {
    const { event, record } = await make();
    expect(event.tags).toEqual([
      ["d", BINDING_D_TAG],
      ["b", record.bch.keyHash],
    ]);
    expect(BINDING_D_TAG).toBe("bnd1");
    expect(BINDING_EVENT_KIND).toBe(30078);
  });

  it("accepts a signer shaped like a NIP-07 provider", async () => {
    const provider: NostrSigner = {
      getPublicKey: async () => nostrKey.publicKey,
      signEvent: async (template) => signEvent(nostrKey.privateKey, template),
    };
    const binding = await createBinding({
      nostrSigner: provider,
      bchSigner,
      bchKeyHash: bchKey.keyHash,
      network: "mainnet",
      proofType: "message",
    });
    expect(binding.bch.address).toMatch(/^bitcoincash:q/);
  });

  it("records the predecessor when given", async () => {
    const previous = "ab".repeat(32);
    const binding = await make({ previous });
    expect(binding.record.previous).toBe(previous);
  });

  it("rejects a Nostr signer that changes the event time", async () => {
    const shifting: NostrSigner = {
      getPublicKey: () => nostrKey.publicKey,
      signEvent: (template) =>
        signEvent(nostrKey.privateKey, { ...template, created_at: template.created_at + 1 }),
    };
    await expect(
      createBinding({
        nostrSigner: shifting,
        bchSigner,
        bchKeyHash: bchKey.keyHash,
        network: "chipnet",
        proofType: "message",
        createdAt: CREATED_AT,
      }),
    ).rejects.toThrow(/created binding is invalid: event time does not match/);
  });

  it("rejects a Nostr signer that signs with another key", async () => {
    const other = deriveNostrKey(MNEMONIC, 1);
    const wrong: NostrSigner = {
      getPublicKey: () => nostrKey.publicKey,
      signEvent: (template) => signEvent(other.privateKey, template),
    };
    await expect(
      createBinding({
        nostrSigner: wrong,
        bchSigner,
        bchKeyHash: bchKey.keyHash,
        network: "chipnet",
        proofType: "message",
      }),
    ).rejects.toThrow(/event author is not the bound Nostr key/);
  });

  it("rejects a BCH signer for a different key", async () => {
    await expect(
      createBinding({
        nostrSigner,
        bchSigner: createKeySigner(otherBchKey.privateKey),
        bchKeyHash: bchKey.keyHash,
        network: "chipnet",
        proofType: "message",
      }),
    ).rejects.toThrow(/signer returned an invalid proof/);
  });

  it("does not switch proof types", async () => {
    const messageOnly: BchSigner = { signMessage: bchSigner.signMessage };
    await expect(
      createBinding({
        nostrSigner,
        bchSigner: messageOnly,
        bchKeyHash: bchKey.keyHash,
        network: "chipnet",
        proofType: "tx",
      }),
    ).rejects.toThrow("this signer cannot sign transactions");
  });
});

describe("verifyBinding", () => {
  it("reports the bound identities", async () => {
    const { event } = await make();
    const result = verifyBinding(event);
    expect(result).toMatchObject({
      ok: true,
      nostrPublicKey: nostrKey.publicKey,
      proofType: "message",
    });
  });

  it("is stable for the same inputs", async () => {
    const a = await make();
    const b = await make();
    expect(b.bindingId).toBe(a.bindingId);
  });

  it("round-trips through JSON as a relay would deliver it", async () => {
    const { event } = await make({ proofType: "tx" });
    expect(verifyBinding(JSON.parse(JSON.stringify(event))).ok).toBe(true);
  });

  it("rejects a changed event without re-signing", async () => {
    const { event } = await make();
    expect(verifyBinding({ ...event, content: `${event.content} ` })).toMatchObject({ ok: false });
  });

  it("rejects a Nostr signature from another key", async () => {
    const { event } = await make();
    const other = signEvent(deriveNostrKey(MNEMONIC, 1).privateKey, event);
    const forged = { ...event, sig: other.sig };
    expect(verifyBinding(forged)).toEqual({ ok: false, reason: "Nostr signature is invalid" });
  });

  it("rejects an event with an invalid BCH proof", async () => {
    const good = await make();
    const record = good.record;
    const wrong = await proveBchControl(
      createKeySigner(otherBchKey.privateKey),
      {
        ...record,
        bch: { ...record.bch, keyHash: bytesToHex(otherBchKey.keyHash) },
      },
      "message",
    );
    // Present the other key's proof for this record.
    const template = buildBindingEventTemplate(record, wrong);
    const event = signEvent(nostrKey.privateKey, template);
    expect(verifyBinding(event)).toMatchObject({ ok: false });
    expect((verifyBinding(event) as { reason: string }).reason).toMatch(/^BCH proof is invalid/);
  });

  it("rejects a BCH proof copied from another binding", async () => {
    const first = await make({ createdAt: CREATED_AT });
    const second = await make({ createdAt: CREATED_AT + 60 });
    const template = buildBindingEventTemplate(
      second.record,
      JSON.parse(first.event.content).bchProof,
    );
    const result = verifyBinding(signEvent(nostrKey.privateKey, template));
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toMatch(/^BCH proof is invalid/);
  });

  it("rejects an attacker who binds the victim's BCH key to their own Nostr key", async () => {
    const attacker = deriveNostrKey(MNEMONIC, 7);
    const victim = await make();
    const record: BindingRecord = buildBinding({
      nostrPublicKey: attacker.publicKey,
      bchKeyHash: bchKey.keyHash,
      network: "chipnet",
      createdAt: CREATED_AT,
    });
    // The attacker reuses the victim's real proof, which commits to a different record.
    const stolenProof = JSON.parse(victim.event.content).bchProof;
    const event = signEvent(attacker.privateKey, buildBindingEventTemplate(record, stolenProof));
    const result = verifyBinding(event);
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toMatch(
      /^BCH proof is invalid: message proof was not signed by the bound BCH key$/,
    );
  });

  it("rejects an attacker who binds their BCH key to the victim's Nostr key", async () => {
    const attacker = createKeySigner(otherBchKey.privateKey);
    await expect(
      createBinding({
        nostrSigner,
        bchSigner: attacker,
        bchKeyHash: bchKey.keyHash,
        network: "chipnet",
        proofType: "tx",
      }),
    ).rejects.toThrow(/signer returned an invalid proof/);
  });
});

describe("parseBindingEvent: strict shape", () => {
  async function base() {
    return (await make()).event;
  }

  it("rejects a different kind", async () => {
    const event = resign(await base(), (e) => void (e.kind = 30079));
    expect(parseBindingEvent(event)).toMatchObject({
      ok: false,
      reason: "not a binding event kind",
    });
  });

  it.each([
    ["an extra tag", (e: NostrEvent) => e.tags.push(["t", "x"])],
    ["a missing b tag", (e: NostrEvent) => e.tags.pop()],
    ["swapped tag order", (e: NostrEvent) => e.tags.reverse()],
    ["another d value", (e: NostrEvent) => void (e.tags[0] = ["d", "bnd2"])],
    ["another b value", (e: NostrEvent) => void (e.tags[1] = ["b", "00".repeat(20)])],
    ["a tag with an extra value", (e: NostrEvent) => void (e.tags[0] = ["d", "bnd1", "x"])],
  ])("rejects %s", async (_name, change) => {
    const event = resign(await base(), change);
    expect(parseBindingEvent(event)).toMatchObject({
      ok: false,
      reason: "event tags are not the required d and b tags",
    });
  });

  it("rejects an event time that differs from the record time", async () => {
    const event = resign(await base(), (e) => void (e.created_at += 1));
    expect(parseBindingEvent(event)).toMatchObject({
      reason: "event time does not match the record time",
    });
  });

  it("rejects an author that is not the bound key", async () => {
    const other = deriveNostrKey(MNEMONIC, 1);
    const event = signEvent(other.privateKey, structuredClone(await base()));
    expect(parseBindingEvent(event)).toMatchObject({
      reason: "event author is not the bound Nostr key",
    });
  });

  it("rejects content that is not canonical", async () => {
    const event = await base();
    const spaced = resign(event, (e) => void (e.content = ` ${e.content}`));
    expect(parseBindingEvent(spaced)).toMatchObject({ ok: false });
    const pretty = resign(
      event,
      (e) => void (e.content = JSON.stringify(JSON.parse(e.content), null, 1)),
    );
    expect(parseBindingEvent(pretty)).toMatchObject({
      reason: "event content is not canonical JSON",
    });
  });

  it.each([
    ["not JSON", "hello"],
    ["an array", "[]"],
    ["null", "null"],
    ["an empty object", "{}"],
    ["an extra member", '{"bchProof":{"signature":"x","type":"message"},"extra":1,"record":{}}'],
  ])("rejects content that is %s", async (_name, content) => {
    const event = resign(await base(), (e) => void (e.content = content));
    expect(parseBindingEvent(event).ok).toBe(false);
  });

  it("rejects an invalid record or proof inside the content", async () => {
    const event = await base();
    const content = JSON.parse(event.content) as { record: { version: number }; bchProof: unknown };
    const badRecord = resign(event, (e) => {
      e.content = canonicalize({ ...content, record: { ...content.record, version: 2 } });
    });
    expect(parseBindingEvent(badRecord)).toMatchObject({ ok: false });
    const badProof = resign(event, (e) => {
      e.content = canonicalize({ ...content, bchProof: { type: "other" } });
    });
    expect(parseBindingEvent(badProof)).toMatchObject({ ok: false });
  });

  it("rejects non-events", () => {
    for (const value of [null, undefined, "event", 5, [], {}]) {
      expect(parseBindingEvent(value)).toEqual({ ok: false, reason: "not a Nostr event" });
    }
  });

  it("does not check signatures itself", async () => {
    const event = await base();
    const unsigned = { ...event, sig: "00".repeat(64) };
    expect(parseBindingEvent(unsigned).ok).toBe(true);
    expect(verifyBinding(unsigned).ok).toBe(false);
  });

  it("keeps the event ID consistent with its fields", async () => {
    const event = await base();
    expect(eventId(event)).toBe(event.id);
  });
});

describe("pickCurrentBinding", () => {
  it("returns null without events or valid bindings", () => {
    expect(pickCurrentBinding([], nostrKey.publicKey)).toBeNull();
    expect(pickCurrentBinding([{}, null, "x"], nostrKey.publicKey)).toBeNull();
  });

  it("picks the newest valid binding", async () => {
    const older = await make({ createdAt: CREATED_AT });
    const newer = await make({ createdAt: CREATED_AT + 100, proofType: "tx" });
    const picked = pickCurrentBinding([older.event, newer.event], nostrKey.publicKey);
    expect(picked?.event.id).toBe(newer.event.id);
    expect(pickCurrentBinding([newer.event, older.event], nostrKey.publicKey)?.event.id).toBe(
      newer.event.id,
    );
  });

  it("ignores an invalid newer event", async () => {
    const valid = await make({ createdAt: CREATED_AT });
    const newer = await make({ createdAt: CREATED_AT + 100 });
    const broken = { ...newer.event, sig: "00".repeat(64) };
    expect(pickCurrentBinding([valid.event, broken], nostrKey.publicKey)?.event.id).toBe(
      valid.event.id,
    );
  });

  it("ignores events by other authors", async () => {
    const mine = await make();
    const other = deriveNostrKey(MNEMONIC, 1);
    const theirs = await createBinding({
      nostrSigner: createNostrKeySigner(other.privateKey),
      bchSigner,
      bchKeyHash: bchKey.keyHash,
      network: "chipnet",
      proofType: "message",
      createdAt: CREATED_AT + 500,
    });
    expect(pickCurrentBinding([theirs.event, mine.event], nostrKey.publicKey)?.event.id).toBe(
      mine.event.id,
    );
  });

  it("breaks a time tie with the lower event ID", async () => {
    const a = await make({ proofType: "message" });
    const b = await make({ proofType: "tx" });
    const lower = a.event.id < b.event.id ? a : b;
    expect(pickCurrentBinding([a.event, b.event], nostrKey.publicKey)?.event.id).toBe(
      lower.event.id,
    );
  });
});
