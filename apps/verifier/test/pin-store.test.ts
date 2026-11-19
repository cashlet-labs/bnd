import {
  createBinding,
  createKeySigner,
  createNostrKeySigner,
  createSuccessor,
  deriveBchKey,
  deriveNostrKey,
  type VerifiedBinding,
} from "@cashlet-labs/bnd-core";
import { describe, expect, it } from "vitest";
import { MemoryPinStore } from "../src/pin-store.js";

const MNEMONIC = "leader monkey parrot ring guide accident before fence cannon height naive bean";
const n = [0, 1].map((i) => deriveNostrKey(MNEMONIC, i));
const b = [0, 1, 2].map((i) => deriveBchKey(MNEMONIC, 0, i));

function root(nostr = n[0]!, bch = b[0]!, createdAt = 1_700_000_000) {
  return createBinding({
    nostrSigner: createNostrKeySigner(nostr.privateKey),
    bchSigner: createKeySigner(bch.privateKey),
    bchKeyHash: bch.keyHash,
    network: "chipnet",
    proofType: "message",
    createdAt,
  });
}

function moveToNostr1(previous: VerifiedBinding) {
  return createSuccessor({
    previous: previous.event,
    nostrSigner: createNostrKeySigner(n[1]!.privateKey),
    bchSigner: createKeySigner(b[0]!.privateKey),
    bchKeyHash: b[0]!.keyHash,
    network: "chipnet",
    proofType: "message",
    approvers: { nostr: createNostrKeySigner(n[0]!.privateKey) },
    createdAt: previous.record.createdAt + 10,
  });
}

describe("MemoryPinStore", () => {
  it("accepts anything for an unpinned key, then only that binding or its successors", async () => {
    const pins = new MemoryPinStore();
    const first = await root();
    expect(pins.conflict(first)).toBeNull();
    pins.pin(first);
    expect(pins.conflict(first)).toBeNull();
    const other = await root(n[0]!, b[2]!, 1_700_000_500);
    expect(pins.conflict(other)).toMatch(/does not continue/);
    expect(pins.conflict(await moveToNostr1(first))).toBeNull();
  });

  it("pins every Nostr key in the chain, so the old key cannot start over", async () => {
    const pins = new MemoryPinStore();
    const first = await root();
    const moved = await moveToNostr1(first);
    pins.pin(moved);
    expect(pins.checkpoints()).toEqual(new Set([moved.bindingId]));
    // A thief holding the old Nostr key cannot return to an earlier binding or a new one.
    expect(pins.conflict(first)).toMatch(/does not continue/);
    expect(pins.conflict(await root(n[0]!, b[2]!, 1_700_000_900))).toMatch(/does not continue/);
  });

  it("keeps checkpoints in step with pins and bounds memory", async () => {
    const pins = new MemoryPinStore(1);
    const a = await root(n[0]!, b[0]!);
    const c = await root(n[1]!, b[1]!);
    pins.pin(a);
    pins.pin(c);
    expect(pins.size).toBe(1);
    expect(pins.checkpoints()).toEqual(new Set([c.bindingId]));
    expect(pins.conflict(a)).toBeNull();
  });
});
