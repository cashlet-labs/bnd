import { describe, expect, it } from "vitest";
import { createKeySigner, proveBchControl, proveStatement } from "../src/bch-proof.js";
import { buildBinding, bindingId } from "../src/binding.js";
import {
  buildBindingEventTemplate,
  createBinding,
  createNostrKeySigner,
  createRevocation,
  createSuccessor,
  historyAfter,
  resolveIdentity,
  verifyBinding,
  type Approvers,
  type VerifiedBinding,
} from "../src/binding-event.js";
import { bytesToHex } from "../src/bytes.js";
import { signEvent, type NostrEvent } from "../src/event.js";
import { deriveBchKey, deriveNostrKey } from "../src/keys.js";
import { approvalEventTemplate, MAX_HISTORY, successionStatement } from "../src/succession.js";
import { checkLoginResponse, createLoginResponse, issueChallenge } from "../src/auth.js";
import { MemoryChallengeStore } from "../src/challenge-store.js";

const MNEMONIC = "leader monkey parrot ring guide accident before fence cannon height naive bean";
const T = 1_700_000_000;

// The owner's keys, a thief's keys, and two recovery keys.
const N = [0, 1, 2].map((i) => deriveNostrKey(MNEMONIC, i));
const B = [0, 1, 2].map((i) => deriveBchKey(MNEMONIC, 0, i));
const R = [10, 11].map((i) => deriveNostrKey(MNEMONIC, i));
const thiefN = deriveNostrKey(MNEMONIC, 20);
const thiefB = deriveBchKey(MNEMONIC, 0, 20);
const thiefR = deriveNostrKey(MNEMONIC, 21);

type NostrKey = (typeof N)[number];
type BchKey = (typeof B)[number];

const nostrSigner = (key: NostrKey) => createNostrKeySigner(key.privateKey);
const bchApprover = (key: BchKey) => ({
  signer: createKeySigner(key.privateKey),
  proofType: "message" as const,
});

function root(nostr: NostrKey, bch: BchKey, recovery?: NostrKey, createdAt = T) {
  return createBinding({
    nostrSigner: nostrSigner(nostr),
    bchSigner: createKeySigner(bch.privateKey),
    bchKeyHash: bch.keyHash,
    network: "chipnet",
    proofType: "message",
    createdAt,
    ...(recovery ? { recoveryPublicKey: recovery.publicKey } : {}),
  });
}

function successor(
  previous: VerifiedBinding,
  nostr: NostrKey,
  bch: BchKey,
  approvers: Approvers,
  options: { recovery?: NostrKey; createdAt?: number; proofType?: "message" | "tx" } = {},
) {
  return createSuccessor({
    previous: previous.event,
    nostrSigner: nostrSigner(nostr),
    bchSigner: createKeySigner(bch.privateKey),
    bchKeyHash: bch.keyHash,
    network: "chipnet",
    proofType: options.proofType ?? "message",
    approvers,
    createdAt: options.createdAt ?? previous.record.createdAt + 100,
    ...(options.recovery ? { recoveryPublicKey: options.recovery.publicKey } : {}),
  });
}

/**
 * Hand-build a successor the way an attacker would: any record, any explicit
 * approvals, signed by any Nostr key, with no checks on the way.
 */
async function forgeSuccessor(options: {
  previous: VerifiedBinding;
  author: NostrKey;
  bch: BchKey;
  approvals?: Record<string, unknown>;
  createdAt?: number;
}): Promise<NostrEvent> {
  const record = buildBinding({
    nostrPublicKey: options.author.publicKey,
    bchKeyHash: options.bch.keyHash,
    network: "chipnet",
    createdAt: options.createdAt ?? options.previous.record.createdAt + 100,
    previous: options.previous.bindingId,
  });
  const proof = await proveBchControl(createKeySigner(options.bch.privateKey), record, "message");
  const template = buildBindingEventTemplate(record, proof, {
    history: historyAfter(options.previous.event),
    approvals: (options.approvals ?? {}) as never,
  });
  return signEvent(options.author.privateKey, template);
}

