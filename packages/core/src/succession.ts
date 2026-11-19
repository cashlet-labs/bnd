import type { BchProof, BchStatement } from "./bch-proof.js";
import { bindingAddress, bindingId, parseBinding, type BindingRecord } from "./binding.js";
import { hexToBytes, isHex } from "./bytes.js";
import { eventId, verifyEventSignature, type UnsignedEvent } from "./event.js";
import { fail, OK, type VerifyResult } from "./result.js";

/**
 * The most predecessors a binding may carry. A longer history would not fit a
 * relay's event size limit; past it, the user starts again with a new Nostr key.
 */
export const MAX_HISTORY = 32;

/** Kind of the event a Nostr or recovery key signs to approve a successor. */
export const APPROVAL_EVENT_KIND = 30078;
/** `d` tag of an approval event. Relays that store bindings refuse it. */
export const APPROVAL_D_TAG = "bnd1-approval";
/** Tag that names the binding a successor replaces, on bindings and approvals. */
export const SUCCESSOR_TAG = "s";

const SUCCESSION_OUTPOINT_DOMAIN = "bnd/1/virtual-utxo-succession\n";
const SUCCESSION_TAG = "bns1";

/** The keys of a binding that can approve its successor. */
export type ApprovalRole = "nostr" | "bch" | "recovery";

/**
 * Explicit approvals of a successor by keys of the previous binding. A key
 * that is kept approves implicitly and needs no entry here (section 9).
 *
 * The Nostr and recovery approvals are the BIP-340 signatures of approval
 * events. Every other field of those events follows from the records, so only
 * the signature is carried.
 */
export interface Approvals {
  /** Signature of the approval event by the previous Nostr key. */
  nostr?: string;
  /** Proof by the previous BCH key of the succession statement. */
  bch?: BchProof;
  /** Signature of the approval event by the previous recovery key. */
  recovery?: string;
}

/**
 * The event a Nostr or recovery key signs to approve `next` replacing its
 * binding. It is an ordinary event template, so NIP-07 and NIP-46 signers can
 * sign it. Only its signature is carried in the successor; it is never
 * published on its own.
 */
export function approvalEventTemplate(next: BindingRecord): UnsignedEvent {
  const parsed = parseBinding(next);
  return {
    kind: APPROVAL_EVENT_KIND,
    created_at: parsed.createdAt,
    tags: [
      ["d", APPROVAL_D_TAG],
      [SUCCESSOR_TAG, bindingId(parsed)],
    ],
    content: "",
  };
}

/**
 * Check an approval: `signature` is `publicKey`'s BIP-340 signature of the
 * approval event for `next`. The event is rebuilt from the records, so a
 * signature for any other binding, or by any other key, fails.
 */
export function verifyApprovalSignature(
  signature: unknown,
  publicKey: string,
  next: BindingRecord,
): VerifyResult {
  if (typeof signature !== "string" || !isHex(signature, 64)) {
    return fail("approval must be a 64-byte signature in lowercase hex");
  }
  const template = approvalEventTemplate(next);
  const event = { ...template, pubkey: publicKey, id: "", sig: signature };
  event.id = eventId(event);
  if (!verifyEventSignature(event)) return fail("approval signature is invalid");
  return OK;
}

/**
 * What the previous BCH key approves when its binding is replaced or revoked.
 * The text and commitment differ from a binding proof and a login, so none of
 * the three can be passed off as another.
 */
export function successionStatement(previous: BindingRecord, next: BindingRecord): BchStatement {
  const before = parseBinding(previous);
  const after = parseBinding(next);
  const nextId = bindingId(after);
  const action = after.revoked ? "revoke" : "replace";
  return {
    keyHash: before.bch.keyHash,
    text: [
      "bnd/1/succession",
      `action: ${action}`,
      `binding: ${nextId}`,
      `replaces: ${bindingId(before)}`,
      `bch: ${bindingAddress(before)}`,
      `created: ${after.createdAt}`,
    ].join("\n"),
    commitment: {
      keyHash: before.bch.keyHash,
      outpointDomain: SUCCESSION_OUTPOINT_DOMAIN,
      tag: SUCCESSION_TAG,
      digest: hexToBytes(nextId),
      subject: "succession",
      prompt:
        action === "revoke"
          ? `Revoke BND binding ${bindingId(before).slice(0, 16)}. Nothing is sent.`
          : `Approve replacing BND binding ${bindingId(before).slice(0, 16)}. Nothing is sent.`,
    },
  };
}
