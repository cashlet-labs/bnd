import { sha256 } from "@noble/hashes/sha2.js";
import {
  parseBchProof,
  proveStatement,
  verifyStatementProof,
  type BchProof,
  type BchProofType,
  type BchSigner,
  type BchStatement,
} from "./bch-proof.js";
import { CHAIN_IDS, type BchNetwork } from "./bch.js";
import { bindingAddress, bindingId, type BindingRecord } from "./binding.js";
import { verifyBinding, type NostrSigner, type VerifiedBinding } from "./binding-event.js";
import { bytesToHex, isHex } from "./bytes.js";
import type { ChallengeStore } from "./challenge-store.js";
import {
  isEventShape,
  verifyEventSignature,
  type NostrEvent,
  type UnsignedEvent,
} from "./event.js";
import { npubEncode } from "./npub.js";
import { fail, type VerifyResult } from "./result.js";

/**
 * What an application asks for. `nostr`: the Nostr key signs. `dual`: the Nostr
 * key and the BCH key both sign. The response must meet the level exactly.
 */
export type AuthLevel = "nostr" | "dual";

export interface AuthChallenge {
  /** 32 random bytes, lowercase hex. Used once. */
  nonce: string;
  /** The absolute URL of the endpoint that receives the response. */
  audience: string;
  level: AuthLevel;
  /** Unix seconds. */
  issuedAt: number;
  /** Unix seconds. */
  expiresAt: number;
}

/** What a user sends back to log in. */
export interface LoginResponse {
  /** The user's binding event, as published. */
  binding: NostrEvent;
  /** The Nostr key's signature over this challenge, as a NIP-98 event. */
  event: NostrEvent;
  /** The BCH key's approval. Present for `dual` and absent for `nostr`. */
  bchProof?: BchProof;
}

/** Kind of the Nostr login event. NIP-98 defines it for HTTP authentication. */
export const AUTH_EVENT_KIND = 27235;
/** How far the login event's time may differ from the verifier's clock. */
export const AUTH_EVENT_WINDOW_SECONDS = 60;
/** Default lifetime of a challenge. */
export const CHALLENGE_TTL_SECONDS = 300;

const AUTH_OUTPOINT_DOMAIN = "bnd/1/virtual-utxo-auth\n";
const AUTH_TAG = "bna1";
const AUDIENCE = /^https?:\/\/[^\s#]{1,300}$/;

export function isAuthLevel(value: unknown): value is AuthLevel {
  return value === "nostr" || value === "dual";
}

/** Validate untrusted input as a challenge. Unknown members are an error. */
export function parseChallenge(value: unknown): AuthChallenge {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("challenge must be an object");
  }
  const challenge = value as Record<string, unknown>;
  if (Object.keys(challenge).sort().join(",") !== "audience,expiresAt,issuedAt,level,nonce") {
    throw new TypeError(
      "challenge must have exactly audience, expiresAt, issuedAt, level and nonce",
    );
  }
  if (!isHex(challenge.nonce, 32)) throw new TypeError("challenge nonce must be 32 bytes of hex");
  if (typeof challenge.audience !== "string" || !AUDIENCE.test(challenge.audience)) {
    throw new TypeError("challenge audience must be an absolute http or https URL");
  }
  if (!isAuthLevel(challenge.level)) throw new TypeError("challenge level must be nostr or dual");
  const { issuedAt, expiresAt } = challenge;
  if (
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt) ||
    (issuedAt as number) <= 0 ||
    (expiresAt as number) <= (issuedAt as number)
  ) {
    throw new TypeError("challenge times must be positive integers with expiry after issue");
  }
  return {
    nonce: challenge.nonce,
    audience: challenge.audience,
    level: challenge.level,
    issuedAt: issuedAt as number,
    expiresAt: expiresAt as number,
  };
}

export interface IssueChallengeOptions {
  /** The absolute URL of the endpoint that will receive the response. */
  audience: string;
  level: AuthLevel;
  /** Unix seconds. Defaults to the current time. */
  now?: number;
  /** Seconds the challenge stays valid. Default 300. */
  ttlSeconds?: number;
}

/** Create a challenge and store it. The nonce comes from a secure random source. */
export async function issueChallenge(
  store: ChallengeStore,
  options: IssueChallengeOptions,
): Promise<AuthChallenge> {
  const issuedAt = options.now ?? Math.floor(Date.now() / 1000);
  const challenge = parseChallenge({
    nonce: bytesToHex(crypto.getRandomValues(new Uint8Array(32))),
    audience: options.audience,
    level: options.level,
    issuedAt,
    expiresAt: issuedAt + (options.ttlSeconds ?? CHALLENGE_TTL_SECONDS),
  });
  await store.put(challenge);
  return challenge;
}

function rfc3339(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace(".000Z", "Z");
}

/**
 * The statement both keys approve for a login, written as a CAIP-122 "Sign in
 * with X" message so wallets and users see a familiar layout. A wallet that
 * signs messages shows this text. A transaction proof and the Nostr event
 * commit to its SHA-256 digest.
 */
