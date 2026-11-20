import { isEventShape, verifyEventSignature, type NostrEvent } from "../core/index.js";
import { queryRelay, type RelayOptions } from "./client.js";
import { isSafeRelayUrl, normalizeRelayUrl } from "./relay-url.js";

/** NIP-65 relay list metadata. */
export const RELAY_LIST_KIND = 10002;
/** NIP-65 asks clients to keep lists to a few relays; more are ignored. */
export const MAX_USER_RELAYS = 4;

/**
 * The relays a user writes to, from their NIP-65 list. Read-only entries are
 * skipped, because a user's own events are found on their write relays.
 * Unsafe URLs are dropped and at most four are kept, in the listed order.
 */
export function writeRelaysFromList(event: NostrEvent, publicKey: string): string[] {
  if (event.kind !== RELAY_LIST_KIND || event.pubkey !== publicKey) return [];
  const relays: string[] = [];
  for (const tag of event.tags) {
    if (tag[0] !== "r" || tag.length > 3) continue;
    const [, url, marker] = tag;
    if (marker !== undefined && marker !== "write") continue;
    if (!isSafeRelayUrl(url)) continue;
    const normalized = normalizeRelayUrl(url);
    if (!relays.includes(normalized)) relays.push(normalized);
    if (relays.length === MAX_USER_RELAYS) break;
  }
  return relays;
}

export interface RelayListResult {
  /** The newest valid relay list event, or null. */
  event: NostrEvent | null;
  /** Its write relays after the safety rules. */
  writeRelays: string[];
}

/** Fetch a user's newest signed NIP-65 relay list from the given relays. */
export async function discoverRelayList(
  publicKey: string,
  relays: readonly string[],
  options: RelayOptions = {},
): Promise<RelayListResult> {
  const filter = { kinds: [RELAY_LIST_KIND], authors: [publicKey], limit: 5 };
  const results = await Promise.all(relays.map((url) => queryRelay(url, [filter], options)));
  let newest: NostrEvent | null = null;
  for (const result of results) {
    for (const event of result.events) {
      if (!isEventShape(event) || event.kind !== RELAY_LIST_KIND || event.pubkey !== publicKey)
        continue;
      if (!verifyEventSignature(event)) continue;
      if (
        newest === null ||
        event.created_at > newest.created_at ||
        (event.created_at === newest.created_at && event.id < newest.id)
      ) {
        newest = event;
      }
    }
  }
  return { event: newest, writeRelays: newest ? writeRelaysFromList(newest, publicKey) : [] };
}
