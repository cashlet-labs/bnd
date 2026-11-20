import { schnorr } from "@noble/curves/secp256k1.js";
import {
  parseBchProof,
  proveBchControl,
  proveStatement,
  verifyBchProof,
  verifyStatementProof,
  type BchProof,
  type BchProofType,
  type BchSigner,
} from "./bch-proof.js";
import type { BchNetwork } from "./bch.js";
import {
  bindingAddress,
  bindingId,
  buildBinding,
  parseBinding,
  type BindingRecord,
} from "./binding.js";
import { bytesToHex, isHex } from "./bytes.js";
import { canonicalize, type CanonicalValue } from "./canonical.js";
import {
  eventId,
  isEventShape,
  signEvent,
  verifyEventSignature,
  type NostrEvent,
  type UnsignedEvent,
} from "./event.js";
import { fail, OK, type VerifyResult } from "./result.js";
import {
  approvalEventTemplate,
  MAX_HISTORY,
  SUCCESSOR_TAG,
  successionStatement,
  verifyApprovalSignature,
  type ApprovalRole,
  type Approvals,
} from "./succession.js";

/** NIP-78 application-specific data: an addressable event kind. */
export const BINDING_EVENT_KIND = 30078;
/** Fixed `d` tag: a Nostr key has at most one live binding. */
export const BINDING_D_TAG = "bnd1";

/** What the event content carries: the record both keys approve and the BCH proof. */
export interface BindingEnvelope {
  record: BindingRecord;
  bchProof: BchProof;
}

/**
 * Anything that can sign a Nostr event for one key. The shape follows NIP-07,
 * so a browser extension's `window.nostr` object satisfies it directly.
 */
export interface NostrSigner {
  getPublicKey(): Promise<string> | string;
  signEvent(template: UnsignedEvent): Promise<NostrEvent> | NostrEvent;
}

/** A signer that holds a raw secret key. For tests, demos and local tooling. */
export function createNostrKeySigner(privateKey: Uint8Array): NostrSigner {
  const publicKey = bytesToHex(schnorr.getPublicKey(privateKey));
  return {
    getPublicKey: () => publicKey,
    signEvent: (template) => signEvent(privateKey, template),
  };
}

function bindingTags(record: BindingRecord): string[][] {
  return [
    ["d", BINDING_D_TAG],
    ["b", record.bch.keyHash],
    ...(record.previous === undefined ? [] : [[SUCCESSOR_TAG, record.previous]]),
  ];
}

/** How a binding relates to the one before it (section 9). */
export type BindingForm = "root" | "successor" | "revocation";

/**
 * One earlier binding in a successor's history, oldest first. Like a block
 * header in SPV, a step carries only what is needed to check it: its record,
 * which names the step before by binding ID, its BCH proof, the approvals of
 * the keys it replaced, and the BIP-340 signature of its event. The event
 * itself is rebuilt from these and the steps before it.
 */
export interface HistoryStep {
  record: BindingRecord;
  bchProof: BchProof;
  /** Absent on the first step, which replaces nothing. */
  approvals?: Approvals;
  /** Signature of the step's binding event by its Nostr key. */
  sig: string;
}

function contentObject(
  record: BindingRecord,
  bchProof: BchProof | null,
  history: readonly HistoryStep[] | null,
  approvals: Approvals | null,
): Record<string, CanonicalValue> {
  return {
    record,
    ...(bchProof === null ? {} : { bchProof }),
    ...(history === null ? {} : { history }),
    ...(approvals === null ? {} : { approvals }),
  } as unknown as Record<string, CanonicalValue>;
}

/** The binding event of history step `index`, without its signature fields. */
function stepTemplate(history: readonly HistoryStep[], index: number): UnsignedEvent {
  const step = history[index]!;
  return {
    kind: BINDING_EVENT_KIND,
    created_at: step.record.createdAt,
    tags: bindingTags(step.record),
    content: canonicalize(
      contentObject(
        step.record,
        step.bchProof,
        index === 0 ? null : history.slice(0, index),
        index === 0 ? null : (step.approvals ?? {}),
      ),
    ),
  };
}

