/** Outcome of a verification step. A failure carries a reason fit for logs. */
export type VerifyResult = { ok: true } | { ok: false; reason: string };

export const OK: VerifyResult = { ok: true };

export function fail(reason: string): VerifyResult {
  return { ok: false, reason };
}
