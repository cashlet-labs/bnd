import { useState } from "react";
import { decodeBchAddress, npubEncode, type VerifiedBinding } from "@cashlet-labs/bnd-core";
import {
  discoverBinding as defaultDiscoverBinding,
  discoverByBchKeyHash as defaultDiscoverByBchKeyHash,
  type RelayReport,
} from "@cashlet-labs/bnd-nostr";

export interface DiscoverPanelProps {
  relays: string[];
  /** Pre-fills the search with the user's own npub. */
  suggestion?: string;
  /** "step" inside the demo; "standalone" on the verifier page. */
  variant?: "step" | "standalone";
  /** Injected in tests. */
  discoverBinding?: typeof defaultDiscoverBinding;
  discoverByBchKeyHash?: typeof defaultDiscoverByBchKeyHash;
}

interface Found {
  bindings: VerifiedBinding[];
  relays: RelayReport[];
  query: string;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Finds and verifies a binding the way any independent application would:
 * ask relays, verify every event locally, trust nothing the relays say.
 */
export function DiscoverPanel({
  relays,
  suggestion = "",
  variant = "step",
  discoverBinding = defaultDiscoverBinding,
  discoverByBchKeyHash = defaultDiscoverByBchKeyHash,
}: DiscoverPanelProps) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    const value = (query.trim() || suggestion).trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    setFound(null);
    try {
      if (value.startsWith("npub1") || /^[0-9a-f]{64}$/.test(value)) {
        const result = await discoverBinding(value, { relays });
        setFound({
          bindings: result.binding ? [result.binding] : [],
          relays: result.relays,
          query: value,
        });
      } else {
        const { keyHash } = decodeBchAddress(value);
        const result = await discoverByBchKeyHash(keyHash, { relays });
        setFound({ bindings: result.bindings, relays: result.relays, query: value });
      }
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="discover-title">
      <h2 id="discover-title">
        {variant === "step" && <span className="step">4</span>}{" "}
        {variant === "step" ? "Discover and verify" : "Look up an identity"}
      </h2>
      <p>
        Look up a Nostr identity or a Bitcoin Cash address. Every result is verified in this page;
        no relay or server is trusted.
      </p>
      <label>
        npub or BCH address
        <input
          type="text"
          value={query}
          placeholder={suggestion || "npub1… or bitcoincash:…"}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="btn-primary"
        disabled={busy || relays.length === 0 || !(query.trim() || suggestion)}
        onClick={() => void search()}
      >
        {busy ? "Asking relays…" : "Find and verify"}
      </button>

      {found && (
        <div role="status">
          {found.bindings.length === 0 ? (
            <p>No verified binding found for {found.query}.</p>
          ) : (
            found.bindings.map((binding) => (
              <div key={binding.event.id}>
                <ul className="checks" aria-label="Checks passed">
                  <li>Nostr signature on the binding event is valid</li>
                  <li>
                    BCH {binding.proofType === "tx" ? "transaction proof" : "message proof"} was
                    made by the bound key
                  </li>
                  <li>Both keys signed the same record, which names the other key</li>
                  <li>Newest valid binding for this key on the relays asked</li>
                </ul>
                <dl className="facts verified">
                  <dt>Verified</dt>
                  <dd>Both the Nostr key and the BCH key signed this binding.</dd>
                  <dt>Nostr key</dt>
                  <dd>
                    <code className="wrap">{npubEncode(binding.nostrPublicKey)}</code>
                  </dd>
                  <dt>BCH address</dt>
                  <dd>
                    <code className="wrap">{binding.bch.address}</code>
                  </dd>
                  <dt>BCH proof</dt>
                  <dd>{binding.proofType === "tx" ? "transaction" : "signed message"}</dd>
                  <dt>Created</dt>
                  <dd>{new Date(binding.record.createdAt * 1000).toISOString()}</dd>
                </dl>
              </div>
            ))
          )}
          <details>
            <summary>Relay answers</summary>
            <ul>
              {found.relays.map((report) => (
                <li key={report.url}>
                  {report.url}: {report.error ?? `${report.valid} valid of ${report.received}`}
                </li>
              ))}
            </ul>
          </details>
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
