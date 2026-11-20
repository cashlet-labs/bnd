import { useState } from "react";
import {
  bchProofMessage,
  createBinding as defaultCreateBinding,
  type BchProofType,
  type VerifiedBinding,
} from "@cashlet-labs/bnd-core";
import {
  publishBinding as defaultPublishBinding,
  type PublishSummary,
} from "@cashlet-labs/bnd-nostr";
import type { ConnectedBchSigner } from "../signers/bch";
import type { ConnectedNostrSigner } from "../signers/nostr";
import type { RecoveryKey } from "../signers/recovery";
import { chosenRecoveryKey, NO_RECOVERY, type RecoveryChoice } from "../state/recovery-choice";
import { RecoveryKeyPicker } from "./RecoveryKeyPicker";

export interface BindingPanelProps {
  nostr: ConnectedNostrSigner | null;
  bch: ConnectedBchSigner | null;
  relays: string[];
  binding: VerifiedBinding | null;
  /** The binding's recovery key, shown once the binding exists. */
  recovery?: RecoveryKey | null;
  onBinding: (binding: VerifiedBinding | null, recovery: RecoveryKey | null) => void;
  /** Injected in tests. */
  createBinding?: typeof defaultCreateBinding;
  publishBinding?: typeof defaultPublishBinding;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Creates the binding with both keys, then publishes it to the chosen relays. */
export function BindingPanel({
  nostr,
  bch,
  relays,
  binding,
  recovery = null,
  onBinding,
  createBinding = defaultCreateBinding,
  publishBinding = defaultPublishBinding,
}: BindingPanelProps) {
  const [proofType, setProofType] = useState<BchProofType>("tx");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<PublishSummary | null>(null);
  const [recoveryChoice, setRecoveryChoice] = useState<RecoveryChoice>(NO_RECOVERY);
  const recoveryStatus = chosenRecoveryKey(recoveryChoice);

  const ready = nostr !== null && bch !== null;
  const available = bch?.proofTypes ?? [];
  const chosen = available.includes(proofType) ? proofType : available[0];

  async function create() {
    if (!nostr || !bch || !chosen || !recoveryStatus.ok) return;
    const recoveryKey = recoveryStatus.key;
    setBusy(true);
    setError(null);
    setPublished(null);
    try {
      const created = await createBinding({
        nostrSigner: nostr.signer,
        bchSigner: bch.signer,
        bchKeyHash: bch.keyHash,
        network: bch.network,
        proofType: chosen,
        ...(recoveryKey === null ? {} : { recoveryPublicKey: recoveryKey.publicKey }),
      });
      // Only the public key and the signer are kept; the nsec is not shown again.
      onBinding(
        created,
        recoveryKey === null
          ? null
          : {
              publicKey: recoveryKey.publicKey,
              npub: recoveryKey.npub,
              ...(recoveryKey.signer ? { signer: recoveryKey.signer } : {}),
            },
      );
      setRecoveryChoice(NO_RECOVERY);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!binding) return;
    setBusy(true);
    setError(null);
    try {
      setPublished(await publishBinding(binding.event, { relays }));
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="binding-title">
      <h2 id="binding-title">
        <span className="step">3</span> Bind and publish
      </h2>
      {!ready && <p className="note">Connect a Nostr identity and a Bitcoin Cash key first.</p>}

      {ready && !binding && (
        <>
          <fieldset disabled={busy}>
            <legend>BCH proof</legend>
            {available.map((type) => (
              <label key={type}>
                <input
                  type="radio"
                  name="proof-type"
                  value={type}
                  checked={chosen === type}
                  onChange={() => setProofType(type)}
                />{" "}
                {type === "tx" ? "Transaction proof (never broadcast)" : "Signed message"}
              </label>
            ))}
          </fieldset>
          <RecoveryKeyPicker
            network={bch.network}
            choice={recoveryChoice}
            onChange={setRecoveryChoice}
            disabled={busy}
          />
          <p>
            Your Nostr key and your BCH key will each sign a statement naming the other. Nothing is
            sent on chain.
          </p>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || !chosen || !recoveryStatus.ok}
            onClick={() => void create()}
          >
            {busy ? "Waiting for signatures…" : "Create binding"}
          </button>
        </>
      )}

      {binding && (
        <>
          <dl className="facts">
            <dt>Binding ID</dt>
            <dd>
              <code className="wrap">{binding.bindingId}</code>
            </dd>
            <dt>Nostr key</dt>
            <dd>
              <code className="wrap">{nostr?.npub ?? binding.nostrPublicKey}</code>
            </dd>
            <dt>BCH address</dt>
            <dd>
              <code className="wrap">{binding.bch.address}</code>
            </dd>
            <dt>BCH proof</dt>
            <dd>
              {binding.proofType === null
                ? "none (revoked)"
                : binding.proofType === "tx"
                  ? "transaction"
                  : "signed message"}
            </dd>
            <dt>Recovery key</dt>
            <dd>
              {binding.record.recovery ? (
                <code className="wrap">{recovery?.npub ?? binding.record.recovery.publicKey}</code>
              ) : (
                "none"
              )}
            </dd>
          </dl>
          <details>
            <summary>What the BCH key approved</summary>
            <pre className="wrap">{bchProofMessage(binding.record)}</pre>
          </details>
          <details>
            <summary>Signed Nostr event</summary>
            <pre className="wrap">{JSON.stringify(binding.event, null, 2)}</pre>
          </details>
          <div className="actions">
            <button
              type="button"
              className="btn-primary"
              disabled={busy || relays.length === 0}
              onClick={() => void publish()}
            >
              {busy ? "Publishing…" : "Publish to relays"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setPublished(null);
                onBinding(null, null);
              }}
            >
              Start over
            </button>
          </div>
          {published && (
            <div role="status">
              <p>
                {published.ok
                  ? `Published to ${published.accepted.length} of ${relays.length} relays.`
                  : "No relay accepted the binding."}
              </p>
              {published.failed.length > 0 && (
                <ul>
                  {published.failed.map((failure) => (
                    <li key={failure.url}>
                      {failure.url}: {failure.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
