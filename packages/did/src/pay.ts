import {
  encodeBchAddress,
  hexToBytes,
  npubDecode,
  verifyBinding,
  type VerifiedBinding,
} from "@cashlet-labs/bnd-core";
import { discoverBinding, type RelayReport } from "@cashlet-labs/bnd-nostr";
import { didOf } from "./did.js";
import { resolveDid, type ResolveDidOptions } from "./resolve.js";

/** Where to pay an identity, found and verified from relays. */
export interface Payee {
  binding: VerifiedBinding;
  did: string;
  /** The current BCH address, plain form (`bitcoincash:q…` / `bchtest:q…`). */
  address: string;
  /** The same key's token-aware address (`…:z…`), for sending CashTokens. */
  tokenAddress: string;
  relays: RelayReport[];
}

export type PayeeResult = ({ ok: true } & Payee) | { ok: false; reason: string };

function complete(relays: readonly RelayReport[]): number {
  return relays.filter((report) => report.complete).length;
}

/**
 * Resolve an npub, a 64-hex Nostr key or a did:bnd to the identity's current,
 * verified BCH address. It is refused when too few relays answer completely,
 * when the identity is revoked or disputed, or when nothing is found: a
 * payment must not go to a stale or contested address.
 */
export async function resolvePayee(
  target: string,
  options: ResolveDidOptions = {},
): Promise<PayeeResult> {
  const value = target.trim();
  const minComplete = options.minComplete ?? 2;
  let binding: VerifiedBinding;
  let relays: RelayReport[];

  if (value.startsWith("did:")) {
    const result = await resolveDid(value, options);
    const metadata = result.didResolutionMetadata;
    if ("error" in metadata) return { ok: false, reason: metadata.errorMessage };
    if (result.didDocumentMetadata.deactivated) {
      return { ok: false, reason: "this identity has been revoked" };
    }
    const event = result.didDocumentMetadata.bnd?.event;
    const verified = verifyBinding(event);
    if (!verified.ok) return { ok: false, reason: verified.reason };
    binding = verified;
    relays = result.relays;
  } else {
    let publicKey: string;
    try {
      publicKey = /^[0-9a-f]{64}$/.test(value) ? value : npubDecode(value);
    } catch {
      return { ok: false, reason: "enter an npub, a Nostr public key or a did:bnd" };
    }
    const found = await discoverBinding(publicKey, options);
    relays = found.relays;
    if (complete(relays) < minComplete) {
      return {
        ok: false,
        reason: `could not check: ${complete(relays)} of the required ${minComplete} relays answered`,
      };
    }
    switch (found.state.status) {
      case "none":
        return { ok: false, reason: "no verified binding was found for this key" };
      case "revoked":
        return { ok: false, reason: "this identity has been revoked" };
      case "disputed":
        return {
          ok: false,
          reason: "conflicting bindings claim this identity; do not pay until it is settled",
        };
      case "current":
        binding = found.state.binding;
    }
  }

  const keyHash = hexToBytes(binding.bch.keyHash);
  return {
    ok: true,
    binding,
    did: didOf(binding),
    address: binding.bch.address,
    tokenAddress: encodeBchAddress(keyHash, binding.bch.network, { tokenAware: true }),
    relays,
  };
}

/** Options of a `bitcoincash:` payment URI (BIP21). */
export interface PaymentUriOptions {
  /** Amount in BCH as a decimal string, at most 8 places, for example "0.0015". */
  amount?: string;
  label?: string;
  message?: string;
}

const AMOUNT = /^(?:0|[1-9][0-9]{0,7})(?:\.[0-9]{1,8})?$/;

/**
 * A BIP21 payment URI for a BCH address, which wallets open with the amount
 * filled in. The address keeps its CashAddr prefix, as wallets expect.
 */
export function paymentUri(address: string, options: PaymentUriOptions = {}): string {
  const params: string[] = [];
  if (options.amount !== undefined && options.amount !== "") {
    if (!AMOUNT.test(options.amount) || Number(options.amount) <= 0) {
      throw new RangeError("the amount must be a positive number of BCH with at most 8 decimals");
    }
    params.push(`amount=${options.amount}`);
  }
  if (options.label) params.push(`label=${encodeURIComponent(options.label)}`);
  if (options.message) params.push(`message=${encodeURIComponent(options.message)}`);
  return params.length === 0 ? address : `${address}?${params.join("&")}`;
}