export function authStatement(
  challenge: AuthChallenge,
  record: BindingRecord,
): BchStatement & {
  digest: string;
} {
  const parsed = parseChallenge(challenge);
  const domain = new URL(parsed.audience).host;
  const text = [
    `${domain} wants you to sign in with your Bitcoin Cash account:`,
    bindingAddress(record),
    "",
    `Sign in with BND at level ${parsed.level}.`,
    "",
    `URI: ${parsed.audience}`,
    "Version: 1",
    `Nonce: ${parsed.nonce}`,
    `Issued At: ${rfc3339(parsed.issuedAt)}`,
    `Expiration Time: ${rfc3339(parsed.expiresAt)}`,
    `Chain ID: ${CHAIN_IDS[record.bch.network]}`,
    "Resources:",
    `- nostr:${npubEncode(record.nostr.publicKey)}`,
    `- bnd:binding/${bindingId(record)}`,
    `- bnd:level/${parsed.level}`,
  ].join("\n");
  const digest = sha256(new TextEncoder().encode(text));
  return {
    keyHash: record.bch.keyHash,
    text,
    digest: bytesToHex(digest),
    commitment: {
      keyHash: record.bch.keyHash,
      outpointDomain: AUTH_OUTPOINT_DOMAIN,
      tag: AUTH_TAG,
      digest,
      subject: "login",
      prompt: `Sign in to ${domain}. No funds move.`.slice(0, 200),
    },
  };
}

/** The NIP-98 event the Nostr key signs. `created_at` is the signing time. */
export function authEventTemplate(
  challenge: AuthChallenge,
  record: BindingRecord,
  createdAt: number,
): UnsignedEvent {
  const parsed = parseChallenge(challenge);
  return {
    kind: AUTH_EVENT_KIND,
    created_at: createdAt,
    tags: [
      ["u", parsed.audience],
      ["method", "POST"],
      ["challenge", parsed.nonce],
      ["binding", bindingId(record)],
      ["statement", authStatement(parsed, record).digest],
    ],
    content: "",
  };
}

export interface CreateLoginResponseOptions {
  challenge: AuthChallenge;
  /** The user's binding event. */
  binding: NostrEvent;
  nostrSigner: NostrSigner;
  /** Required for the `dual` level. */
  bchSigner?: BchSigner;
  /** Required for the `dual` level. The caller picks; there is no automatic switch. */
  proofType?: BchProofType;
  /**
   * The page the user is actually on. When given, the challenge's audience must
   * be on the same origin, which stops a site from forwarding another site's
   * challenge to the user.
   */
  expectedOrigin?: string;
  /** Clock in Unix seconds, for tests. Defaults to the current time. */
  now?: () => number;
}

/**
 * Answer a challenge. The BCH key signs first, because a wallet may take time,
 * and the Nostr key signs last so its event time is fresh. The result is
 * checked before it is returned.
 */
export async function createLoginResponse(
  options: CreateLoginResponseOptions,
): Promise<LoginResponse> {
  const challenge = parseChallenge(options.challenge);
  const clock = options.now ?? (() => Math.floor(Date.now() / 1000));
  const verified = verifyBinding(options.binding);
  if (!verified.ok) throw new Error(`binding is invalid: ${verified.reason}`);
  if ((await options.nostrSigner.getPublicKey()) !== verified.nostrPublicKey) {
    throw new Error("the Nostr signer is not the key in the binding");
  }
  if (clock() > challenge.expiresAt) throw new Error("challenge has expired");
  if (
    options.expectedOrigin !== undefined &&
    new URL(challenge.audience).origin !== new URL(options.expectedOrigin).origin
  ) {
    throw new Error("challenge is for a different site");
  }

  let bchProof: BchProof | undefined;
  if (challenge.level === "dual") {
    if (!options.bchSigner || options.proofType === undefined) {
      throw new TypeError("this challenge needs a BCH signer and a proof type");
    }
    bchProof = await proveStatement(
      options.bchSigner,
      authStatement(challenge, verified.record),
      options.proofType,
    );
  }

  const template = authEventTemplate(challenge, verified.record, clock());
  const event = await options.nostrSigner.signEvent(template);
  const response: LoginResponse = {
    binding: options.binding,
    event,
    ...(bchProof === undefined ? {} : { bchProof }),
  };
  const check = checkLoginResponse(challenge, response, template.created_at);
  if (!check.ok) throw new Error(`login response is invalid: ${check.reason}`);
  return response;
}

export interface AuthIdentity {
  nostrPublicKey: string;
  npub: string;
  bch: { network: BchNetwork; keyHash: string; address: string };
  bindingId: string;
}

export type LoginResult =
  | {
      ok: true;
      identity: AuthIdentity;
      level: AuthLevel;
      /** Which proof the BCH key gave. Absent at the `nostr` level. */
      bchProofType?: BchProofType;
      challenge: AuthChallenge;
      binding: VerifiedBinding;
    }
  | { ok: false; reason: string };

