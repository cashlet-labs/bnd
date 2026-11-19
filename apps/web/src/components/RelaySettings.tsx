import { LOCAL_RELAY, PUBLIC_RELAYS, type RelayChoice } from "../relays";

export interface RelaySettingsProps {
  choice: RelayChoice;
  onChange: (choice: RelayChoice) => void;
}

/** Which relays the demo publishes to and reads from. Public relays are opt-in. */
export function RelaySettings({ choice, onChange }: RelaySettingsProps) {
  return (
    <fieldset className="relays">
      <legend>Relays</legend>
      <label>
        <input
          type="checkbox"
          checked={choice.local}
          onChange={(event) => onChange({ ...choice, local: event.target.checked })}
        />{" "}
        Local demo relay <code>{LOCAL_RELAY}</code>
      </label>
      <label>
        <input
          type="checkbox"
          checked={choice.public}
          onChange={(event) => onChange({ ...choice, public: event.target.checked })}
        />{" "}
        Public relays ({PUBLIC_RELAYS.length})
      </label>
      {choice.public && (
        <p className="note">
          Anything published to public relays is visible to everyone and cannot be reliably deleted:{" "}
          {PUBLIC_RELAYS.join(", ")}.
        </p>
      )}
      {!choice.local && !choice.public && (
        <p className="error" role="alert">
          Choose at least one relay.
        </p>
      )}
    </fieldset>
  );
}
