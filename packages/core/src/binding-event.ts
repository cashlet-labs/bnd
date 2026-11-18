import { schnorr } from "@noble/curves/secp256k1.js";
import {
  parseBchProof,
  proveBchControl,
  verifyBchProof,
  type BchProof,
  type BchProofType,
  type BchSigner,
} from "./bch-proof.js";
import type { BchNetwork } from "./bch.js";
import {
  bindingAddress,
  bindingId,
  buildBinding,
  parseBinding,
  type BindingRecord,
} from "./binding.js";
import { bytesToHex } from "./bytes.js";
import { canonicalize } from "./canonical.js";
import {
  isEventShape,
  signEvent,
  verifyEventSignature,
  type NostrEvent,
  type UnsignedEvent,
} from "./event.js";

/** NIP-78 application-specific data: an addressable event kind. */
export const BINDING_EVENT_KIND = 30078;
/** Fixed `d` tag: a Nostr key has at most one live binding. */
export const BINDING_D_TAG = "bnd1";

/** What the event content carries: the record both keys approve and the BCH proof. */
export interface BindingEnvelope {
  record: BindingRecord;
  bchProof: BchProof;
}

/**
 * Anything that can sign a Nostr event for one key. The shape follows NIP-07,
 * so a browser extension's `window.nostr` object satisfies it directly.
 */
export interface NostrSigner {
  getPublicKey(): Promise<string> | string;
  signEvent(template: UnsignedEvent): Promise<NostrEvent> | NostrEvent;
}

/** A signer that holds a raw secret key. For tests, demos and local tooling. */
export function createNostrKeySigner(privateKey: Uint8Array): NostrSigner {
  const publicKey = bytesToHex(schnorr.getPublicKey(privateKey));
  return {
    getPublicKey: () => publicKey,
    signEvent: (template) => signEvent(privateKey, template),
  };
}

function bindingTags(record: BindingRecord): string[][] {
  return [
    ["d", BINDING_D_TAG],
    ["b", record.bch.keyHash],
  ];
}

/** Build the event a Nostr signer signs. `created_at` equals the record's time. */
export function buildBindingEventTemplate(
  record: BindingRecord,
  bchProof: BchProof,
): UnsignedEvent {
  const parsed = parseBinding(record);
  const proof = parseBchProof(bchProof);
  return {
    kind: BINDING_EVENT_KIND,
    created_at: parsed.createdAt,
    tags: bindingTags(parsed),
    content: canonicalize({ bchProof: proof, record: parsed }),
  };
}

export type ParsedBindingEvent =
  | { ok: true; event: NostrEvent; record: BindingRecord; bchProof: BchProof }
  | { ok: false; reason: string };

function parseFailure(reason: string): ParsedBindingEvent {
  return { ok: false, reason };
}

/**
 * Check that an event has exactly the shape a binding event must have. This
 * does not check any signature. Every field that must agree is compared, and
 * tags and content must equal the canonical form byte for byte.
 */
export function parseBindingEvent(value: unknown): ParsedBindingEvent {
  if (!isEventShape(value)) return parseFailure("not a Nostr event");
  const event = value;
  if (event.kind !== BINDING_EVENT_KIND) return parseFailure("not a binding event kind");

  let content: unknown;
  try {
    content = JSON.parse(event.content);
  } catch {
    return parseFailure("event content is not JSON");
  }
  if (content === null || typeof content !== "object" || Array.isArray(content)) {
    return parseFailure("event content must be an object");
  }
  const members = content as Record<string, unknown>;
  if (Object.keys(members).sort().join(",") !== "bchProof,record") {
    return parseFailure("event content must have exactly bchProof and record");
  }

  let record: BindingRecord;
  let bchProof: BchProof;
  try {
    record = parseBinding(members.record);
    bchProof = parseBchProof(members.bchProof);
  } catch (error) {
    return parseFailure(`invalid binding content: ${(error as Error).message}`);
  }

  let canonical: string;
  try {
    canonical = canonicalize({ bchProof, record });
  } catch (error) {
    return parseFailure(`event content is not canonical: ${(error as Error).message}`);
  }
  if (event.content !== canonical) return parseFailure("event content is not canonical JSON");

  if (event.pubkey !== record.nostr.publicKey) {
    return parseFailure("event author is not the bound Nostr key");
  }
  if (event.created_at !== record.createdAt) {
    return parseFailure("event time does not match the record time");
  }
  if (JSON.stringify(event.tags) !== JSON.stringify(bindingTags(record))) {
    return parseFailure("event tags are not the required d and b tags");
  }
  return { ok: true, event, record, bchProof };
}

