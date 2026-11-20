import { useState } from "react";
import {
  decodeBchAddress,
  npubEncode,
  type IdentityState,
  type VerifiedBinding,
} from "@cashlet-labs/bnd";
import {
  discoverBinding as defaultDiscoverBinding,
  discoverByBchKeyHash as defaultDiscoverByBchKeyHash,
  type RelayReport,
} from "@cashlet-labs/bnd/nostr";
import { ChainView } from "./ChainView";
import { DidFact } from "./DidLink";

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
  state: IdentityState;
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
          state: result.state,
          bindings: result.binding ? [result.binding] : [],
          relays: result.relays,
          query: value,
        });
      } else {
        const { keyHash } = decodeBchAddress(value);
        const result = await discoverByBchKeyHash(keyHash, { relays });
        setFound({
          state: result.state,
          bindings: result.state.status === "disputed" ? [] : result.bindings,
          relays: result.relays,
          query: value,
        });
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
          {found.state.status === "disputed" ? (
            <p className="warning">
              Disputed: {found.state.bindings.length} bindings on different chains claim this
              identity. A key may have been stolen. Do not rely on it until a replacement approved
              by two of its keys settles it.
            </p>
          ) : found.state.status === "revoked" ? (
            <>
              <p className="warning">
                Revoked on {new Date(found.state.binding.record.createdAt * 1000).toISOString()}:
                this identity has no current binding.
              </p>
              <ChainView binding={found.state.binding} />
            </>
          ) : found.bindings.length === 0 && found.state.status === "current" ? (
            <p>
              This BCH key was replaced. The identity now uses{" "}
              <code className="wrap">{found.state.binding.bch.address}</code>.
            </p>
          ) : found.bindings.length === 0 ? (
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
                  <li>
                    Current binding: no replacement, revocation or conflicting binding on the relays
                    asked
                    {binding.history.length > 0 &&
                      `; replaces ${binding.history.length} earlier binding${binding.history.length === 1 ? "" : "s"}, each approved by two keys`}
                  </li>
                </ul>
                <dl className="facts verified">
                  <dt>Verified</dt>
                  <dd>Both the Nostr key and the BCH key signed this binding.</dd>
                  <DidFact binding={binding} />
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
                  <dt>Recovery key</dt>
                  <dd>
                    {binding.record.recovery ? (
                      <code className="wrap">{npubEncode(binding.record.recovery.publicKey)}</code>
                    ) : (
                      "none"
                    )}
                  </dd>
                </dl>
                <ChainView binding={binding} />
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
