import {
  createRevocation,
  createSuccessor,
  type Approvers,
  type BchProofType,
  type VerifiedBinding,
} from "@cashlet-labs/bnd";
import type { ConnectedBchSigner } from "../signers/bch";
import type { ConnectedNostrSigner } from "../signers/nostr";
import type { RecoveryKey } from "../signers/recovery";

/** The changes the demo offers (BND-1 section 9). */
export type IdentityAction =
  "rotate-bch" | "rotate-nostr" | "recover-nostr" | "recover-bch" | "revoke";

export interface IdentityChange {
  /** What the current keys are. */
  binding: VerifiedBinding;
  nostr: ConnectedNostrSigner;
  bch: ConnectedBchSigner | null;
  recovery: RecoveryKey | null;
  /** The replacement key, for rotations and recoveries. */
  newNostr?: ConnectedNostrSigner;
  newBch?: ConnectedBchSigner;
  /** The second key that approves a revocation. Default the BCH key. */
  revokeWith?: "bch" | "recovery";
}

export interface IdentityResult {
  binding: VerifiedBinding;
  nostr: ConnectedNostrSigner;
  bch: ConnectedBchSigner | null;
}

/** Which keys approve each action, for the page to explain before asking. */
export const ACTION_APPROVERS: Record<IdentityAction, string> = {
  "rotate-bch": "Your Nostr key signs the new binding, and your current BCH key signs an approval.",
  "rotate-nostr":
    "Your current Nostr key signs an approval, and your BCH key proves the new binding.",
  "recover-nostr":
    "Your BCH key proves the new binding, and your recovery key signs an approval. The lost Nostr key is not used.",
  "recover-bch":
    "Your Nostr key signs the new binding, and your recovery key signs an approval. The lost BCH key is not used.",
  revoke: "Your Nostr key signs the revocation, and a second key approves it.",
};

function proofTypeOf(signer: ConnectedBchSigner): BchProofType {
  const type = signer.proofTypes.includes("tx") ? "tx" : signer.proofTypes[0];
  if (type === undefined) throw new Error("this BCH connection cannot give proofs");
  return type;
}

function need<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

function recoverySigner(change: IdentityChange) {
  const expected = change.binding.record.recovery?.publicKey;
  if (expected === undefined) throw new Error("this binding has no recovery key");
  const key = need(change.recovery?.signer, "enter the recovery key's nsec first");
  if (change.recovery?.publicKey !== expected) {
    throw new Error("that is not this binding's recovery key");
  }
  return key;
}

/**
 * Make the successor or revocation for `action`. Every result is verified by
 * the bnd library before it is returned, so a signer that approves the wrong thing
 * is caught here. Nothing is published.
 */
export async function changeIdentity(
  action: IdentityAction,
  change: IdentityChange,
): Promise<IdentityResult> {
  const { binding, nostr, bch } = change;
  const previous = binding.event;
  const network = binding.bch.network;
  const recoveryPublicKey = binding.record.recovery?.publicKey;
  const keepRecovery = recoveryPublicKey === undefined ? {} : { recoveryPublicKey };

  const successor = async (
    newNostr: ConnectedNostrSigner,
    newBch: ConnectedBchSigner,
    approvers: Approvers,
  ): Promise<IdentityResult> => {
    if (newBch.network !== network) throw new Error(`the new BCH key must be on ${network}`);
    const next = await createSuccessor({
      previous,
      nostrSigner: newNostr.signer,
      bchSigner: newBch.signer,
      bchKeyHash: newBch.keyHash,
      network,
      proofType: proofTypeOf(newBch),
      approvers,
      ...keepRecovery,
    });
    return { binding: next, nostr: newNostr, bch: newBch };
  };

  switch (action) {
    case "rotate-bch": {
      const current = need(bch, "connect the current BCH key first");
      return successor(nostr, need(change.newBch, "choose the new BCH key"), {
        bch: { signer: current.signer, proofType: proofTypeOf(current) },
      });
    }
    case "rotate-nostr":
      return successor(
        need(change.newNostr, "choose the new Nostr key"),
        need(bch, "connect the BCH key first"),
        { nostr: nostr.signer },
      );
    case "recover-nostr":
      return successor(
        need(change.newNostr, "choose the new Nostr key"),
        need(bch, "connect the BCH key first"),
        { recovery: recoverySigner(change) },
      );
    case "recover-bch":
      return successor(nostr, need(change.newBch, "choose the new BCH key"), {
        recovery: recoverySigner(change),
      });
    case "revoke": {
      const approvers: Approvers =
        change.revokeWith === "recovery"
          ? { recovery: recoverySigner(change) }
          : (() => {
              const current = need(bch, "connect the BCH key first");
              return { bch: { signer: current.signer, proofType: proofTypeOf(current) } };
            })();
      const revocation = await createRevocation({ previous, signer: nostr.signer, approvers });
      return { binding: revocation, nostr, bch };
    }
  }
}
