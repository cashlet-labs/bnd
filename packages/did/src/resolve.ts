import {
  BINDING_D_TAG,
  BINDING_EVENT_KIND,
  SUCCESSOR_TAG,
  verifyBinding,
  type VerifiedBinding,
} from "@cashlet-labs/bnd-core";
import { collectBindings, type DiscoveryOptions, type RelayReport } from "@cashlet-labs/bnd-nostr";
import { parseDid, type BndDid, type InvalidDidError } from "./did.js";
import { didDocument, type DidDocument } from "./document.js";

/** DID Resolution error codes (W3C DID Resolution), plus `conflict` for a fork. */
export type ResolutionError = "invalidDid" | "notFound" | "conflict" | "internalError";

export interface DidResolutionResult {
  didDocument: DidDocument | null;
  didResolutionMetadata:
    { contentType: "application/did+ld+json" } | { error: ResolutionError; errorMessage: string };
  didDocumentMetadata: {
    /** Time of the root binding (Create). */
    created?: string;
    /** Time of the current binding, if it replaced another (Update). */
    updated?: string;
    /** True once the identity is revoked (Deactivate). */
    deactivated?: boolean;
    /** Binding ID of the current binding. */
    versionId?: string;
    /** BND details: the chain behind the document. */
    bnd?: {
      bindingId: string;
      /** Binding IDs of every earlier binding, oldest first. */
      history: string[];
      /** Keys of the previous binding that approved the current one. */
      approvedBy: string[];
      /** The current binding event, so anyone can verify it again. */
      event: VerifiedBinding["event"];
    };
  };
}

function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace(".000Z", "Z");
}

function failure(error: ResolutionError, errorMessage: string): DidResolutionResult {
  return {
    didDocument: null,
    didResolutionMetadata: { error, errorMessage },
    didDocumentMetadata: {},
  };
}

/** The root binding ID of a verified binding's chain. */
function rootOf(binding: VerifiedBinding): string {
  return binding.history[0] ?? binding.bindingId;
}

/**
 * Resolve a did:bnd from binding events already fetched, with no network.
 *
 * Only bindings whose chain starts at the DID's root count, so a second
 * first binding for the same Nostr key (a thief's, for instance) cannot
 * affect the DID. Bindings that appear in another's history are old. One
 * remaining binding is the current one; a revocation deactivates the DID;
 * more than one is a fork and resolves to `conflict`.
 */
export function resolveDidFromEvents(
  did: string,
  events: readonly unknown[],
  relays: readonly string[] = [],
): DidResolutionResult {
  let parsed: BndDid;
  try {
    parsed = parseDid(did);
  } catch (error) {
    return failure("invalidDid", (error as InvalidDidError).message);
  }

  const chain = new Map<string, VerifiedBinding>();
  for (const event of events) {
    const binding = verifyBinding(event);
    if (!binding.ok || rootOf(binding) !== parsed.rootBindingId) continue;
    const root = binding.ancestors[0] ?? binding.record;
    if (root.nostr.publicKey !== parsed.rootNostrKey || root.bch.network !== parsed.network) {
      continue;
    }
    chain.set(binding.bindingId, binding);
  }
  if (chain.size === 0) return failure("notFound", "no valid binding for this DID was found");

  const replaced = new Set<string>();
  for (const binding of chain.values()) for (const id of binding.history) replaced.add(id);
  const heads = [...chain.values()].filter((binding) => !replaced.has(binding.bindingId));
  if (heads.length !== 1) {
    return failure(
      "conflict",
      `${heads.length} bindings continue this identity on different branches; two of its keys must settle it`,
    );
  }

  const head = heads[0]!;
  const root = head.ancestors[0] ?? head.record;
  return {
    didDocument: didDocument(head, relays),
    didResolutionMetadata: { contentType: "application/did+ld+json" },
    didDocumentMetadata: {
      created: iso(root.createdAt),
      ...(head.history.length > 0 ? { updated: iso(head.record.createdAt) } : {}),
      ...(head.form === "revocation" ? { deactivated: true } : {}),
      versionId: head.bindingId,
      bnd: {
        bindingId: head.bindingId,
        history: head.history,
        approvedBy: head.approvedBy,
        event: head.event,
      },
    },
  };
}

export interface ResolveDidOptions extends DiscoveryOptions {
  /** Complete relay answers needed before resolving. Default 2. */
  minComplete?: number;
}

/**
 * Resolve a did:bnd using relays: ask for the root Nostr key's binding and
 * for successors of the root, follow successors to the head, then resolve as
 * resolveDidFromEvents does. Relays are untrusted: every event is verified,
 * and a relay can only hide bindings. Too few complete answers is an error,
 * not a stale answer.
 */
export async function resolveDid(
  did: string,
  options: ResolveDidOptions = {},
): Promise<DidResolutionResult & { relays: RelayReport[] }> {
  let parsed: BndDid;
  try {
    parsed = parseDid(did);
  } catch (error) {
    return { ...failure("invalidDid", (error as Error).message), relays: [] };
  }
  const { events, relays } = await collectBindings(
    [
      {
        kinds: [BINDING_EVENT_KIND],
        authors: [parsed.rootNostrKey],
        "#d": [BINDING_D_TAG],
        limit: 10,
      },
      { kinds: [BINDING_EVENT_KIND], [`#${SUCCESSOR_TAG}`]: [parsed.rootBindingId], limit: 10 },
    ],
    { nostrPublicKey: parsed.rootNostrKey },
    options,
  );
  const minComplete = options.minComplete ?? 2;
  const complete = relays.filter((report) => report.complete);
  if (complete.length < minComplete) {
    return {
      ...failure(
        "internalError",
        `could not resolve: ${complete.length} of the required ${minComplete} relays answered`,
      ),
      relays,
    };
  }
  const holding = relays.filter((report) => report.valid > 0).map((report) => report.url);
  return { ...resolveDidFromEvents(did, events, holding), relays };
}
