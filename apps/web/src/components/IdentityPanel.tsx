import { useState } from "react";
import type { VerifiedBinding } from "@cashlet-labs/bnd-core";
import {
  publishBinding as defaultPublishBinding,
  type PublishSummary,
} from "@cashlet-labs/bnd-nostr";
import type { ConnectedBchSigner } from "../signers/bch";
import {
  connectNip07,
  createMemorySigner,
  findNip07Provider,
  type ConnectedNostrSigner,
} from "../signers/nostr";
import { recoveryKeyFromNsec, type RecoveryKey } from "../signers/recovery";
import {
  ACTION_APPROVERS,
  changeIdentity as defaultChangeIdentity,
  type IdentityAction,
  type IdentityResult,
} from "../state/identity-actions";
import { BchWalletPanel } from "./BchWalletPanel";

export interface IdentityPanelProps {
  nostr: ConnectedNostrSigner | null;
  bch: ConnectedBchSigner | null;
  binding: VerifiedBinding | null;
  recovery: RecoveryKey | null;
  relays: string[];
  /** Called with the new keys and binding once the change is published. */
  onChange: (result: IdentityResult) => void;
  /** Relays for the WizardConnect handshake; tests point it at a local relay. */
  wizardRelays?: string[];
  /** Injected in tests. */
  changeIdentity?: typeof defaultChangeIdentity;
  publishBinding?: typeof defaultPublishBinding;
}

const ACTIONS: { value: IdentityAction; label: string; needsRecovery: boolean }[] = [
  { value: "rotate-bch", label: "Rotate the BCH key", needsRecovery: false },
  { value: "rotate-nostr", label: "Rotate the Nostr key", needsRecovery: false },
  { value: "recover-nostr", label: "Recover from a lost Nostr key", needsRecovery: true },
  { value: "recover-bch", label: "Recover from a lost BCH key", needsRecovery: true },
  { value: "revoke", label: "Revoke the identity", needsRecovery: false },
];

const BUTTON: Record<IdentityAction, string> = {
  "rotate-bch": "Rotate the BCH key",
  "rotate-nostr": "Rotate the Nostr key",
  "recover-nostr": "Recover with the recovery key",
  "recover-bch": "Recover with the recovery key",
  revoke: "Revoke",
};

const ROLE_NAMES = { nostr: "Nostr key", bch: "BCH key", recovery: "recovery key" } as const;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Replaces the binding with a successor, or revokes it (BND-1 section 9).
 * Each change needs two of the binding's keys; the page says which before
 * asking, and shows which approved after.
 */