/** Build the event a Nostr signer signs. `created_at` equals the record's time. */
export function buildBindingEventTemplate(
  record: BindingRecord,
  bchProof: BchProof | null,
  succession?: { history: readonly HistoryStep[]; approvals: Approvals },
): UnsignedEvent {
  const parsed = parseBinding(record);
  if ((parsed.previous === undefined) !== (succession === undefined)) {
    throw new TypeError("a binding with previous needs its history and approvals");
  }
  if ((bchProof === null) !== (parsed.revoked === true)) {
    throw new TypeError("a revocation has no BCH proof; every other binding has one");
  }
  return {
    kind: BINDING_EVENT_KIND,
    created_at: parsed.createdAt,
    tags: bindingTags(parsed),
    content: canonicalize(
      contentObject(
        parsed,
        bchProof === null ? null : parseBchProof(bchProof),
        succession?.history ?? null,
        succession?.approvals ?? null,
      ),
    ),
  };
}

export interface ParsedBinding {
  event: NostrEvent;
  record: BindingRecord;
  form: BindingForm;
  /** Absent on a revocation. */
  bchProof: BchProof | null;
  /** Earlier bindings, oldest first. Empty for a root. */
  history: HistoryStep[];
  approvals: Approvals;
}

export type ParsedBindingEvent = ({ ok: true } & ParsedBinding) | { ok: false; reason: string };