const owner = { nostrPublicKey: N[0]!.publicKey };

describe("honest succession", () => {
  it("rotates the BCH key: the kept Nostr key and the old BCH key approve", async () => {
    const first = await root(N[0]!, B[0]!);
    const next = await successor(first, N[0]!, B[1]!, { bch: bchApprover(B[0]!) });
    expect(next).toMatchObject({
      form: "successor",
      history: [first.bindingId],
      approvedBy: ["nostr", "bch"],
      bch: { keyHash: bytesToHex(B[1]!.keyHash) },
    });
    expect(next.event.tags).toEqual([
      ["d", "bnd1"],
      ["b", bytesToHex(B[1]!.keyHash)],
      ["s", first.bindingId],
    ]);
  });

  it("rotates the Nostr key: the kept BCH key and the old Nostr key approve", async () => {
    const first = await root(N[0]!, B[0]!);
    const next = await successor(first, N[1]!, B[0]!, { nostr: nostrSigner(N[0]!) });
    expect(next).toMatchObject({ nostrPublicKey: N[1]!.publicKey, approvedBy: ["nostr", "bch"] });
  });

  it("rotates both keys with both old keys approving", async () => {
    const first = await root(N[0]!, B[0]!);
    const next = await successor(first, N[1]!, B[1]!, {
      nostr: nostrSigner(N[0]!),
      bch: bchApprover(B[0]!),
    });
    expect(next.approvedBy).toEqual(["nostr", "bch"]);
  });

  it("adds a recovery key with both kept keys approving implicitly", async () => {
    const first = await root(N[0]!, B[0]!);
    const next = await successor(first, N[0]!, B[0]!, {}, { recovery: R[0]! });
    expect(next.record.recovery).toEqual({ publicKey: R[0]!.publicKey });
    expect(next.approvedBy).toEqual(["nostr", "bch"]);
  });

  it("recovers from a lost Nostr key with the BCH key and the recovery key", async () => {
    const first = await root(N[0]!, B[0]!, R[0]);
    const next = await successor(
      first,
      N[1]!,
      B[0]!,
      { recovery: nostrSigner(R[0]!) },
      {
        recovery: R[1]!,
      },
    );
    expect(next.approvedBy).toEqual(["bch", "recovery"]);
  });

  it("recovers from a lost BCH key with the Nostr key and the recovery key", async () => {
    const first = await root(N[0]!, B[0]!, R[0]);
    const next = await successor(first, N[0]!, B[1]!, { recovery: nostrSigner(R[0]!) });
    expect(next.approvedBy).toEqual(["nostr", "recovery"]);
  });

  it("accepts a transaction proof as the old BCH key's approval", async () => {
    const first = await root(N[0]!, B[0]!);
    const next = await successor(first, N[0]!, B[1]!, {
      bch: { signer: createKeySigner(B[0]!.privateKey), proofType: "tx" },
    });
    expect(next.approvedBy).toEqual(["nostr", "bch"]);
  });

  it("carries the whole history, so a stale relay copy is simply old", async () => {
    const r = await root(N[0]!, B[0]!);
    const s1 = await successor(r, N[0]!, B[1]!, { bch: bchApprover(B[0]!) });
    const s2 = await successor(s1, N[0]!, B[2]!, { bch: bchApprover(B[1]!) });
    expect(s2.history).toEqual([r.bindingId, s1.bindingId]);
    // A relay that lagged still holds r; most hold only s2.
    expect(resolveIdentity([r.event, s2.event], owner)).toMatchObject({
      status: "current",
      binding: { bindingId: s2.bindingId },
    });
  });

  it("finds the identity under its new Nostr key from the old one", async () => {
    const first = await root(N[0]!, B[0]!);
    const moved = await successor(first, N[1]!, B[0]!, { nostr: nostrSigner(N[0]!) });
    expect(resolveIdentity([first.event, moved.event], owner)).toMatchObject({
      status: "current",
      binding: { nostrPublicKey: N[1]!.publicKey },
    });
  });

  it(`allows ${MAX_HISTORY} steps within the relay size limit, and refuses one more`, async () => {
    // Transaction proofs everywhere: the largest form a history can take.
    const tx = (key: BchKey) => ({
      signer: createKeySigner(key.privateKey),
      proofType: "tx" as const,
    });
    let current = await root(N[0]!, B[0]!);
    for (let step = 1; step <= MAX_HISTORY; step++) {
      current = await successor(
        current,
        N[0]!,
        B[step % 2]!,
        { bch: tx(B[(step + 1) % 2]!) },
        { proofType: "tx" },
      );
    }
    expect(current.history).toHaveLength(MAX_HISTORY);
    // strfry, and our relays, refuse events over 64 KB.
    expect(JSON.stringify(current.event).length).toBeLessThan(65_536);
    await expect(
      successor(current, N[0]!, B[2]!, { bch: bchApprover(B[MAX_HISTORY % 2]!) }),
    ).rejects.toThrow(`history would be longer than ${MAX_HISTORY} bindings`);
    // Built by hand, the 33rd step is refused by every verifier.
    const forged = await forgeSuccessor({
      previous: current,
      author: N[0]!,
      bch: B[MAX_HISTORY % 2]!,
    });
    expect(verifyBinding(forged)).toEqual({
      ok: false,
      reason: `history is longer than ${MAX_HISTORY} bindings`,
    });
  }, 60_000);

  it("skips history up to a checkpoint, and still checks every later step", async () => {
    const r = await root(N[0]!, B[0]!);
    const s1 = await successor(r, N[0]!, B[1]!, { bch: bchApprover(B[0]!) });
    const s2 = await successor(s1, N[0]!, B[2]!, { bch: bchApprover(B[1]!) });
    // Corrupt the oldest step's signature: only a verifier that trusts s1 accepts.
    const content = JSON.parse(s2.event.content);
    content.history[0].sig = "00".repeat(64);
    const corrupt = signEvent(N[0]!.privateKey, {
      kind: s2.event.kind,
      created_at: s2.event.created_at,
      tags: s2.event.tags,
      content: JSON.stringify(content),
    });
    expect(verifyBinding(corrupt)).toEqual({
      ok: false,
      reason: "history step 1: Nostr signature is invalid",
    });
    expect(verifyBinding(corrupt, { checkpoints: new Set([s1.bindingId]) }).ok).toBe(true);
    // Trusting only r, s1 is checked, and its signature covers r's step.
    expect(verifyBinding(corrupt, { checkpoints: new Set([r.bindingId]) })).toEqual({
      ok: false,
      reason: "history step 2: Nostr signature is invalid",
    });
  });
});

