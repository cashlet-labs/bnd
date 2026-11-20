import { useState } from "react";
import type { BchNetwork } from "@cashlet-labs/bnd";
import { createRecoveryKey, type CreatedRecoveryKey } from "../signers/recovery";
import { chosenRecoveryKey, type RecoveryChoice } from "../state/recovery-choice";

export interface RecoveryKeyPickerProps {
  network: BchNetwork;
  choice: RecoveryChoice;
  onChange: (choice: RecoveryChoice) => void;
  disabled?: boolean;
  /** Injected in tests. */
  create?: () => CreatedRecoveryKey;
}

/**
 * Lets the user add an optional recovery key to the binding: one this page
 * creates and shows once, or one they keep elsewhere, given by its npub.
 */
export function RecoveryKeyPicker({
  network,
  choice,
  onChange,
  disabled = false,
  create = createRecoveryKey,
}: RecoveryKeyPickerProps) {
  const [copied, setCopied] = useState(false);
  const status = chosenRecoveryKey(choice);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <fieldset disabled={disabled}>
      <legend>Recovery key (optional)</legend>
      <p className="note">
        A third key, kept offline. If you lose your Nostr key or your BCH key, the recovery key and
        your other key can replace it. On its own it can do nothing.
      </p>
      <label>
        <input
          type="radio"
          name="recovery"
          checked={choice.mode === "none"}
          onChange={() => onChange({ mode: "none" })}
        />{" "}
        No recovery key
      </label>
      <label>
        <input
          type="radio"
          name="recovery"
          checked={choice.mode === "create"}
          onChange={() => onChange({ mode: "create", key: null, saved: false })}
        />{" "}
        Create one in this page
      </label>
      <label>
        <input
          type="radio"
          name="recovery"
          checked={choice.mode === "own"}
          onChange={() => onChange({ mode: "own", input: "" })}
        />{" "}
        Use my own (enter its npub)
      </label>

      {choice.mode === "create" && network === "mainnet" && (
        <p className="warning">
          On mainnet, prefer a recovery key made on a separate device and enter its npub.
        </p>
      )}

      {choice.mode === "create" && choice.key === null && (
        <button
          type="button"
          onClick={() => onChange({ mode: "create", key: create(), saved: false })}
        >
          Create a recovery key
        </button>
      )}

      {choice.mode === "create" && choice.key !== null && (
        <div className="warning" role="group" aria-label="Your recovery key">
          <p>
            This is a secret. Anyone who has it and one of your other keys can take over this
            identity. Save it offline now; this page will not show it again.
          </p>
          <code className="wrap" aria-label="Recovery key secret">
            {choice.key.nsec}
          </code>
          <div className="actions">
            <button type="button" onClick={() => void copy(choice.key!.nsec)}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <label>
            <input
              type="checkbox"
              checked={choice.saved}
              onChange={(event) => onChange({ ...choice, saved: event.target.checked })}
            />{" "}
            I have saved the recovery key
          </label>
        </div>
      )}

      {choice.mode === "own" && (
        <label>
          Recovery key npub
          <input
            type="text"
            value={choice.input}
            placeholder="npub1…"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => onChange({ mode: "own", input: event.target.value })}
          />
        </label>
      )}

      {!status.ok && choice.mode !== "none" && <p className="note">{status.reason}</p>}
    </fieldset>
  );
}