/**
 * Check a login response against its challenge. Pure: no store, no network.
 * Returns the verified binding when every rule holds.
 */
export function checkLoginResponse(
  challenge: AuthChallenge,
  response: LoginResponse,
  now: number,
): VerifyResult & { binding?: VerifiedBinding } {
  if (now > challenge.expiresAt) return fail("challenge has expired");

  const binding = verifyBinding(response.binding);
  if (!binding.ok) return fail(`binding is invalid: ${binding.reason}`);

  const event = response.event;
  if (!verifyEventSignature(event)) return fail("login event signature is invalid");
  if (event.kind !== AUTH_EVENT_KIND) return fail("login event has the wrong kind");
  if (event.pubkey !== binding.nostrPublicKey) {
    return fail("login event was not signed by the bound Nostr key");
  }
  if (Math.abs(now - event.created_at) > AUTH_EVENT_WINDOW_SECONDS) {
    return fail("login event time is too far from the current time");
  }
  if (event.created_at < challenge.issuedAt - AUTH_EVENT_WINDOW_SECONDS) {
    return fail("login event is older than the challenge");
  }
  const expected = authEventTemplate(challenge, binding.record, event.created_at);
  if (
    event.content !== expected.content ||
    JSON.stringify(event.tags) !== JSON.stringify(expected.tags)
  ) {
    return fail("login event does not match the challenge and binding");
  }

  const statement = authStatement(challenge, binding.record);
  if (challenge.level === "dual") {
    if (response.bchProof === undefined) return fail("this challenge needs a BCH proof");
    const proof = verifyStatementProof(statement, response.bchProof);
    if (!proof.ok) return fail(`BCH proof is invalid: ${proof.reason}`);
  } else if (response.bchProof !== undefined) {
    return fail("this challenge does not take a BCH proof");
  }
  return { ok: true, binding };
}

export interface VerifyLoginOptions {
  /** Unix seconds. Defaults to the current time. */
  now?: number;
  /**
   * Optional check that the binding is the user's current one, for example by
   * asking relays. It runs after every local check and before the challenge is
   * used up. A failure counts as a failed attempt.
   */
  isCurrent?: (binding: VerifiedBinding) => VerifyResult | Promise<VerifyResult>;
}

function parseLoginResponse(value: unknown): LoginResponse | string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return "login response must be an object";
  }
  const response = value as Record<string, unknown>;
  const keys = Object.keys(response).sort().join(",");
  if (keys !== "bchProof,binding,event" && keys !== "binding,event") {
    return "login response must have binding and event, and bchProof only when required";
  }
  if (!isEventShape(response.binding) || !isEventShape(response.event)) {
    return "login response binding and event must be Nostr events";
  }
  if (response.bchProof === undefined) {
    return { binding: response.binding, event: response.event };
  }
  try {
    return {
      binding: response.binding,
      event: response.event,
      bchProof: parseBchProof(response.bchProof),
    };
  } catch (error) {
    return `invalid proof: ${(error as Error).message}`;
  }
}

/**
 * Verify a login response. Looks up the challenge the Nostr event names, checks
 * everything with no network, runs the optional currency check, and only then
 * consumes the challenge, so a response works once. Never throws on bad input.
 */
export async function verifyLogin(
  store: ChallengeStore,
  value: unknown,
  options: VerifyLoginOptions = {},
): Promise<LoginResult> {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const response = parseLoginResponse(value);
  if (typeof response === "string") return { ok: false, reason: response };

  const nonceTags = response.event.tags.filter((tag) => tag[0] === "challenge");
  const nonce = nonceTags.length === 1 ? nonceTags[0]?.[1] : undefined;
  if (!isHex(nonce, 32)) return { ok: false, reason: "login event does not name a challenge" };

  const challenge = await store.get(nonce);
  if (challenge === undefined) return { ok: false, reason: "unknown or expired challenge" };

  const rejected = async (reason: string): Promise<LoginResult> => {
    await store.fail(nonce);
    return { ok: false, reason };
  };

  const checked = checkLoginResponse(challenge, response, now);
  if (!checked.ok || checked.binding === undefined) {
    return rejected(checked.ok ? "binding missing" : checked.reason);
  }
  if (options.isCurrent) {
    const current = await options.isCurrent(checked.binding);
    if (!current.ok) return rejected(`binding is not current: ${current.reason}`);
  }
  if (!(await store.consume(nonce))) return { ok: false, reason: "challenge already used" };

  const binding = checked.binding;
  return {
    ok: true,
    identity: {
      nostrPublicKey: binding.nostrPublicKey,
      npub: npubEncode(binding.nostrPublicKey),
      bch: binding.bch,
      bindingId: binding.bindingId,
    },
    level: challenge.level,
    ...(response.bchProof === undefined ? {} : { bchProofType: response.bchProof.type }),
    challenge,
    binding,
  };
}
