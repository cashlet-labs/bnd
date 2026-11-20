export { DID_METHOD, didOf, formatDid, InvalidDidError, parseDid } from "./did.js";
export type { BndDid } from "./did.js";
export { blockchainAccountIdOf, DID_CONTEXTS, didDocument, multikeyOf } from "./document.js";
export type { DidDocument, VerificationMethod } from "./document.js";
export { resolveDid, resolveDidFromEvents } from "./resolve.js";
export type { DidResolutionResult, ResolutionError, ResolveDidOptions } from "./resolve.js";
