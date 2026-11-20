import type { VerifiedBinding } from "@cashlet-labs/bnd";
import { chainSteps } from "../chain";

const ROLE_NAMES = { nostr: "Nostr key", bch: "BCH key", recovery: "recovery key" } as const;

/**
 * An identity's chain, oldest first: each binding, what it changed, and which
 * keys of the binding before approved it. Every step was verified already.
 */
export function ChainView({ binding }: { binding: VerifiedBinding }) {
  const steps = chainSteps(binding);
  return (
    <details open={steps.length > 1}>
      <summary>
        History: {steps.length} binding{steps.length === 1 ? "" : "s"}
      </summary>
      <ol className="chain" aria-label="Binding history">
        {steps.map((step, index) => (
          <li key={step.bindingId}>
            <strong>{step.changes.join(", ")}</strong>{" "}
            <span className="note">{new Date(step.createdAt * 1000).toISOString()}</span>
            {index > 0 && (
              <>
                <br />
                Approved by {step.approvedBy.map((role) => ROLE_NAMES[role]).join(" and ")}
              </>
            )}
            {!step.revoked && (
              <dl className="facts">
                <dt>Nostr key</dt>
                <dd>
                  <code className="wrap">{step.npub}</code>
                </dd>
                <dt>BCH address</dt>
                <dd>
                  <code className="wrap">{step.address}</code>
                </dd>
                <dt>Recovery key</dt>
                <dd>{step.recovery ? <code className="wrap">{step.recovery}</code> : "none"}</dd>
              </dl>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}
