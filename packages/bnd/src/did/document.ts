import { bindingAddress, CHAIN_IDS, type VerifiedBinding } from "../core/index.js";
import { didOf } from "./did.js";

/** JSON-LD contexts of a did:bnd document. Only published, standard contexts. */
export const DID_CONTEXTS = [
  "https://www.w3.org/ns/did/v1",
  // Multikey and publicKeyMultibase (W3C Controlled Identifiers v1.0).
  "https://www.w3.org/ns/cid/v1",
  // EcdsaSecp256k1RecoveryMethod2020 and blockchainAccountId, as in did:pkh.
  "https://w3id.org/security/suites/secp256k1recovery-2020/v2",
] as const;

export interface VerificationMethod {
  id: string;
  type: "Multikey" | "EcdsaSecp256k1RecoveryMethod2020";
  controller: string;
  publicKeyMultibase?: string;
  blockchainAccountId?: string;
}

export interface DidDocument {
  "@context": readonly string[];
  id: string;
  alsoKnownAs: string[];
  verificationMethod: VerificationMethod[];
  authentication: string[];
  assertionMethod: string[];
  capabilityInvocation: string[];
  service?: { id: string; type: "Relay"; serviceEndpoint: string }[];
}

/**
 * A BIP-340 x-only key as a Multikey, encoded as did:nostr does: "f" (base16
 * multibase), "e701" (secp256k1-pub multicodec), "02" (even y, as BIP-340
 * keys are), then the 32-byte key.
 */
export function multikeyOf(xOnlyPublicKey: string): string {
  return `fe70102${xOnlyPublicKey}`;
}

/**
 * The BCH key as a CAIP-10 account: the BIP-122 chain ID, then the CashAddr
 * without its prefix (CAIP-10 does not allow a colon in the address part, and
 * the chain ID already names the network).
 */
export function blockchainAccountIdOf(binding: VerifiedBinding): string {
  const address = bindingAddress(binding.record);
  return `${CHAIN_IDS[binding.bch.network]}:${address.slice(address.indexOf(":") + 1)}`;
}

/**
 * The DID document of an identity whose current binding is `binding`:
 *
 * - #nostr: the current Nostr key, for authentication and assertions;
 * - #bch: the current BCH key, by its account, for authentication;
 * - #recovery: the recovery key, if the binding names one.
 *
 * Changing the DID needs two of the three keys (BND-1 section 9), so all of
 * them are listed for capabilityInvocation; none can do it alone.
 */
export function didDocument(binding: VerifiedBinding, relays: readonly string[] = []): DidDocument {
  const id = didOf(binding);
  const methods: VerificationMethod[] = [
    {
      id: `${id}#nostr`,
      type: "Multikey",
      controller: id,
      publicKeyMultibase: multikeyOf(binding.nostrPublicKey),
    },
    {
      id: `${id}#bch`,
      type: "EcdsaSecp256k1RecoveryMethod2020",
      controller: id,
      blockchainAccountId: blockchainAccountIdOf(binding),
    },
  ];
  const recovery = binding.record.recovery?.publicKey;
  if (recovery !== undefined) {
    methods.push({
      id: `${id}#recovery`,
      type: "Multikey",
      controller: id,
      publicKeyMultibase: multikeyOf(recovery),
    });
  }
  return {
    "@context": DID_CONTEXTS,
    id,
    alsoKnownAs: [`did:nostr:${binding.nostrPublicKey}`],
    verificationMethod: methods,
    authentication: [`${id}#nostr`, `${id}#bch`],
    assertionMethod: [`${id}#nostr`],
    capabilityInvocation: methods.map((method) => method.id),
    ...(relays.length === 0
      ? {}
      : {
          service: relays.map((url, index) => ({
            id: `${id}#relay-${index + 1}`,
            type: "Relay" as const,
            serviceEndpoint: url,
          })),
        }),
  };
}
