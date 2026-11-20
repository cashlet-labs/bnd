import { useState } from "react";
import { npubEncode } from "@cashlet-labs/bnd";
import { paymentUri, resolvePayee as defaultResolvePayee, type Payee } from "@cashlet-labs/bnd/did";
import { QrCode } from "./QrCode";

export interface PayPanelProps {
  relays: string[];
  /** Injected in tests. */
  resolvePayee?: typeof defaultResolvePayee;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Pay someone by their identity instead of a pasted address: resolve their
 * npub or did:bnd to the current, verified BCH address, then hand any wallet a
 * BCH payment request, or the token-aware address for CashTokens. The page
 * never sends anything itself.
 */
export function PayPanel({ relays, resolvePayee = defaultResolvePayee }: PayPanelProps) {
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [payee, setPayee] = useState<Payee | null>(null);
  const [resolvedAt, setResolvedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolve() {
    setBusy(true);
    setError(null);
    setPayee(null);
    try {
      const result = await resolvePayee(target, {
        relays,
        // A local demo has a single relay; otherwise at least two must answer.
        minComplete: Math.min(2, relays.length),
      });
      if (!result.ok) throw new Error(result.reason);
      setPayee(result);
      setResolvedAt(new Date());
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  let uri: string | null = null;
  let amountError: string | null = null;
  if (payee) {
    try {
      uri = paymentUri(payee.address, {
        amount: amount.trim(),
        label: npubEncode(payee.binding.nostrPublicKey).slice(0, 16),
      });
    } catch (cause) {
      amountError = message(cause);
    }
  }
  const mainnet = payee?.binding.bch.network === "mainnet";
  const holding = payee?.relays.filter((report) => report.valid > 0).length ?? 0;

  return (
    <section aria-labelledby="pay-title">
      <h2 id="pay-title">Pay this identity</h2>
      <p>
        Enter someone&apos;s npub or did:bnd. The page finds their current binding, verifies it, and
        gives your wallet a payment request, so you never copy an address by hand. It sends nothing
        itself.
      </p>
      <label>
        npub or did:bnd
        <input
          type="text"
          value={target}
          placeholder="npub1… or did:bnd:…"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setTarget(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="btn-primary"
        disabled={busy || relays.length === 0 || target.trim() === ""}
        onClick={() => void resolve()}
      >
        {busy ? "Asking relays…" : "Find where to pay"}
      </button>

      {payee && (
        <div role="status">
          <p className="note">
            Verified at {resolvedAt?.toLocaleTimeString()} from {holding}{" "}
            {holding === 1 ? "relay" : "relays"}. Resolve again right before paying: keys can
            rotate.
          </p>
          {mainnet ? (
            <p className="warning">Mainnet: this request moves real BCH.</p>
          ) : (
            <p className="note">Chipnet: pay with a wallet set to chipnet. Test coins only.</p>
          )}

          <fieldset>
            <legend>Bitcoin Cash</legend>
            <label>
              Amount in BCH (optional)
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                placeholder="0.001"
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
            {amountError && (
              <p className="error" role="alert">
                {amountError}
              </p>
            )}
            {uri && (
              <>
                <div className="qr-box">
                  <QrCode value={uri} label="BCH payment request" />
                </div>
                <code className="wrap" aria-label="Payment request">
                  {uri}
                </code>
                <div className="actions">
                  <a className="btn-primary" href={uri}>
                    Open in wallet
                  </a>
                </div>
              </>
            )}
          </fieldset>

          <fieldset>
            <legend>CashTokens</legend>
            <p className="note">
              Send tokens to the token-aware form of the same address, from a wallet that supports
              CashTokens. Choose the token and amount in your wallet.
            </p>
            <div className="qr-box">
              <QrCode value={payee.tokenAddress} label="Token-aware address" />
            </div>
            <code className="wrap" aria-label="Token address">
              {payee.tokenAddress}
            </code>
          </fieldset>

          <dl className="facts">
            <dt>DID</dt>
            <dd>
              <code className="wrap">{payee.did}</code>
            </dd>
            <dt>Nostr key</dt>
            <dd>
              <code className="wrap">{npubEncode(payee.binding.nostrPublicKey)}</code>
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
