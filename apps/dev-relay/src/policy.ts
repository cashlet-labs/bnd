import {
  BINDING_D_TAG,
  BINDING_EVENT_KIND,
  verifyBinding,
  type NostrEvent,
} from "@cashlet-labs/bnd-core";
import type { MemoryRelay } from "@cashlet-labs/bnd-nostr/testing";

/** NIP-09 deletion. */
const DELETION_KIND = 5;

/**
 * The write rules of the Cashlet relays for BND events, so a local demo
 * behaves like the hosted one (BND-1 section 9.8):
 *
 * - a binding event (kind 30078, `d=bnd1`) must verify;
 * - a Nostr key's stored binding can only be replaced by a successor that
 *   carries it in its history;
 * - bindings cannot be deleted.
 *
 * Other events are accepted as before, so the relay still carries NIP-46
 * messages, relay lists and anything else a demo sends.
 */
export function bndWritePolicy(event: NostrEvent, relay: MemoryRelay): string | null {
  if (event.kind === DELETION_KIND) {
    const targetsBinding = event.tags.some(
      ([name, value]) =>
        (name === "a" && value?.startsWith(`${BINDING_EVENT_KIND}:`)) ||
        (name === "k" && value === String(BINDING_EVENT_KIND)),
    );
    return targetsBinding
      ? "blocked: bindings cannot be deleted here; revoke the binding instead"
      : null;
  }

  const d = event.tags.find((tag) => tag[0] === "d")?.[1];
  if (event.kind !== BINDING_EVENT_KIND || d !== BINDING_D_TAG) return null;

  const binding = verifyBinding(event);
  if (!binding.ok) return `invalid: ${binding.reason}`;

  const stored = relay.query([
    { kinds: [BINDING_EVENT_KIND], authors: [event.pubkey], "#d": [BINDING_D_TAG] },
  ]);
  for (const storedEvent of stored) {
    const existing = verifyBinding(storedEvent);
    if (!existing.ok || existing.bindingId === binding.bindingId) continue;
    if (binding.history.includes(existing.bindingId)) continue;
    return "blocked: this key already has a binding here; replace it with a successor approved by two of its keys";
  }
  return null;
}
