export { canonicalize, canonicalBytes, CanonicalizationError } from "./canonical.js";
export type { CanonicalValue } from "./canonical.js";
export { bytesToHex, hexToBytes } from "./bytes.js";
export {
  BCH_NETWORKS,
  addressPrefix,
  decodeBchAddress,
  encodeBchAddress,
  isBchNetwork,
  keyHashFromPublicKey,
} from "./bch.js";
export type { BchNetwork, DecodedBchAddress } from "./bch.js";
export { deriveBchKey, deriveNostrKey } from "./keys.js";
export type { BchKey, NostrKey } from "./keys.js";
export {
  BINDING_D_TAG,
  BINDING_EVENT_KIND,
  BindingError,
  PROTOCOL_ID,
  PROTOCOL_VERSION,
  bindingAddress,
  bindingBytes,
  bindingId,
  bindingMatchesAddress,
  buildBinding,
  parseBinding,
} from "./binding.js";
export type { BindingRecord, BuildBindingInput } from "./binding.js";
export { base64ToBytes, bytesToBase64 } from "./bytes.js";
export {
  bchProofMessage,
  bitcoinMessageHash,
  recoverMessageKeyHash,
  signBitcoinMessage,
  verifyMessageProof,
} from "./bch-message.js";
export type { VerifyResult } from "./result.js";
