export { canonicalize, canonicalBytes, CanonicalizationError } from "./canonical.js";
export type { CanonicalValue } from "./canonical.js";
export { base64ToBytes, bytesToBase64, bytesToHex, hexToBytes } from "./bytes.js";
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
export {
  bchProofMessage,
  bitcoinMessageHash,
  recoverMessageKeyHash,
  signBitcoinMessage,
  verifyMessageProof,
} from "./bch-message.js";
export type { VerifyResult } from "./result.js";
export {
  buildTxProofRequest,
  signTxProof,
  txProofCommitment,
  verifyTxProof,
  virtualOutpointHash,
} from "./tx-proof.js";
export type { TxProofRequest, TxProofSignature } from "./tx-proof.js";
export { signTxProofRequest } from "./tx-proof.js";
export { createKeySigner, parseBchProof, proveBchControl, verifyBchProof } from "./bch-proof.js";
export type { BchProof, BchProofType, BchSigner } from "./bch-proof.js";
export { eventId, isEventShape, signEvent, verifyEventSignature } from "./event.js";
export type { NostrEvent, UnsignedEvent } from "./event.js";
export {
  BINDING_D_TAG,
  BINDING_EVENT_KIND,
  buildBindingEventTemplate,
  createBinding,
  createNostrKeySigner,
  parseBindingEvent,
  pickCurrentBinding,
  verifyBinding,
} from "./binding-event.js";
export type {
  BindingEnvelope,
  CreateBindingOptions,
  NostrSigner,
  ParsedBindingEvent,
  VerifiedBinding,
  VerifyBindingResult,
} from "./binding-event.js";
export { npubDecode, npubEncode } from "./npub.js";
export { verifyMessageSignature } from "./bch-message.js";
export { bindingStatement, proveStatement, verifyStatementProof } from "./bch-proof.js";
export type { BchStatement } from "./bch-proof.js";
export {
  bindingTxCommitment,
  buildCommitmentTxRequest,
  commitmentData,
  commitmentOutpointHash,
  verifyCommitmentTx,
} from "./tx-proof.js";
export type { TxCommitment } from "./tx-proof.js";
export {
  AUTH_EVENT_KIND,
  AUTH_EVENT_WINDOW_SECONDS,
  CHALLENGE_TTL_SECONDS,
  authEventTemplate,
  authStatement,
  checkLoginResponse,
  createLoginResponse,
  isAuthLevel,
  issueChallenge,
  parseChallenge,
  verifyLogin,
} from "./auth.js";
export type {
  AuthChallenge,
  AuthIdentity,
  AuthLevel,
  CreateLoginResponseOptions,
  IssueChallengeOptions,
  LoginResponse,
  LoginResult,
  VerifyLoginOptions,
} from "./auth.js";
export { ChallengeStoreFullError, MemoryChallengeStore } from "./challenge-store.js";
export type { ChallengeStore, MemoryChallengeStoreOptions } from "./challenge-store.js";