describe("revocation", () => {
  it("ends the identity: approved by the Nostr key and the BCH key", async () => {
    const first = await root(N[0]!, B[0]!);
    const revocation = await createRevocation({
      previous: first.event,
      signer: nostrSigner(N[0]!),
      approvers: { bch: bchApprover(B[0]!) },
      createdAt: T + 100,
    });
    expect(revocation).toMatchObject({ form: "revocation", proofType: null });
    expect(revocation.record.revoked).toBe(true);
    expect(resolveIdentity([first.event, revocation.event], owner)).toMatchObject({
      status: "revoked",
    });
  });

  it("can be signed by the recovery key when the Nostr key is stolen", async () => {
    const first = await root(N[0]!, B[0]!, R[0]);
    const revocation = await createRevocation({
      previous: first.event,
      signer: nostrSigner(R[0]!),
      approvers: { bch: bchApprover(B[0]!) },
    });
    expect(revocation.approvedBy).toEqual(["bch", "recovery"]);
  });

  it("cannot be continued", async () => {
    const first = await root(N[0]!, B[0]!);
    const revocation = await createRevocation({
      previous: first.event,
      signer: nostrSigner(N[0]!),
      approvers: { bch: bchApprover(B[0]!) },
      createdAt: T + 100,
    });
    await expect(successor(revocation, N[0]!, B[1]!, { bch: bchApprover(B[0]!) })).rejects.toThrow(
      "a revoked identity cannot be continued",
    );
  });

  it("refuses a revocation signed by one key only", async () => {
    const first = await root(N[0]!, B[0]!);
    await expect(
      createRevocation({ previous: first.event, signer: nostrSigner(N[0]!), approvers: {} }),
    ).rejects.toThrow(
      "needs approval from two keys of the previous binding, got only the nostr key",
    );
  });

  it("refuses a revocation signed by a stranger", async () => {
    const first = await root(N[0]!, B[0]!);
    await expect(
      createRevocation({
        previous: first.event,
        signer: nostrSigner(thiefN),
        approvers: { bch: bchApprover(B[0]!) },
      }),
    ).rejects.toThrow("a revocation must be signed by the previous Nostr or recovery key");
  });

  it("blocks login with a revoked binding", async () => {
    const first = await root(N[0]!, B[0]!);
    const revocation = await createRevocation({
      previous: first.event,
      signer: nostrSigner(N[0]!),
      approvers: { bch: bchApprover(B[0]!) },
    });
    const store = new MemoryChallengeStore();
    const challenge = await issueChallenge(store, {
      audience: "https://app.example/login",
      level: "nostr",
    });
    await expect(
      createLoginResponse({
        challenge,
        binding: revocation.event,
        nostrSigner: nostrSigner(N[0]!),
      }),
    ).rejects.toThrow("this identity has been revoked");
    const login = await createLoginResponse({
      challenge,
      binding: first.event,
      nostrSigner: nostrSigner(N[0]!),
    });
    const now = Math.floor(Date.now() / 1000);
    expect(checkLoginResponse(challenge, { ...login, binding: revocation.event }, now)).toEqual({
      ok: false,
      reason: "this identity has been revoked",
    });
  });
});

