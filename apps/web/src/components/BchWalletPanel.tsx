import { useEffect, useRef, useState } from "react";
import type { BchNetwork } from "@cashlet-labs/bnd-core";
import { createTestBchSigner, type ConnectedBchSigner } from "../signers/bch";
import {
  startWizardConnect as defaultStartWizardConnect,
  type WizardConnectSession,
} from "../signers/wizardconnect";
import { QrCode } from "./QrCode";

export interface BchWalletPanelProps {
  network: BchNetwork;
  wallet: ConnectedBchSigner | null;
  onChange: (wallet: ConnectedBchSigner | null) => void;
  /** Injected in tests. */
  startWizardConnect?: typeof defaultStartWizardConnect;
  /** Relays for the WizardConnect handshake; tests point it at a local relay. */
  wizardRelays?: string[];
  /** Heading, its step number (null for none) and its element ID, when reused. */
  title?: string;
  step?: string | null;
  headingId?: string;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Connects the BCH wallet whose key the binding will name. */
export function BchWalletPanel({
  network,
  wallet,
  onChange,
  startWizardConnect = defaultStartWizardConnect,
  wizardRelays,
  title = "Bitcoin Cash key",
  step = "2",
  headingId = "bch-title",
}: BchWalletPanelProps) {
  const heading = (
    <h2 id={headingId}>
      {step !== null && <span className="step">{step}</span>} {title}
    </h2>
  );
  const [index, setIndex] = useState("0");
  const [pending, setPending] = useState<WizardConnectSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef<WizardConnectSession | null>(null);

  useEffect(() => () => void pendingRef.current?.cancel(), []);

  function connectWallet() {
    setError(null);
    const addressIndex = Number(index);
    let session: WizardConnectSession;
    try {
      session = startWizardConnect({
        network,
        index: addressIndex,
        ...(wizardRelays ? { relayUrls: wizardRelays } : {}),
      });
    } catch (cause) {
      setError(message(cause));
      return;
    }
    pendingRef.current = session;
    setPending(session);
    session.connected
      .then((connected) => {
        if (pendingRef.current !== session) return;
        pendingRef.current = null;
        setPending(null);
        onChange({
          kind: "wizardconnect",
          label: connected.walletName,
          keyHash: connected.keyHash,
          address: connected.address,
          network,
          signer: connected.signer,
          proofTypes: ["tx"],
          disconnect: connected.disconnect,
        });
      })
      .catch((cause: unknown) => {
        if (pendingRef.current !== session) return;
        pendingRef.current = null;
        setPending(null);
        setError(message(cause));
      });
  }

  async function cancel() {
    const session = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    await session?.cancel();
  }

  async function disconnect() {
    await wallet?.disconnect();
    onChange(null);
  }

  if (wallet) {
    return (
      <section aria-labelledby={headingId}>
        {heading}
        <p>
          Connected: {wallet.label}
          <br />
          <code className="wrap">{wallet.address}</code>
        </p>
        <p className="note">
          Proofs this connection can give:{" "}
          {wallet.proofTypes.map((type) => (type === "tx" ? "transaction" : "message")).join(", ")}
        </p>
        {wallet.kind === "test-key" && (
          <p className="note">This key exists only in this page and holds no funds.</p>
        )}
        <button type="button" className="btn-danger" onClick={() => void disconnect()}>
          {wallet.kind === "test-key" ? "Discard this key" : "Disconnect wallet"}
        </button>
      </section>
    );
  }

  return (
    <section aria-labelledby={headingId}>
      {heading}

      <fieldset>
        <legend>Wallet (WizardConnect)</legend>
        <p className="note">
          Make sure your wallet is set to {network}. The wallet signs a proof transaction that
          spends nothing and is never broadcast.
        </p>
        <label>
          Address index on the receive chain
          <input
            type="text"
            inputMode="numeric"
            value={index}
            onChange={(event) => setIndex(event.target.value.replace(/[^0-9]/g, ""))}
          />
        </label>
        {pending ? (
          <div className="qr-box">
            <QrCode value={pending.uri} label="WizardConnect code for a BCH wallet" />
            <p>
              <code className="wrap">{pending.uri}</code>
            </p>
            <p>Waiting for your wallet…</p>
            <button type="button" onClick={() => void cancel()}>
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn-primary"
            disabled={index === ""}
            onClick={connectWallet}
          >
            Connect a wallet
          </button>
        )}
      </fieldset>

      <fieldset disabled={network !== "chipnet"}>
        <legend>Local test key</legend>
        <p className="note">
          {network === "chipnet"
            ? "Creates a BCH key in this page that can give both proof types. It holds no funds."
            : "Only available on chipnet."}
        </p>
        <button type="button" onClick={() => onChange(createTestBchSigner(network))}>
          Create a test key
        </button>
      </fieldset>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
