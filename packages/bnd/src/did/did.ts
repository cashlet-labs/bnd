import { isBchNetwork, type BchNetwork, type VerifiedBinding } from "../core/index.js";

/** DID method name. */
export const DID_METHOD = "bnd";

/**
 * A did:bnd identifier names an identity by its first binding: the network,
 * the Nostr key that made it, and its binding ID. All three are fixed for
 * the identity's life, so the DID stays the same however often its keys
 * rotate.
 *
 *   did:bnd:<network>:<root Nostr key, 64 hex>:<root binding ID, 64 hex>
 */
export interface BndDid {
  network: BchNetwork;
  /** x-only public key of the root binding's Nostr key, lowercase hex. */
  rootNostrKey: string;
  /** Binding ID of the identity's first binding, lowercase hex. */
  rootBindingId: string;
}

export class InvalidDidError extends Error {
  override name = "InvalidDidError";
}

const HEX64 = /^[0-9a-f]{64}$/;

/** Parse a did:bnd identifier. Anything else throws InvalidDidError. */
export function parseDid(did: string): BndDid {
  const parts = did.split(":");
  if (parts.length !== 5 || parts[0] !== "did" || parts[1] !== DID_METHOD) {
    throw new InvalidDidError("expected did:bnd:<network>:<nostr key>:<binding id>");
  }
  const [, , network, rootNostrKey, rootBindingId] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (!isBchNetwork(network)) throw new InvalidDidError("network must be mainnet or chipnet");
  if (!HEX64.test(rootNostrKey)) {
    throw new InvalidDidError("the Nostr key must be 64 lowercase hex characters");
  }
  if (!HEX64.test(rootBindingId)) {
    throw new InvalidDidError("the binding ID must be 64 lowercase hex characters");
  }
  return { network, rootNostrKey, rootBindingId };
}

export function formatDid(did: BndDid): string {
  return `did:${DID_METHOD}:${did.network}:${did.rootNostrKey}:${did.rootBindingId}`;
}

/** The DID of the identity a verified binding belongs to. */
export function didOf(binding: VerifiedBinding): string {
  const root = binding.ancestors[0] ?? binding.record;
  return formatDid({
    network: root.bch.network,
    rootNostrKey: root.nostr.publicKey,
    rootBindingId: binding.history[0] ?? binding.bindingId,
  });
}