export function IdentityPanel({
  nostr,
  bch,
  binding,
  recovery,
  relays,
  onChange,
  wizardRelays,
  changeIdentity = defaultChangeIdentity,
  publishBinding = defaultPublishBinding,
}: IdentityPanelProps) {
  const [action, setAction] = useState<IdentityAction>("rotate-bch");
  const [newNostr, setNewNostr] = useState<ConnectedNostrSigner | null>(null);
  const [newBch, setNewBch] = useState<ConnectedBchSigner | null>(null);
  const [revokeWith, setRevokeWith] = useState<"bch" | "recovery">("bch");
  const [nsec, setNsec] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ result: IdentityResult; published: PublishSummary } | null>(
    null,
  );

  const hasRecovery = binding?.record.recovery !== undefined;
  const changesNostr = action === "rotate-nostr" || action === "recover-nostr";
  const changesBch = action === "rotate-bch" || action === "recover-bch";
  const usesRecovery =
    action === "recover-nostr" ||
    action === "recover-bch" ||
    (action === "revoke" && revokeWith === "recovery");
  const nip07 = findNip07Provider();

  function choose(next: IdentityAction) {
    setAction(next);
    setError(null);
    setDone(null);
  }

  async function newNip07() {
    setError(null);
    try {
      if (!nip07) return;
      const signer = await connectNip07(nip07);
      if (signer.publicKey === nostr?.publicKey) {
        throw new Error("the extension holds the current Nostr key; choose another key");
      }
      setNewNostr(signer);
    } catch (cause) {
      setError(message(cause));
    }
  }

  async function run() {
    if (!binding || !nostr) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      let recoveryKey = recovery;
      if (usesRecovery && !recoveryKey?.signer) {
        // The one place the page accepts a secret key: held in memory, used once.
        recoveryKey = recoveryKeyFromNsec(nsec);
      }
      const result = await changeIdentity(action, {
        binding,
        nostr,
        bch,
        recovery: recoveryKey,
        ...(newNostr ? { newNostr } : {}),
        ...(newBch ? { newBch } : {}),
        revokeWith,
      });
      const published = await publishBinding(result.binding.event, { relays });
      if (!published.ok) {
        throw new Error(
          `no relay accepted the new binding: ${published.failed.map((f) => f.message).join("; ")}`,
        );
      }
      setDone({ result, published });
      setNewNostr(null);
      setNewBch(null);
      setNsec("");
      // The replaced keys are no longer part of the identity.
      if (result.nostr !== nostr) await nostr.disconnect();
      if (bch && result.bch !== bch) await bch.disconnect();
      onChange(result);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  const revoked = binding?.form === "revocation";
  const ready =
    binding !== null &&
    nostr !== null &&
    !revoked &&
    (!changesNostr || newNostr !== null) &&
    (!changesBch || newBch !== null) &&
    (!usesRecovery || recovery?.signer !== undefined || nsec.trim() !== "");

  return (
    <section aria-labelledby="identity-title">
      <h2 id="identity-title">
        <span className="step">5</span> Change the identity
      </h2>
      <p>
        Replace a key, recover from a lost one, or end the identity. Each change needs two of the
        binding&apos;s keys, so no single stolen key can do it.
      </p>

      {(!binding || !nostr) && <p className="note">Create and publish a binding first.</p>}
      {revoked && (
        <p className="warning">This identity is revoked. Nothing can follow a revocation.</p>
      )}

      {binding && nostr && !revoked && (
        <>
          <fieldset disabled={busy}>
            <legend>Change</legend>
            {ACTIONS.map((option) => (
              <label key={option.value}>
                <input
                  type="radio"
                  name="identity-action"
                  checked={action === option.value}
                  disabled={option.needsRecovery && !hasRecovery}
                  onChange={() => choose(option.value)}
                />{" "}
                {option.label}
                {option.needsRecovery && !hasRecovery && " (needs a recovery key in the binding)"}
              </label>
            ))}
          </fieldset>

          <p className="note">{ACTION_APPROVERS[action]}</p>

          {changesNostr && (
            <fieldset disabled={busy}>
              <legend>New Nostr key</legend>
              {newNostr ? (
                <p>
                  <code className="wrap">{newNostr.npub}</code>
                </p>
              ) : (
                <div className="actions">
                  <button type="button" onClick={() => setNewNostr(createMemorySigner())}>
                    Create a new key
                  </button>
                  {nip07 && (
                    <button type="button" onClick={() => void newNip07()}>
                      Use the browser extension
                    </button>
                  )}
                </div>
              )}
            </fieldset>
          )}

          {changesBch && (
            <BchWalletPanel
              network={binding.bch.network}
              wallet={newBch}
              onChange={setNewBch}
              title="New Bitcoin Cash key"
              step={null}
              headingId="new-bch-title"
              {...(wizardRelays ? { wizardRelays } : {})}
            />
          )}

          {action === "revoke" && (
            <fieldset disabled={busy}>
              <legend>Second key</legend>
              <label>
                <input
                  type="radio"
                  name="revoke-with"
                  checked={revokeWith === "bch"}
                  onChange={() => setRevokeWith("bch")}
                />{" "}
                The BCH key
              </label>
              <label>
                <input
                  type="radio"
                  name="revoke-with"
                  checked={revokeWith === "recovery"}
                  disabled={!hasRecovery}
                  onChange={() => setRevokeWith("recovery")}
                />{" "}
                The recovery key
              </label>
              <p className="warning">
                After a revocation the identity has no current binding, and logins with it are
                refused. It cannot be undone.
              </p>
            </fieldset>
          )}

          {usesRecovery && !recovery?.signer && (
            <label>
              Recovery key nsec (kept in this tab&apos;s memory, used once, never sent)
              <input
                type="password"
                value={nsec}
                placeholder="nsec1…"
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setNsec(event.target.value)}
              />
            </label>
          )}
          {usesRecovery && recovery?.signer && (
            <p className="note">The recovery key created in this tab will approve.</p>
          )}

          <button
            type="button"
            className={action === "revoke" ? "btn-danger" : "btn-primary"}
            disabled={busy || !ready || relays.length === 0}
            onClick={() => void run()}
          >
            {busy ? "Waiting for signatures…" : BUTTON[action]}
          </button>
        </>
      )}

      {done && (
        <div role="status">
          <p>
            {done.result.binding.form === "revocation" ? "Revoked" : "Replaced"} and published to{" "}
            {done.published.accepted.length} of {relays.length} relays.
          </p>
          <dl className="facts">
            <dt>Approved by</dt>
            <dd>{done.result.binding.approvedBy.map((role) => ROLE_NAMES[role]).join(" and ")}</dd>
            <dt>Binding ID</dt>
            <dd>
              <code className="wrap">{done.result.binding.bindingId}</code>
            </dd>
            <dt>History</dt>
            <dd>
              {done.result.binding.history.length} earlier binding
              {done.result.binding.history.length === 1 ? "" : "s"}
            </dd>
          </dl>
        </div>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
