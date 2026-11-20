import {
  recoveryKeyFromNpub,
  type CreatedRecoveryKey,
  type RecoveryKey,
} from "../signers/recovery";

/** What the user picked for the binding's recovery key, in the bind step. */
export type RecoveryChoice =
  | { mode: "none" }
  | { mode: "create"; key: CreatedRecoveryKey | null; saved: boolean }
  | { mode: "own"; input: string };

export const NO_RECOVERY: RecoveryChoice = { mode: "none" };

/** The recovery key a choice gives, or a reason it is not ready yet. */
export function chosenRecoveryKey(
  choice: RecoveryChoice,
): { ok: true; key: RecoveryKey | null } | { ok: false; reason: string } {
  if (choice.mode === "none") return { ok: true, key: null };
  if (choice.mode === "create") {
    if (choice.key === null) return { ok: false, reason: "Create the recovery key first." };
    if (!choice.saved) return { ok: false, reason: "Confirm that you saved the recovery key." };
    return { ok: true, key: choice.key };
  }
  try {
    return { ok: true, key: recoveryKeyFromNpub(choice.input) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
