import {
  BINDING_D_TAG,
  BINDING_EVENT_KIND,
  bytesToHex,
  MAX_HISTORY,
  npubDecode,
  resolveIdentity,
  SUCCESSOR_TAG,
  verifyBinding,
  type IdentityKey,
  type IdentityState,
  type NostrEvent,
  type VerifiedBinding,
} from "@cashlet-labs/bnd-core";
import type { Filter } from "./filter.js";
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
  /** What the bindings found say about the identity (section 9). */
  state: IdentityState;
  /** The current binding, or null when there is none, it was revoked, or it is disputed. */
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

function relevant(event: NostrEvent, key: IdentityKey): VerifiedBinding | null {
  const result = verifyBinding(event);
  if (!result.ok) return null;
  const names = (record: VerifiedBinding["record"]) =>
    record.nostr.publicKey === key.nostrPublicKey || record.bch.keyHash === key.bchKeyHash;
  return names(result.record) || result.ancestors.some(names) ? result : null;
}

/**
 * Ask every relay with the `initial` filters, then keep asking for successors (`#s`) of
 * the newest bindings found, so a binding replaced by a new key or revoked is
 * seen even where relays still hold the old one. Every event is verified
 * locally; a relay can only hide bindings, never add one.
 */
export async function collectBindings(
  initial: readonly Filter[],
  key: IdentityKey,
  options: DiscoveryOptions = {},
): Promise<{ events: NostrEvent[]; relays: RelayReport[] }> {
  const urls = relayList(options);
  const events = new Map<string, NostrEvent>();
  const reports = new Map<string, RelayReport>(
    urls.map((url) => [url, { url, received: 0, valid: 0, complete: true }]),
  );
  const asked = new Set<string>();
  let filters: Filter[] = [...initial];
  for (let round = 0; round <= MAX_HISTORY && filters.length > 0; round++) {
    const results = await Promise.all(urls.map((url) => queryRelay(url, filters, options)));
    let added = false;
    for (const result of results) {
      const entry = reports.get(result.url)!;
      entry.received += result.events.length;
      entry.complete = entry.complete && result.complete;
      if (result.error !== undefined && entry.error === undefined) entry.error = result.error;
      for (const event of result.events) {
        if (relevant(event, key) === null) continue;
        entry.valid += 1;
        if (!events.has(event.id)) {
          events.set(event.id, event);
          added = true;
        }
      }
    }
    if (!added) break;
    const ids = new Set<string>();
    for (const event of events.values()) {
      const binding = relevant(event, key);
      if (binding && !asked.has(binding.bindingId)) ids.add(binding.bindingId);
    }
    for (const id of ids) asked.add(id);
    filters =
      ids.size === 0
        ? []
        : [{ kinds: [BINDING_EVENT_KIND], [`#${SUCCESSOR_TAG}`]: [...ids], limit: 50 }];
  }
  return { events: [...events.values()], relays: [...reports.values()] };
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
  const nostrPublicKey = toPublicKey(nostrKey);
  const filter = {
    kinds: [BINDING_EVENT_KIND],
    authors: [nostrPublicKey],
    "#d": [BINDING_D_TAG],
    limit: 10,
  };
  const { events, relays } = await collectBindings([filter], { nostrPublicKey }, options);
  const state = resolveIdentity(events, { nostrPublicKey });
  return { state, binding: state.status === "current" ? state.binding : null, relays };
}

export interface ReverseDiscoveryResult {
  /** What the bindings found say about the BCH key (section 9). */
  state: IdentityState;
  /**
   * The bindings that currently claim the key: one when settled, several when
   * disputed, none when the key was rotated away, revoked or never bound.
   */
  bindings: VerifiedBinding[];
  relays: RelayReport[];
}

/**
 * Find the Nostr identity that claims a BCH key. Claims are not trusted: only
 * bindings that verify count, and two identities claiming one key is a dispute.
 */
export async function discoverByBchKeyHash(
  keyHash: Uint8Array | string,
  options: DiscoveryOptions = {},
): Promise<ReverseDiscoveryResult> {
  const bchKeyHash = typeof keyHash === "string" ? keyHash : bytesToHex(keyHash);
  if (!HEX_40.test(bchKeyHash)) throw new TypeError("expected a 20-byte key hash in lowercase hex");
  const filter = { kinds: [BINDING_EVENT_KIND], "#b": [bchKeyHash], limit: 50 };
  const { events, relays } = await collectBindings([filter], { bchKeyHash }, options);
  const state = resolveIdentity(events, { bchKeyHash });
  const bindings =
    state.status === "disputed"
      ? state.bindings
      : state.status === "current" && state.binding.bch.keyHash === bchKeyHash
        ? [state.binding]
        : [];
  return { state, bindings, relays };
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
