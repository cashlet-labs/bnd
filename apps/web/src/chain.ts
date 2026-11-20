import {
  bindingAddress,
  bindingId,
  npubEncode,
  parseBindingEvent,
  type ApprovalRole,
  type BindingRecord,
  type VerifiedBinding,
} from "@cashlet-labs/bnd";

/** One binding in an identity's chain, for display. */
export interface ChainStep {
  bindingId: string;
  createdAt: number;
  npub: string;
  address: string;
  recovery: string | null;
  /** What this step changed from the one before. */
  changes: string[];
  /** Keys of the step before that approved this one. Empty for the first. */
  approvedBy: ApprovalRole[];
  revoked: boolean;
}

const ORDER: ApprovalRole[] = ["nostr", "bch", "recovery"];

function sameBch(a: BindingRecord, b: BindingRecord): boolean {
  return a.bch.network === b.bch.network && a.bch.keyHash === b.bch.keyHash;
}

function changesBetween(before: BindingRecord, after: BindingRecord): string[] {
  if (after.revoked) return ["revoked the identity"];
  const changes: string[] = [];
  if (after.nostr.publicKey !== before.nostr.publicKey) changes.push("new Nostr key");
  if (!sameBch(before, after)) changes.push("new BCH key");
  const was = before.recovery?.publicKey;
  const now = after.recovery?.publicKey;
  if (was === undefined && now !== undefined) changes.push("added a recovery key");
  else if (was !== undefined && now === undefined) changes.push("removed the recovery key");
  else if (was !== now) changes.push("new recovery key");
  return changes.length === 0 ? ["no key changed"] : changes;
}

/**
 * Which keys of `before` approved `after`, for a step inside a history. The
 * chain was verified already, so this only describes it: the author and a
 * kept BCH key approve implicitly, the rest through explicit approvals.
 */
function stepApprovers(
  before: BindingRecord,
  after: BindingRecord,
  explicit: readonly string[],
): ApprovalRole[] {
  const roles = new Set<ApprovalRole>(explicit as ApprovalRole[]);
  if (after.nostr.publicKey === before.nostr.publicKey) roles.add("nostr");
  if (after.nostr.publicKey === before.recovery?.publicKey) roles.add("recovery");
  if (sameBch(before, after)) roles.add("bch");
  return ORDER.filter((role) => roles.has(role));
}

/** The chain of a verified binding, oldest first, ending with the binding itself. */
export function chainSteps(binding: VerifiedBinding): ChainStep[] {
  const parsed = parseBindingEvent(binding.event);
  if (!parsed.ok) throw new Error(parsed.reason);
  const records = [...binding.ancestors, binding.record];
  return records.map((record, index) => {
    const before = index === 0 ? null : records[index - 1]!;
    const isHead = index === records.length - 1;
    const explicit = isHead ? [] : Object.keys(parsed.history[index]?.approvals ?? {});
    return {
      bindingId: isHead ? binding.bindingId : bindingId(record),
      createdAt: record.createdAt,
      npub: npubEncode(record.nostr.publicKey),
      address: bindingAddress(record),
      recovery: record.recovery ? npubEncode(record.recovery.publicKey) : null,
      changes: before === null ? ["first binding"] : changesBetween(before, record),
      approvedBy:
        before === null
          ? []
          : isHead
            ? binding.approvedBy
            : stepApprovers(before, record, explicit),
      revoked: record.revoked === true,
    };
  });
}
