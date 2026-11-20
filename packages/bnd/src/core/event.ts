import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, isHex } from "./bytes.js";

/** A signed Nostr event as defined by NIP-01. */
export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/** An event before signing: the fields a signer fills in are absent. */
export interface UnsignedEvent {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

/**
 * NIP-01 event ID: SHA-256 of `[0, pubkey, created_at, kind, tags, content]`.
 *
 * `JSON.stringify` matches the NIP-01 serialization for the events this
 * library accepts. They contain no raw control characters, because binding
 * content is canonical JSON, which escapes them, and the tags are hex.
 */
export function eventId(event: {
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}): string {
  const serialized = JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);
  return bytesToHex(sha256(new TextEncoder().encode(serialized)));
}

function isStringTags(tags: unknown): tags is string[][] {
  return (
    Array.isArray(tags) &&
    tags.every((tag) => Array.isArray(tag) && tag.every((value) => typeof value === "string"))
  );
}

/** True when `value` has the shape of a NIP-01 event. It does not check the signature. */
export function isEventShape(value: unknown): value is NostrEvent {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return (
    isHex(event.id, 32) &&
    isHex(event.pubkey, 32) &&
    isHex(event.sig, 64) &&
    Number.isSafeInteger(event.created_at) &&
    (event.created_at as number) > 0 &&
    Number.isSafeInteger(event.kind) &&
    (event.kind as number) >= 0 &&
    (event.kind as number) <= 65535 &&
    isStringTags(event.tags) &&
    typeof event.content === "string"
  );
}

/** Check that the ID matches the content and that the BIP-340 signature is valid. */
export function verifyEventSignature(event: unknown): boolean {
  if (!isEventShape(event)) return false;
  if (eventId(event) !== event.id) return false;
  try {
    return schnorr.verify(hexToBytes(event.sig), hexToBytes(event.id), hexToBytes(event.pubkey));
  } catch {
    return false;
  }
}

/** Sign an event template with a Nostr secret key. */
export function signEvent(privateKey: Uint8Array, template: UnsignedEvent): NostrEvent {
  const pubkey = bytesToHex(schnorr.getPublicKey(privateKey));
  const fields = {
    pubkey,
    created_at: template.created_at,
    kind: template.kind,
    tags: template.tags,
    content: template.content,
  };
  const id = eventId(fields);
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), privateKey));
  return { id, ...fields, sig };
}