function parseFailure(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

const CONTENT_MEMBERS: Record<string, BindingForm> = {
  "bchProof,record": "root",
  "approvals,bchProof,history,record": "successor",
  "approvals,history,record": "revocation",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseApprovals(value: unknown, path: string): Approvals {
  if (!isObject(value)) throw new TypeError(`${path} must be an object`);
  const approvals: Approvals = {};
  for (const [key, member] of Object.entries(value)) {
    if (key === "nostr" || key === "recovery") {
      if (!isHex(member, 64))
        throw new TypeError(`${path}.${key} must be a 64-byte signature in hex`);
      approvals[key] = member;
    } else if (key === "bch") {
      approvals.bch = parseBchProof(member);
    } else {
      throw new TypeError(`${path}.${key} is not allowed`);
    }
  }
  return approvals;
}

function parseHistory(value: unknown): HistoryStep[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("history must be a list of at least one step");
  }
  if (value.length > MAX_HISTORY) throw new HistoryTooLong();
  return value.map((item, index): HistoryStep => {
    const path = `history[${index}]`;
    if (!isObject(item)) throw new TypeError(`${path} must be an object`);
    const keys = Object.keys(item).sort().join(",");
    const expected = index === 0 ? "bchProof,record,sig" : "approvals,bchProof,record,sig";
    if (keys !== expected) throw new TypeError(`${path} must have exactly ${expected}`);
    const record = parseBinding(item.record);
    if ((record.previous === undefined) !== (index === 0)) {
      throw new TypeError(
        index === 0 ? `${path} must be a first binding` : `${path} must name the step before`,
      );
    }
    if (record.revoked) throw new TypeError(`${path} is a revocation, which nothing can follow`);
    if (!isHex(item.sig, 64)) throw new TypeError(`${path}.sig must be a 64-byte signature in hex`);
    return {
      record,
      bchProof: parseBchProof(item.bchProof),
      ...(index === 0 ? {} : { approvals: parseApprovals(item.approvals, `${path}.approvals`) }),
      sig: item.sig,
    };
  });
}

class HistoryTooLong extends Error {}

function sameBchKey(a: BindingRecord, b: BindingRecord): boolean {
  return a.bch.network === b.bch.network && a.bch.keyHash === b.bch.keyHash;
}

function sameKeys(a: BindingRecord, b: BindingRecord): boolean {
  return a.nostr.publicKey === b.nostr.publicKey && sameBchKey(a, b);
}

/**
 * Check that an event has exactly the shape a binding event must have, and
 * parse the history it carries. This does not check any signature. Every field
 * that must agree is compared, and tags and content must equal the canonical
 * form byte for byte.
 */
export function parseBindingEvent(value: unknown): ParsedBindingEvent {
  if (!isEventShape(value)) return parseFailure("not a Nostr event");
  const event: NostrEvent = {
    id: value.id,
    pubkey: value.pubkey,
    created_at: value.created_at,
    kind: value.kind,
    tags: value.tags,
    content: value.content,
    sig: value.sig,
  };
  if (event.kind !== BINDING_EVENT_KIND) return parseFailure("not a binding event kind");

  let content: unknown;
  try {
    content = JSON.parse(event.content);
  } catch {
    return parseFailure("event content is not JSON");
  }
  if (!isObject(content)) return parseFailure("event content must be an object");
  const form = CONTENT_MEMBERS[Object.keys(content).sort().join(",")];
  if (form === undefined)
    return parseFailure("event content must have exactly bchProof and record");

  let record: BindingRecord;
  let bchProof: BchProof | null = null;
  let approvals: Approvals = {};
  let history: HistoryStep[] = [];
  try {
    record = parseBinding(content.record);
    if (form !== "revocation") bchProof = parseBchProof(content.bchProof);
    if (form !== "root") {
      approvals = parseApprovals(content.approvals, "approvals");
      history = parseHistory(content.history);
    }
  } catch (error) {
    if (error instanceof HistoryTooLong) {
      return parseFailure(`history is longer than ${MAX_HISTORY} bindings`);
    }
    return parseFailure(`invalid binding content: ${(error as Error).message}`);
  }
  const recordForm: BindingForm = record.revoked
    ? "revocation"
    : record.previous === undefined
      ? "root"
      : "successor";
  if (recordForm !== form) {
    return parseFailure(
      recordForm === "root"
        ? "a binding without previous cannot carry history"
        : recordForm === "successor"
          ? "a successor must carry exactly approvals, bchProof, history and record"
          : "a revocation must carry exactly approvals, history and record",
    );
  }

  let canonical: string;
  try {
    canonical = canonicalize(
      contentObject(
        record,
        bchProof,
        form === "root" ? null : history,
        form === "root" ? null : approvals,
      ),
    );
  } catch (error) {
    return parseFailure(`event content is not canonical: ${(error as Error).message}`);
  }
  if (event.content !== canonical) return parseFailure("event content is not canonical JSON");

  if (event.created_at !== record.createdAt) {
    return parseFailure("event time does not match the record time");
  }
  if (JSON.stringify(event.tags) !== JSON.stringify(bindingTags(record))) {
    return parseFailure(
      form === "root"
        ? "event tags are not the required d and b tags"
        : "event tags are not the required d, b and s tags",
    );
  }

  // The history is a hash-linked chain ending at this record.
  const chain = [...history.map((step) => step.record), record];
  for (let i = 1; i < chain.length; i++) {
    const before = chain[i - 1]!;
    const after = chain[i]!;
    const where = i === chain.length - 1 ? "" : `history step ${i + 1}: `;
    if (after.previous !== bindingId(before)) {
      return parseFailure(`${where}record.previous does not match the binding before it`);
    }
    if (after.createdAt <= before.createdAt) {
      return parseFailure(`${where}a binding must be newer than the one it replaces`);
    }
  }

  if (form === "revocation") {
    const before = history[history.length - 1]!.record;
    if (!sameKeys(record, before)) {
      return parseFailure("a revocation must name the keys of the binding it revokes");
    }
    if (event.pubkey !== before.nostr.publicKey && event.pubkey !== before.recovery?.publicKey) {
      return parseFailure("a revocation must be signed by the previous Nostr or recovery key");
    }
  } else if (event.pubkey !== record.nostr.publicKey) {
    return parseFailure("event author is not the bound Nostr key");
  }
  return { ok: true, event, record, form, bchProof, history, approvals };
}

/**
 * Which keys of `before` approved `after` (section 9). The key that signs the
 * new event, and a BCH key that is kept and proves the new record, approve
 * implicitly. Any explicit approval must be valid.
 */
function approvalRoles(
  before: BindingRecord,
  after: BindingRecord,
  author: string,
  approvals: Approvals,
): { ok: true; roles: ApprovalRole[] } | { ok: false; reason: string } {
  const roles = new Set<ApprovalRole>();
  if (author === before.nostr.publicKey) roles.add("nostr");
  if (before.recovery !== undefined && author === before.recovery.publicKey) roles.add("recovery");
  // The new BCH proof is checked separately; a kept BCH key approves through it.
  if (!after.revoked && sameBchKey(before, after)) roles.add("bch");

  if (approvals.nostr !== undefined) {
    const result = verifyApprovalSignature(approvals.nostr, before.nostr.publicKey, after);
    if (!result.ok) return { ok: false, reason: `Nostr key approval is invalid: ${result.reason}` };
    roles.add("nostr");
  }
  if (approvals.recovery !== undefined) {
    if (before.recovery === undefined) {
      return { ok: false, reason: "the previous binding has no recovery key" };
    }
    const result = verifyApprovalSignature(approvals.recovery, before.recovery.publicKey, after);
    if (!result.ok) {
      return { ok: false, reason: `recovery key approval is invalid: ${result.reason}` };
    }
    roles.add("recovery");
  }
  if (approvals.bch !== undefined) {
    const result = verifyStatementProof(successionStatement(before, after), approvals.bch);
    if (!result.ok) return { ok: false, reason: `BCH key approval is invalid: ${result.reason}` };
    roles.add("bch");
  }
  const list = (["nostr", "bch", "recovery"] as const).filter((role) => roles.has(role));
  if (list.length < 2) {
    return {
      ok: false,
      reason: `needs approval from two keys of the previous binding, got ${list.length === 0 ? "none" : `only the ${list[0]} key`}`,
    };
  }
  return { ok: true, roles: list };
}

export interface VerifiedBinding {
  ok: true;
  /** The Nostr identity, as 32-byte lowercase hex. */
  nostrPublicKey: string;
  bch: { network: BchNetwork; keyHash: string; address: string };
  bindingId: string;
  record: BindingRecord;
  form: BindingForm;
  /** Which proof the BCH key gave. Null on a revocation, which has none. */
  proofType: BchProofType | null;
  /** IDs of every binding this one replaces, oldest first. Empty for a root. */
  history: string[];
  /** Records of those bindings, in the same order. */
  ancestors: BindingRecord[];
  /** Keys of the previous binding that approved this one. Empty for a root. */
  approvedBy: ApprovalRole[];
  event: NostrEvent;
}

export type VerifyBindingResult = VerifiedBinding | { ok: false; reason: string };

export interface VerifyBindingOptions {
  /**
   * IDs of bindings this verifier has fully verified before, such as pinned
   * ones. Like an SPV client that trusts headers it has checked, history up to
   * the newest of them is not checked again; later steps always are.
   */
  checkpoints?: ReadonlySet<string>;
}

function verifyStep(history: readonly HistoryStep[], index: number): VerifyResult {
  const step = history[index]!;
  const author = step.record.nostr.publicKey;
  const event = { ...stepTemplate(history, index), pubkey: author, id: "", sig: step.sig };
  event.id = eventId(event);
  if (!verifyEventSignature(event)) return fail("Nostr signature is invalid");
  const proof = verifyBchProof(step.record, step.bchProof);
  if (!proof.ok) return fail(`BCH proof is invalid: ${proof.reason}`);
  if (index > 0) {
    const roles = approvalRoles(
      history[index - 1]!.record,
      step.record,
      author,
      step.approvals ?? {},
    );
    if (!roles.ok) return fail(roles.reason);
  }
  return OK;
}

function verifyParsed(parsed: ParsedBinding, options: VerifyBindingOptions): VerifyBindingResult {
  if (!verifyEventSignature(parsed.event)) {
    return { ok: false, reason: "Nostr signature is invalid" };
  }
  if (parsed.bchProof !== null) {
    const proof = verifyBchProof(parsed.record, parsed.bchProof);
    if (!proof.ok) return { ok: false, reason: `BCH proof is invalid: ${proof.reason}` };
  }
  const history = parsed.history.map((step) => bindingId(step.record));
  let approvedBy: ApprovalRole[] = [];
  if (parsed.history.length > 0) {
    let checked = -1;
    if (options.checkpoints !== undefined) {
      for (let i = history.length - 1; i >= 0; i--) {
        if (options.checkpoints.has(history[i]!)) {
          checked = i;
          break;
        }
      }
    }
    for (let i = checked + 1; i < parsed.history.length; i++) {
      const result = verifyStep(parsed.history, i);
      if (!result.ok) return { ok: false, reason: `history step ${i + 1}: ${result.reason}` };
    }
    const roles = approvalRoles(
      parsed.history[parsed.history.length - 1]!.record,
      parsed.record,
      parsed.event.pubkey,
      parsed.approvals,
    );
    if (!roles.ok) return roles;
    approvedBy = roles.roles;
  }
  return {
    ok: true,
    nostrPublicKey: parsed.record.nostr.publicKey,
    bch: {
      network: parsed.record.bch.network,
      keyHash: parsed.record.bch.keyHash,
      address: bindingAddress(parsed.record),
    },
    bindingId: bindingId(parsed.record),
    record: parsed.record,
    form: parsed.form,
    proofType: parsed.bchProof?.type ?? null,
    history,
    ancestors: parsed.history.map((step) => step.record),
    approvedBy,
    event: parsed.event,
  };
}

/**
 * Verify a binding event end to end, without contacting anyone: the event has
 * the exact required shape, the Nostr key signed it, the BCH key approved the
 * same record, and every step of its history is signed and was approved by
 * two keys of the binding before it.
 */
export function verifyBinding(
  value: unknown,
  options: VerifyBindingOptions = {},
): VerifyBindingResult {
  const parsed = parseBindingEvent(value);
  if (!parsed.ok) return parsed;
  return verifyParsed(parsed, options);
}

/**
 * The history a successor of `previous` carries: `previous`'s own history,
 * then `previous` itself as the newest step.
 */
export function historyAfter(previous: NostrEvent): HistoryStep[] {
  const parsed = parseBindingEvent(previous);
  if (!parsed.ok) throw new Error(`previous binding is invalid: ${parsed.reason}`);
  if (parsed.form === "revocation") throw new Error("a revoked identity cannot be continued");
  const step: HistoryStep = {
    record: parsed.record,
    bchProof: parsed.bchProof!,
    ...(parsed.form === "root" ? {} : { approvals: parsed.approvals }),
    sig: parsed.event.sig,
  };
  return [...parsed.history, step];
}

export interface CreateBindingOptions {
  nostrSigner: NostrSigner;
  bchSigner: BchSigner;
  /** HASH160 of the BCH key that `bchSigner` signs with. */
  bchKeyHash: Uint8Array | string;
  network: BchNetwork;
  /** The caller picks the proof; there is no automatic switch between types. */
  proofType: BchProofType;
  /** Unix seconds. Defaults to the current time. */
  createdAt?: number;
  /** x-only public key of an offline recovery key (section 9). */
  recoveryPublicKey?: string;
}

async function signAndVerify(
  signer: NostrSigner,
  template: UnsignedEvent,
): Promise<VerifiedBinding> {
  const event = await signer.signEvent(template);
  const verified = verifyBinding(event);
  if (!verified.ok) throw new Error(`created binding is invalid: ${verified.reason}`);
  return verified;
}

/**
 * Create a Nostr key's first binding: build the record, collect the BCH proof
 * from the BCH signer, have the Nostr signer sign the event, and verify the
 * result before returning it. A signer that changes the event is caught here.
 * Later bindings for the same key must be successors (createSuccessor).
 */
export async function createBinding(options: CreateBindingOptions): Promise<VerifiedBinding> {
  const nostrPublicKey = await options.nostrSigner.getPublicKey();
  const record = buildBinding({
    nostrPublicKey,
    bchKeyHash: options.bchKeyHash,
    network: options.network,
    ...(options.createdAt === undefined ? {} : { createdAt: options.createdAt }),
    ...(options.recoveryPublicKey === undefined
      ? {}
      : { recoveryPublicKey: options.recoveryPublicKey }),
  });
  const bchProof = await proveBchControl(options.bchSigner, record, options.proofType);
  return signAndVerify(options.nostrSigner, buildBindingEventTemplate(record, bchProof));
}

/**
 * Keys of the previous binding that approve explicitly. A key that signs the
 * new event, and a BCH key that is kept, approve implicitly; list only the
 * others. Two keys of the previous binding must approve in total.
 */
export interface Approvers {
  /** The previous Nostr key. */
  nostr?: NostrSigner;
  /** The previous BCH key. */
  bch?: { signer: BchSigner; proofType: BchProofType };
  /** The previous recovery key. */
  recovery?: NostrSigner;
}

async function approvalSignature(
  signer: NostrSigner,
  publicKey: string,
  after: BindingRecord,
  name: string,
): Promise<string> {
  if ((await signer.getPublicKey()) !== publicKey) {
    throw new Error(`the ${name} approver is not the previous binding's ${name} key`);
  }
  const signed = await signer.signEvent(approvalEventTemplate(after));
  const check = verifyApprovalSignature(signed.sig, publicKey, after);
  if (!check.ok) throw new Error(`the ${name} approver signed something else: ${check.reason}`);
  return signed.sig;
}

async function collectApprovals(
  before: BindingRecord,
  after: BindingRecord,
  approvers: Approvers,
): Promise<Approvals> {
  const approvals: Approvals = {};
  if (approvers.nostr !== undefined) {
    approvals.nostr = await approvalSignature(
      approvers.nostr,
      before.nostr.publicKey,
      after,
      "Nostr",
    );
  }
  if (approvers.recovery !== undefined) {
    if (before.recovery === undefined) throw new Error("the previous binding has no recovery key");
    approvals.recovery = await approvalSignature(
      approvers.recovery,
      before.recovery.publicKey,
      after,
      "recovery",
    );
  }
  if (approvers.bch !== undefined) {
    approvals.bch = await proveStatement(
      approvers.bch.signer,
      successionStatement(before, after),
      approvers.bch.proofType,
    );
  }
  return approvals;
}

function verifiedPrevious(previous: NostrEvent): {
  binding: VerifiedBinding;
  history: HistoryStep[];
} {
  const verified = verifyBinding(previous);
  if (!verified.ok) throw new Error(`previous binding is invalid: ${verified.reason}`);
  if (verified.form === "revocation") throw new Error("a revoked identity cannot be continued");
  if (verified.history.length >= MAX_HISTORY) {
    throw new Error(`history would be longer than ${MAX_HISTORY} bindings; start with a new key`);
  }
  return { binding: verified, history: historyAfter(verified.event) };
}

function nextTime(previous: VerifiedBinding, createdAt: number | undefined): number {
  return createdAt ?? Math.max(Math.floor(Date.now() / 1000), previous.record.createdAt + 1);
}

export interface CreateSuccessorOptions extends Omit<CreateBindingOptions, "createdAt"> {
  /** The binding being replaced: the identity's current binding event. */
  previous: NostrEvent;
  /** Previous keys that approve explicitly; see Approvers. */
  approvers: Approvers;
  /** Unix seconds, later than the previous binding. Defaults to now. */
  createdAt?: number;
}

/**
 * Replace a binding: rotate the Nostr key, the BCH key, or both, or change the
 * recovery key. `nostrSigner` and `bchSigner` are the keys of the new binding.
 * The history of signed steps is carried inside, so the whole chain can be
 * verified (section 9).
 */
export async function createSuccessor(options: CreateSuccessorOptions): Promise<VerifiedBinding> {
  const { binding: previous, history } = verifiedPrevious(options.previous);
  const record = buildBinding({
    nostrPublicKey: await options.nostrSigner.getPublicKey(),
    bchKeyHash: options.bchKeyHash,
    network: options.network,
    createdAt: nextTime(previous, options.createdAt),
    previous: previous.bindingId,
    ...(options.recoveryPublicKey === undefined
      ? {}
      : { recoveryPublicKey: options.recoveryPublicKey }),
  });
  const approvals = await collectApprovals(previous.record, record, options.approvers);
  const bchProof = await proveBchControl(options.bchSigner, record, options.proofType);
  return signAndVerify(
    options.nostrSigner,
    buildBindingEventTemplate(record, bchProof, { history, approvals }),
  );
}

export interface CreateRevocationOptions {
  /** The binding being revoked: the identity's current binding event. */
  previous: NostrEvent;
  /** Signs the revocation event: the previous Nostr key or recovery key. */
  signer: NostrSigner;
  /** Previous keys that approve explicitly, besides the signer; see Approvers. */
  approvers: Approvers;
  /** Unix seconds, later than the previous binding. Defaults to now. */
  createdAt?: number;
}

/** End an identity: after a revocation it has no current binding (section 9). */
export async function createRevocation(options: CreateRevocationOptions): Promise<VerifiedBinding> {
  const { binding: previous, history } = verifiedPrevious(options.previous);
  const record = buildBinding({
    nostrPublicKey: previous.record.nostr.publicKey,
    bchKeyHash: previous.record.bch.keyHash,
    network: previous.record.bch.network,
    createdAt: nextTime(previous, options.createdAt),
    previous: previous.bindingId,
    revoked: true,
  });
  const approvals = await collectApprovals(previous.record, record, options.approvers);
  return signAndVerify(
    options.signer,
    buildBindingEventTemplate(record, null, { history, approvals }),
  );
}

/**
 * What the bindings found for one key say about the identity:
 *
 * - `none`: no valid binding names the key.
 * - `current`: one chain, ending in `binding`. Its keys may differ from the
 *   key asked about, when that key was rotated away.
 * - `revoked`: one chain, ending in a revocation.
 * - `disputed`: bindings that are not on one chain. A key was stolen, or the
 *   owner bound it twice; the identity is not used until a successor
 *   approved by two keys settles it (section 9).
 */
export type IdentityState =
  | { status: "none" }
  | { status: "current"; binding: VerifiedBinding }
  | { status: "revoked"; binding: VerifiedBinding }
  | { status: "disputed"; bindings: VerifiedBinding[] };

/** Which key to resolve: a Nostr key, a BCH key, or both. */
export interface IdentityKey {
  nostrPublicKey?: string;
  bchKeyHash?: string;
}

function names(record: BindingRecord, key: IdentityKey): boolean {
  return (
    (key.nostrPublicKey !== undefined && record.nostr.publicKey === key.nostrPublicKey) ||
    (key.bchKeyHash !== undefined && record.bch.keyHash === key.bchKeyHash)
  );
}

/**
 * Resolve an identity from events fetched from relays (section 9). Every event
 * is verified; invalid ones are ignored. A binding counts when it, or any
 * binding in its history, names the key. Bindings that appear in another's
 * history are old, so a relay serving a stale binding changes nothing. If more
 * than one chain remains, the identity is disputed.
 */
export function resolveIdentity(events: readonly unknown[], key: IdentityKey): IdentityState {
  if (key.nostrPublicKey === undefined && key.bchKeyHash === undefined) {
    throw new TypeError("name a Nostr key or a BCH key hash");
  }
  const found = new Map<string, VerifiedBinding>();
  for (const candidate of events) {
    const result = verifyBinding(candidate);
    if (!result.ok) continue;
    if (!names(result.record, key) && !result.ancestors.some((record) => names(record, key))) {
      continue;
    }
    if (!found.has(result.bindingId)) found.set(result.bindingId, result);
  }
  const replaced = new Set<string>();
  for (const binding of found.values()) for (const id of binding.history) replaced.add(id);
  const heads = [...found.values()].filter((binding) => !replaced.has(binding.bindingId));
  if (heads.length === 0) return { status: "none" };
  // Anchored chains will take priority here (section 9.6, Phase 11).
  if (heads.length > 1) {
    heads.sort(
      (a, b) => a.record.createdAt - b.record.createdAt || (a.bindingId < b.bindingId ? -1 : 1),
    );
    return { status: "disputed", bindings: heads };
  }
  const head = heads[0]!;
  return head.form === "revocation"
    ? { status: "revoked", binding: head }
    : { status: "current", binding: head };
}
