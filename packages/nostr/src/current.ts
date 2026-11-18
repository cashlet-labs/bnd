import {
  BINDING_D_TAG,
  BINDING_EVENT_KIND,
  pickCurrentBinding,
  verifyBinding,
  type NostrEvent,
  type VerifiedBinding,
} from "@cashlet-labs/bnd-core";
import { queryRelay, type QueryResult, type RelayOptions } from "./client.js";
import { DEFAULT_RELAYS, type RelayReport } from "./discover.js";
import { discoverRelayList } from "./relay-list.js";
import { normalizeRelayUrl } from "./relay-url.js";

export interface CurrencyCheckOptions extends RelayOptions {
  /** Relays the application trusts to ask. Default DEFAULT_RELAYS. */
  relays?: readonly string[];
  /** Complete answers needed before any decision. Default 2. */
  minComplete?: number;
  /** Also ask the user's NIP-65 write relays. Default true. */
  followRelayList?: boolean;
  /**
   * Extra check for relays taken from the user's list, run before connecting.
   * Servers use it to refuse names that resolve to private addresses.
   */
  allowUserRelay?: (url: string) => boolean | Promise<boolean>;
}

export type CurrencyCheck =
  | { ok: true; relays: RelayReport[]; userRelays: string[] }
  | { ok: false; reason: string; relays: RelayReport[]; userRelays: string[] };

/**
 * Decide whether a verified binding is its key's current one, using relays:
 *
 * 1. At least `minComplete` relays must answer completely, or nothing is decided.
 * 2. The binding must be found on at least one answering relay, so it is public.
 * 3. No relay may hold a newer valid binding for the same key.
 *
 * Relays are untrusted. Every event is verified locally and invalid ones are
 * ignored, so a relay can only make the check fail, never pass.
 */
export async function checkCurrentBinding(
  binding: VerifiedBinding,
  options: CurrencyCheckOptions = {},
): Promise<CurrencyCheck> {
  const minComplete = options.minComplete ?? 2;
  if (!Number.isInteger(minComplete) || minComplete < 1) {
    throw new RangeError("minComplete must be a positive integer");
  }
  const configured = [...new Set((options.relays ?? DEFAULT_RELAYS).map(normalizeRelayUrl))];
  const publicKey = binding.nostrPublicKey;

  let userRelays: string[] = [];
  if (options.followRelayList ?? true) {
    const list = await discoverRelayList(publicKey, configured, options);
    for (const url of list.writeRelays) {
      if (configured.includes(url)) continue;
      if (options.allowUserRelay && !(await options.allowUserRelay(url))) continue;
      userRelays.push(url);
    }
  }
  userRelays = [...new Set(userRelays)];

  const filter = {
    kinds: [BINDING_EVENT_KIND],
    authors: [publicKey],
    "#d": [BINDING_D_TAG],
    limit: 10,
  };
  const results: QueryResult[] = await Promise.all(
    [...configured, ...userRelays].map((url) => queryRelay(url, [filter], options)),
  );

  const events = new Map<string, NostrEvent>();
  const reports: RelayReport[] = [];
  let found = false;
  for (const result of results) {
    let valid = 0;
    for (const event of result.events) {
      const verified = verifyBinding(event);
      if (!verified.ok || verified.nostrPublicKey !== publicKey) continue;
      valid += 1;
      events.set(event.id, event);
      if (event.id === binding.event.id) found = true;
    }
    reports.push({
      url: result.url,
      received: result.events.length,
      valid,
      complete: result.complete,
      ...(result.error === undefined ? {} : { error: result.error }),
    });
  }

  const complete = reports.filter((report) => report.complete).length;
  const fail = (reason: string): CurrencyCheck => ({
    ok: false,
    reason,
    relays: reports,
    userRelays,
  });
  if (complete < minComplete) {
    return fail(`could not check: ${complete} of the required ${minComplete} relays answered`);
  }
  if (!found) return fail("binding is not published on any relay that answered");
  const current = pickCurrentBinding([...events.values(), binding.event], publicKey);
  if (current === null || current.event.id !== binding.event.id) {
    return fail("a newer binding exists for this Nostr key");
  }
  return { ok: true, relays: reports, userRelays };
}
