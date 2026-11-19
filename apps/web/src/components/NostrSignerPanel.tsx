import { useEffect, useRef, useState } from "react";
import {
  connectBunker as defaultConnectBunker,
  connectNip07,
  createMemorySigner,
  DEFAULT_NOSTR_CONNECT_RELAYS,
  findNip07Provider,
  startNostrConnect as defaultStartNostrConnect,
  type ConnectedNostrSigner,
  type Nip07Provider,
  type NostrConnectRequest,
} from "../signers/nostr";
import { QrCode } from "./QrCode";

export interface NostrSignerPanelProps {
  signer: ConnectedNostrSigner | null;
  onChange: (signer: ConnectedNostrSigner | null) => void;
  /** Injected in tests. Defaults to the browser extension, if any. */
  nip07Provider?: Nip07Provider | null;
  /** Injected in tests. */
  remote?: {
    connectBunker: typeof defaultConnectBunker;
    startNostrConnect: typeof defaultStartNostrConnect;
  };
}

const KIND_LABEL = {
  nip07: "browser extension (NIP-07)",
  memory: "new key kept in this page",
  nip46: "remote signer (NIP-46)",
} as const;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Lets the user choose how the page reaches their Nostr key. */
export function NostrSignerPanel({
  signer,
  onChange,
  nip07Provider = findNip07Provider(),
  remote = { connectBunker: defaultConnectBunker, startNostrConnect: defaultStartNostrConnect },
}: NostrSignerPanelProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bunkerLink, setBunkerLink] = useState("");
  const [relays, setRelays] = useState(DEFAULT_NOSTR_CONNECT_RELAYS.join("\n"));
  const [pending, setPending] = useState<NostrConnectRequest | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const pendingRef = useRef<NostrConnectRequest | null>(null);

  useEffect(() => () => pendingRef.current?.cancel(), []);

  async function run(action: () => Promise<ConnectedNostrSigner> | ConnectedNostrSigner) {
    setError(null);
    setBusy(true);
    try {
      onChange(await action());
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  function showQr() {
    setError(null);
    const list = relays
      .split(/\s+/)
      .map((relay) => relay.trim())
      .filter(Boolean);
    let request: NostrConnectRequest;
    try {
      request = remote.startNostrConnect(list, { onAuthUrl: setAuthUrl });
    } catch (cause) {
      setError(message(cause));
      return;
    }
    pendingRef.current = request;
    setPending(request);
    request.connected
      .then((connected) => {
        if (pendingRef.current !== request) return;
        pendingRef.current = null;
        setPending(null);
        onChange(connected);
      })
      .catch((cause: unknown) => {
        if (pendingRef.current !== request) return;
        pendingRef.current = null;
        setPending(null);
        setError(message(cause));
      });
  }

  function cancelQr() {
    pendingRef.current?.cancel();
    pendingRef.current = null;
    setPending(null);
  }

  async function disconnect() {
    if (signer) await signer.disconnect();
    setAuthUrl(null);
    onChange(null);
  }

  if (signer) {
    return (
      <section aria-labelledby="nostr-title">
        <h2 id="nostr-title">1. Nostr identity</h2>
        <p>
          Connected with a {KIND_LABEL[signer.kind]}:
          <br />
          <code className="wrap">{signer.npub}</code>
        </p>
        {signer.kind === "memory" && (
          <p className="note">This key exists only in this page. Reloading the page loses it.</p>
        )}
        {authUrl && <ApprovalLink url={authUrl} />}
        <button type="button" onClick={() => void disconnect()}>
          {signer.kind === "memory" ? "Discard this key" : "Disconnect"}
        </button>
      </section>
    );
  }

  return (
    <section aria-labelledby="nostr-title">
      <h2 id="nostr-title">1. Nostr identity</h2>
      <p>Choose how this page reaches your Nostr key. Your private key never leaves its signer.</p>

      <fieldset disabled={busy}>
        <legend>Browser extension (NIP-07)</legend>
        {nip07Provider ? (
          <button type="button" onClick={() => void run(() => connectNip07(nip07Provider))}>
            Use my browser extension
          </button>
        ) : (
          <p className="note">No Nostr extension found in this browser.</p>
        )}
      </fieldset>

      <fieldset disabled={busy}>
        <legend>Remote signer (NIP-46)</legend>
        <label>
          Bunker link
          <input
            type="text"
            value={bunkerLink}
            placeholder="bunker://…"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setBunkerLink(event.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={bunkerLink.trim() === ""}
          onClick={() =>
            void run(() => remote.connectBunker(bunkerLink, { onAuthUrl: setAuthUrl }))
          }
        >
          Connect with bunker link
        </button>

        <p>Or let a signer app scan a code:</p>
        <label>
          Relays for the signer app, one per line
          <textarea rows={2} value={relays} onChange={(event) => setRelays(event.target.value)} />
        </label>
        {pending ? (
          <div className="qr-box">
            <QrCode value={pending.uri} label="Nostr Connect code for a signer app" />
            <p>
              <code className="wrap">{pending.uri}</code>
            </p>
            <p>Waiting for your signer app…</p>
            <button type="button" onClick={cancelQr}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" onClick={showQr}>
            Show connection code
          </button>
        )}
      </fieldset>

      <fieldset disabled={busy}>
        <legend>New key for this demo</legend>
        <p className="note">
          Creates a key that lives only in this page. It is lost when the page reloads.
        </p>
        <button type="button" onClick={() => void run(() => createMemorySigner())}>
          Create a new key
        </button>
      </fieldset>

      {authUrl && <ApprovalLink url={authUrl} />}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function ApprovalLink({ url }: { url: string }) {
  let safe: string | null;
  try {
    safe = new URL(url).protocol === "https:" ? url : null;
  } catch {
    safe = null;
  }
  if (safe === null) {
    return (
      <p className="error" role="alert">
        Your signer asked for approval at an address that is not https. It was not shown.
      </p>
    );
  }
  return (
    <p className="warning">
      Your signer asks you to approve this request:{" "}
      <a href={safe} target="_blank" rel="noopener noreferrer">
        open the approval page
      </a>
    </p>
  );
}
