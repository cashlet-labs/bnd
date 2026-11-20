import {
  BINDING_D_TAG,
  BINDING_EVENT_KIND,
  resolveIdentity,
  SUCCESSOR_TAG,
  verifyBinding,
  type VerifiedBinding,
} from "../core/index.js";
import type { RelayOptions } from "./client.js";
import { collectBindings, DEFAULT_RELAYS, type RelayReport } from "./discover.js";
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
 * Decide whether a verified binding is its identity's current one, using relays:
 *
 * 1. At least `minComplete` relays must answer completely, or nothing is decided.
 * 2. The binding must be found on at least one answering relay, so it is public.
 * 3. No relay may hold a successor or a revocation of it, which also catches a
 *    Nostr key that was rotated away (section 9).
 * 4. No relay may hold a binding for the same key on another chain; the
 *    identity is then disputed.
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

  const { events, relays: reports } = await collectBindings(
    [
      { kinds: [BINDING_EVENT_KIND], authors: [publicKey], "#d": [BINDING_D_TAG], limit: 10 },
      { kinds: [BINDING_EVENT_KIND], [`#${SUCCESSOR_TAG}`]: [binding.bindingId], limit: 10 },
    ],
    { nostrPublicKey: publicKey },
    { ...options, relays: [...configured, ...userRelays] },
  );

  const fail = (reason: string): CurrencyCheck => ({
    ok: false,
    reason,
    relays: reports,
    userRelays,
  });
  const complete = reports.filter((report) => report.complete).length;
  if (complete < minComplete) {
    return fail(`could not check: ${complete} of the required ${minComplete} relays answered`);
  }
  const found = events.some((event) => {
    const verified = verifyBinding(event);
    return verified.ok && verified.bindingId === binding.bindingId;
  });
  if (!found) return fail("binding is not published on any relay that answered");

  const state = resolveIdentity([...events, binding.event], { nostrPublicKey: publicKey });
  if (state.status === "revoked") return fail("this identity has been revoked");
  if (state.status === "disputed") {
    return fail("conflicting bindings exist for this Nostr key; the identity is disputed");
  }
  if (state.status !== "current" || state.binding.bindingId !== binding.bindingId) {
    return fail("a newer binding replaces this one");
  }
  return { ok: true, relays: reports, userRelays };
}