describe("takeover attempts", () => {
  it("a stolen Nostr key alone cannot rebind to the thief's BCH key", async () => {
    const legit = await root(N[0]!, B[0]!);
    const forged = await forgeSuccessor({ previous: legit, author: N[0]!, bch: thiefB });
    expect(verifyBinding(forged)).toEqual({
      ok: false,
      reason: "needs approval from two keys of the previous binding, got only the nostr key",
    });
  });

  it("a stolen Nostr key's fresh first binding makes a dispute, not a takeover", async () => {
    const legit = await root(N[0]!, B[0]!);
    const fake = await root(N[0]!, thiefB, undefined, T + 500);
    const state = resolveIdentity([legit.event, fake.event], owner);
    expect(state.status).toBe("disputed");
  });

  it("a stolen Nostr key's made-up history is a fork of the real one", async () => {
    const legit = await root(N[0]!, B[0]!);
    // The thief invents an older first binding with their own keys, then a
    // successor approved by them, so the fake chain is valid on its own.
    const fakeRoot = await root(N[0]!, thiefB, thiefR, T - 1000);
    const fakeNext = await successor(fakeRoot, N[0]!, B[2]!, { recovery: nostrSigner(thiefR) });
    expect(fakeNext.ok).toBe(true);
    expect(resolveIdentity([legit.event, fakeNext.event], owner).status).toBe("disputed");
  });

  it("a fake chain cannot claim the real binding as its ancestor", async () => {
    const legit = await root(N[0]!, B[0]!);
    // The thief's own BCH key signs the BCH approval in the old key's place.
    const record = buildBinding({
      nostrPublicKey: N[0]!.publicKey,
      bchKeyHash: thiefB.keyHash,
      network: "chipnet",
      createdAt: T + 100,
      previous: legit.bindingId,
    });
    const approval = await proveStatement(
      createKeySigner(thiefB.privateKey),
      { ...successionStatement(legit.record, record), keyHash: bytesToHex(thiefB.keyHash) },
      "message",
    );
    const forged = await forgeSuccessor({
      previous: legit,
      author: N[0]!,
      bch: thiefB,
      approvals: { bch: approval },
    });
    const result = verifyBinding(forged);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/^BCH key approval is invalid/);
  });

  it("the old BCH key's public binding proof cannot be replayed as an approval", async () => {
    const legit = await root(N[0]!, B[0]!);
    const reused = JSON.parse(legit.event.content).bchProof;
    const forged = await forgeSuccessor({
      previous: legit,
      author: N[0]!,
      bch: thiefB,
      approvals: { bch: reused },
    });
    const result = verifyBinding(forged);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/^BCH key approval is invalid/);
  });

  it("an approval for one successor cannot be reused for another", async () => {
    const legit = await root(N[0]!, B[0]!);
    const honest = await successor(legit, N[1]!, B[0]!, { nostr: nostrSigner(N[0]!) });
    const approval = JSON.parse(honest.event.content).approvals.nostr;
    // A thief with the BCH key alone moves the identity to their Nostr key,
    // replaying the owner's Nostr approval of the honest successor.
    const forged = await forgeSuccessor({
      previous: legit,
      author: thiefN,
      bch: B[0]!,
      approvals: { nostr: approval },
    });
    expect(verifyBinding(forged)).toEqual({
      ok: false,
      reason: "Nostr key approval is invalid: approval signature is invalid",
    });
  });

  it("an approval in the wrong slot is refused", async () => {
    const legit = await root(N[0]!, B[0]!, R[0]);
    const record = buildBinding({
      nostrPublicKey: thiefN.publicKey,
      bchKeyHash: B[0]!.keyHash,
      network: "chipnet",
      createdAt: T + 100,
      previous: legit.bindingId,
    });
    const byThief = signEvent(thiefN.privateKey, approvalEventTemplate(record)).sig;
    const forged = await forgeSuccessor({
      previous: legit,
      author: thiefN,
      bch: B[0]!,
      approvals: { recovery: byThief },
    });
    expect(verifyBinding(forged)).toEqual({
      ok: false,
      reason: "recovery key approval is invalid: approval signature is invalid",
    });
  });

  it("a stolen BCH key alone cannot move the identity to the thief's Nostr key", async () => {
    const legit = await root(N[0]!, B[0]!);
    const forged = await forgeSuccessor({ previous: legit, author: thiefN, bch: B[0]! });
    expect(verifyBinding(forged)).toEqual({
      ok: false,
      reason: "needs approval from two keys of the previous binding, got only the bch key",
    });
  });

  it("a stolen BCH key's claim from another Nostr key is a dispute for that BCH key only", async () => {
    const legit = await root(N[0]!, B[0]!);
    const claim = await root(thiefN, B[0]!, undefined, T + 100);
    const bchKeyHash = bytesToHex(B[0]!.keyHash);
    expect(resolveIdentity([legit.event, claim.event], { bchKeyHash }).status).toBe("disputed");
    expect(resolveIdentity([legit.event, claim.event], owner)).toMatchObject({
      status: "current",
      binding: { bindingId: legit.bindingId },
    });
  });

  it("a stolen recovery key alone cannot move the identity", async () => {
    const legit = await root(N[0]!, B[0]!, R[0]);
    const record = buildBinding({
      nostrPublicKey: thiefN.publicKey,
      bchKeyHash: thiefB.keyHash,
      network: "chipnet",
      createdAt: T + 100,
      previous: legit.bindingId,
    });
    const forged = await forgeSuccessor({
      previous: legit,
      author: thiefN,
      bch: thiefB,
      approvals: { recovery: signEvent(R[0]!.privateKey, approvalEventTemplate(record)).sig },
    });
    expect(verifyBinding(forged)).toEqual({
      ok: false,
      reason: "needs approval from two keys of the previous binding, got only the recovery key",
    });
  });

  it("a recovery key cannot be the Nostr key or the BCH key", () => {
    expect(() =>
      buildBinding({
        nostrPublicKey: N[0]!.publicKey,
        bchKeyHash: B[0]!.keyHash,
        network: "chipnet",
        recoveryPublicKey: N[0]!.publicKey,
      }),
    ).toThrow("the recovery key must differ from the Nostr key");
    // The BCH key's own secp256k1 key, used as an x-only recovery key.
    const sameAsBch = bytesToHex(B[0]!.publicKey.slice(1));
    expect(() =>
      buildBinding({
        nostrPublicKey: N[0]!.publicKey,
        bchKeyHash: B[0]!.keyHash,
        network: "chipnet",
        recoveryPublicKey: sameAsBch,
      }),
    ).toThrow("the recovery key must differ from the BCH key");
  });
});

