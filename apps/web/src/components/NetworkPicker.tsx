import { useId, useState } from "react";
import type { BchNetwork } from "@cashlet-labs/bnd-core";

export interface NetworkPickerProps {
  network: BchNetwork;
  onChange: (network: BchNetwork) => void;
  /** Disable switching, for example once a binding has been made. */
  disabled?: boolean;
}

/**
 * Chooses the BCH network. Chipnet is a test network and is the default.
 * Switching to mainnet asks for explicit confirmation first.
 */
export function NetworkPicker({ network, onChange, disabled = false }: NetworkPickerProps) {
  const [confirming, setConfirming] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const groupName = useId();
  const checkboxId = useId();

  function choose(next: BchNetwork) {
    if (next === network) return;
    if (next === "mainnet") {
      setUnderstood(false);
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onChange(next);
  }

  return (
    <fieldset className="network" disabled={disabled}>
      <legend>Network</legend>
      <label>
        <input
          type="radio"
          name={groupName}
          value="chipnet"
          checked={network === "chipnet"}
          onChange={() => choose("chipnet")}
        />{" "}
        Chipnet (test network)
      </label>
      <label>
        <input
          type="radio"
          name={groupName}
          value="mainnet"
          checked={network === "mainnet"}
          onChange={() => choose("mainnet")}
        />{" "}
        Mainnet
      </label>

      {confirming && (
        <div className="warning" role="alertdialog" aria-labelledby={`${checkboxId}-title`}>
          <p id={`${checkboxId}-title`}>
            <strong>Mainnet uses real funds and a real public identity.</strong>
          </p>
          <ul>
            <li>A binding you publish is public and permanent on relays you do not control.</li>
            <li>It links your Nostr identity to a real Bitcoin Cash address for anyone to see.</li>
            <li>This is a demonstration. Use a wallet and keys you are willing to expose.</li>
          </ul>
          <label htmlFor={checkboxId}>
            <input
              id={checkboxId}
              type="checkbox"
              checked={understood}
              onChange={(event) => setUnderstood(event.target.checked)}
            />{" "}
            I understand that real funds and identities are at stake
          </label>
          <div className="actions">
            <button
              type="button"
              disabled={!understood}
              onClick={() => {
                setConfirming(false);
                onChange("mainnet");
              }}
            >
              Use mainnet
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              Stay on chipnet
            </button>
          </div>
        </div>
      )}
    </fieldset>
  );
}
