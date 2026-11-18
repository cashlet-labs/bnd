import {
  BINDING_D_TAG,
  BINDING_EVENT_KIND,
  bytesToHex,
  isEventShape,
  npubDecode,
  pickCurrentBinding,
  verifyBinding,
  type NostrEvent,
  type VerifiedBinding,
} from "@cashlet-labs/bnd-core";
import { publishToRelay, queryRelay, type PublishResult, type RelayOptions } from "./client.js";

/** Public relays that accepted and indexed binding events when this was written. */
export const DEFAULT_RELAYS: readonly string[] = [
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://offchain.pub",
  "wss://relay.damus.io",
  "wss://nostr.mom",
];

export interface DiscoveryOptions extends RelayOptions {
  relays?: readonly string[];
}

export interface RelayReport {
  url: string;
  /** Events the relay returned. */
  received: number;
  /** How many of them were valid bindings. */
  valid: number;
  /** True when the relay reported it had sent everything it stored. */
  complete: boolean;
  error?: string;
}

export interface DiscoveryResult {
  /** The newest valid binding for the key, or null if none was found. */
  binding: VerifiedBinding | null;
  relays: RelayReport[];
}

const HEX_64 = /^[0-9a-f]{64}$/;
const HEX_40 = /^[0-9a-f]{40}$/;

function relayList(options: DiscoveryOptions): string[] {
  return [...new Set(options.relays ?? DEFAULT_RELAYS)];
}

/** Accept a 32-byte hex key or an `npub` string and return hex. */
function toPublicKey(value: string): string {
  if (HEX_64.test(value)) return value;
  return npubDecode(value);
}

function report(
  url: string,
  events: readonly NostrEvent[],
  complete: boolean,
  error: string | undefined,
  isValid: (event: NostrEvent) => boolean,
): RelayReport {
  return {
    url,
    received: events.length,
    valid: events.filter(isValid).length,
    complete,
    ...(error === undefined ? {} : { error }),
  };
}

/**
 * Find the current binding of a Nostr key. Every relay is asked, every event is
 * verified locally, and relay answers are never trusted. A relay that fails,
 * lies or stays silent only reduces what is found.
 */
export async function discoverBinding(
  nostrKey: string,
  options: DiscoveryOptions = {},
): Promise<DiscoveryResult> {
  const publicKey = toPublicKey(nostrKey);
  const filter = {
    kinds: [BINDING_EVENT_KIND],
    authors: [publicKey],
    "#d": [BINDING_D_TAG],
    limit: 10,
  };
  const results = await Promise.all(
    relayList(options).map((url) => queryRelay(url, [filter], options)),
  );
  const events = new Map<string, NostrEvent>();
  const isValid = (event: NostrEvent): boolean => {
    const result = verifyBinding(event);
    return result.ok && result.nostrPublicKey === publicKey;
  };
  const reports: RelayReport[] = [];
  for (const result of results) {
    for (const event of result.events) events.set(event.id, event);
    reports.push(report(result.url, result.events, result.complete, result.error, isValid));
  }
  return { binding: pickCurrentBinding([...events.values()], publicKey), relays: reports };
}

export interface ReverseDiscoveryResult {
  /** One current binding per Nostr key that proved control of the BCH key. */
  bindings: VerifiedBinding[];
  relays: RelayReport[];
}

/**
 * Find the Nostr identities that claim a BCH key. Claims are not trusted: only
 * bindings that verify, and that name exactly this key hash, are returned.
 */
export async function discoverByBchKeyHash(
  keyHash: Uint8Array | string,
  options: DiscoveryOptions = {},
): Promise<ReverseDiscoveryResult> {
  const hash = typeof keyHash === "string" ? keyHash : bytesToHex(keyHash);
  if (!HEX_40.test(hash)) throw new TypeError("expected a 20-byte key hash in lowercase hex");
  const filter = { kinds: [BINDING_EVENT_KIND], "#b": [hash], limit: 50 };
  const results = await Promise.all(
    relayList(options).map((url) => queryRelay(url, [filter], options)),
  );
  const events = new Map<string, NostrEvent>();
  const isValid = (event: NostrEvent): boolean => {
    const result = verifyBinding(event);
    return result.ok && result.bch.keyHash === hash;
  };
  const reports: RelayReport[] = [];
  for (const result of results) {
    for (const event of result.events) events.set(event.id, event);
    reports.push(report(result.url, result.events, result.complete, result.error, isValid));
  }
  const authors = new Set<string>();
  for (const event of events.values()) if (isEventShape(event)) authors.add(event.pubkey);
  const bindings: VerifiedBinding[] = [];
  for (const author of authors) {
    const current = pickCurrentBinding([...events.values()], author);
    // Relays replace older events that share a `d` tag, so a Nostr key that has rebound
    // normally drops out of this query. A relay can still serve stale data, so for a
    // payment resolve the Nostr key itself with discoverBinding and use that address.
    if (current && current.bch.keyHash === hash) bindings.push(current);
  }
  bindings.sort(
    (a, b) => b.event.created_at - a.event.created_at || (a.event.id < b.event.id ? -1 : 1),
  );
  return { bindings, relays: reports };
}

export interface PublishSummary {
  /** True when at least one relay accepted the event. */
  ok: boolean;
  accepted: string[];
  failed: PublishResult[];
}

/**
 * Publish a binding event to every relay. The event is verified first, so a
 * malformed or unproven binding is never sent.
 */
export async function publishBinding(
  event: NostrEvent,
  options: DiscoveryOptions = {},
): Promise<PublishSummary> {
  const verified = verifyBinding(event);
  if (!verified.ok) throw new Error(`refusing to publish an invalid binding: ${verified.reason}`);
  const results = await Promise.all(
    relayList(options).map((url) => publishToRelay(url, event, options)),
  );
  const accepted = results.filter((r) => r.ok).map((r) => r.url);
  return { ok: accepted.length > 0, accepted, failed: results.filter((r) => !r.ok) };
}