describe("malformed successors", () => {
  it("refuses an edited history", async () => {
    const legit = await root(N[0]!, B[0]!);
    const next = await successor(legit, N[0]!, B[1]!, { bch: bchApprover(B[0]!) });
    const content = JSON.parse(next.event.content);
    content.history[0].record.createdAt += 1;
    const edited = signEvent(N[0]!.privateKey, {
      kind: next.event.kind,
      created_at: next.event.created_at,
      tags: next.event.tags,
      content: JSON.stringify(content),
    });
    const result = verifyBinding(edited);
    expect(result.ok).toBe(false);
  });

  it("refuses a successor that is not newer than the binding it replaces", async () => {
    const legit = await root(N[0]!, B[0]!);
    const forged = await forgeSuccessor({
      previous: legit,
      author: N[0]!,
      bch: B[0]!,
      createdAt: legit.record.createdAt,
    });
    expect(verifyBinding(forged)).toEqual({
      ok: false,
      reason: "a binding must be newer than the one it replaces",
    });
  });

  it("refuses a successor without its s tag", async () => {
    const legit = await root(N[0]!, B[0]!);
    const next = await successor(legit, N[0]!, B[1]!, { bch: bchApprover(B[0]!) });
    const untagged = signEvent(N[0]!.privateKey, {
      kind: next.event.kind,
      created_at: next.event.created_at,
      tags: next.event.tags.slice(0, 2),
      content: next.event.content,
    });
    expect(verifyBinding(untagged)).toEqual({
      ok: false,
      reason: "event tags are not the required d, b and s tags",
    });
  });

  it("refuses unknown approval members", async () => {
    const legit = await root(N[0]!, B[0]!);
    const forged = await forgeSuccessor({
      previous: legit,
      author: N[0]!,
      bch: B[0]!,
      approvals: { witness: "x" },
    });
    expect(verifyBinding(forged)).toEqual({
      ok: false,
      reason: "invalid binding content: approvals.witness is not allowed",
    });
  });

  it("refuses a previous ID that does not match the carried binding", async () => {
    const legit = await root(N[0]!, B[0]!);
    const other = await root(N[1]!, B[1]!);
    const record = buildBinding({
      nostrPublicKey: N[0]!.publicKey,
      bchKeyHash: B[0]!.keyHash,
      network: "chipnet",
      createdAt: T + 100,
      previous: other.bindingId,
    });
    const proof = await proveBchControl(createKeySigner(B[0]!.privateKey), record, "message");
    const event = signEvent(
      N[0]!.privateKey,
      buildBindingEventTemplate(record, proof, {
        history: historyAfter(legit.event),
        approvals: {},
      }),
    );
    expect(verifyBinding(event)).toEqual({
      ok: false,
      reason: "record.previous does not match the binding before it",
    });
    expect(bindingId(other.record)).not.toBe(legit.bindingId);
  });
});