export interface VerifiedBinding {
  ok: true;
  /** The Nostr identity, as 32-byte lowercase hex. */
  nostrPublicKey: string;
  bch: { network: BchNetwork; keyHash: string; address: string };
  bindingId: string;
  record: BindingRecord;
  /** Which proof the BCH key gave. */
  proofType: BchProofType;
  event: NostrEvent;
}

export type VerifyBindingResult = VerifiedBinding | { ok: false; reason: string };

/**
 * Verify a binding event end to end, without contacting anyone: the event has
 * the exact required shape, the Nostr key signed it, and the BCH key approved
 * the same record. Both keys are proven or the result is a failure.
 */
export function verifyBinding(value: unknown): VerifyBindingResult {
  const parsed = parseBindingEvent(value);
  if (!parsed.ok) return parsed;
  if (!verifyEventSignature(parsed.event)) {
    return { ok: false, reason: "Nostr signature is invalid" };
  }
  const proof = verifyBchProof(parsed.record, parsed.bchProof);
  if (!proof.ok) return { ok: false, reason: `BCH proof is invalid: ${proof.reason}` };
  return {
    ok: true,
    nostrPublicKey: parsed.record.nostr.publicKey,
    bch: {
      network: parsed.record.bch.network,
      keyHash: parsed.record.bch.keyHash,
      address: bindingAddress(parsed.record),
    },
    bindingId: bindingId(parsed.record),
    record: parsed.record,
    proofType: parsed.bchProof.type,
    event: parsed.event,
  };
}

export interface CreateBindingOptions {
  nostrSigner: NostrSigner;
  bchSigner: BchSigner;
  /** HASH160 of the BCH key that `bchSigner` signs with. */
  bchKeyHash: Uint8Array | string;
  network: BchNetwork;
  /** The caller picks the proof; there is no automatic switch between types. */
  proofType: BchProofType;
  /** Unix seconds. Defaults to the current time. */
  createdAt?: number;
  /** ID of the binding this one replaces. */
  previous?: string;
}

/**
 * Create a binding: build the record, collect the BCH proof from the BCH
 * signer, have the Nostr signer sign the event, and verify the result before
 * returning it. A signer that changes the event is caught here.
 */
export async function createBinding(options: CreateBindingOptions): Promise<VerifiedBinding> {
  const nostrPublicKey = await options.nostrSigner.getPublicKey();
  const record = buildBinding({
    nostrPublicKey,
    bchKeyHash: options.bchKeyHash,
    network: options.network,
    ...(options.createdAt === undefined ? {} : { createdAt: options.createdAt }),
    ...(options.previous === undefined ? {} : { previous: options.previous }),
  });
  const bchProof = await proveBchControl(options.bchSigner, record, options.proofType);
  const event = await options.nostrSigner.signEvent(buildBindingEventTemplate(record, bchProof));
  const verified = verifyBinding(event);
  if (!verified.ok) throw new Error(`created binding is invalid: ${verified.reason}`);
  return verified;
}

/**
 * From events fetched for one Nostr key, return the newest valid binding.
 * Ties on time go to the lower event ID, as relays do. Invalid events and
 * events by other authors are ignored.
 *
 * Newest-wins is the discovery rule until succession checks are defined in
 * section 9 of the specification.
 */
export function pickCurrentBinding(
  events: readonly unknown[],
  nostrPublicKey: string,
): VerifiedBinding | null {
  let best: VerifiedBinding | null = null;
  for (const candidate of events) {
    const result = verifyBinding(candidate);
    if (!result.ok || result.nostrPublicKey !== nostrPublicKey) continue;
    if (
      best === null ||
      result.event.created_at > best.event.created_at ||
      (result.event.created_at === best.event.created_at && result.event.id < best.event.id)
    ) {
      best = result;
    }
  }
  return best;
}
