import { useState } from "react";
import type { BchNetwork, VerifiedBinding } from "@cashlet-labs/bnd-core";
import { BchWalletPanel } from "./components/BchWalletPanel";
import { BindingPanel } from "./components/BindingPanel";
import { DiscoverPanel } from "./components/DiscoverPanel";
import { LoginPanel } from "./components/LoginPanel";
import { NetworkPicker } from "./components/NetworkPicker";
import { NostrSignerPanel } from "./components/NostrSignerPanel";
import { RelaySettings } from "./components/RelaySettings";
import { selectedRelays, type RelayChoice } from "./relays";
import type { ConnectedBchSigner } from "./signers/bch";
import type { ConnectedNostrSigner } from "./signers/nostr";

export interface AppProps {
  /** Relays for the WizardConnect handshake. Tests use a local relay. */
  wizardRelays?: string[];
}

export function App({ wizardRelays }: AppProps = {}) {
  const [network, setNetwork] = useState<BchNetwork>("chipnet");
  const [relayChoice, setRelayChoice] = useState<RelayChoice>({ local: true, public: false });
  const [nostr, setNostr] = useState<ConnectedNostrSigner | null>(null);
  const [bch, setBch] = useState<ConnectedBchSigner | null>(null);
  const [binding, setBinding] = useState<VerifiedBinding | null>(null);
  const relays = selectedRelays(relayChoice);

  return (
    <main>
      <h1>BND identity demo</h1>
      <p>Bind a Bitcoin Cash key to a Nostr key, publish it, verify it and log in with it.</p>
      {network === "mainnet" && (
        <p className="banner" role="status">
          Mainnet: real funds and a real public identity are at stake.
        </p>
      )}
      <NetworkPicker network={network} onChange={setNetwork} disabled={bch !== null} />
      <RelaySettings choice={relayChoice} onChange={setRelayChoice} />
      <NostrSignerPanel
        signer={nostr}
        onChange={(next) => {
          setNostr(next);
          setBinding(null);
        }}
      />
      <BchWalletPanel
        network={network}
        wallet={bch}
        onChange={(next) => {
          setBch(next);
          setBinding(null);
        }}
        {...(wizardRelays ? { wizardRelays } : {})}
      />
      <BindingPanel
        nostr={nostr}
        bch={bch}
        relays={relays}
        binding={binding}
        onBinding={setBinding}
      />
      <DiscoverPanel relays={relays} {...(nostr ? { suggestion: nostr.npub } : {})} />
      <LoginPanel nostr={nostr} bch={bch} binding={binding} />
    </main>
  );
}
