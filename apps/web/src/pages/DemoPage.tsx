import { BchWalletPanel } from "../components/BchWalletPanel";
import { BindingPanel } from "../components/BindingPanel";
import { DiscoverPanel } from "../components/DiscoverPanel";
import { PageHeader } from "../components/Layout";
import { LoginPanel } from "../components/LoginPanel";
import { NetworkPicker } from "../components/NetworkPicker";
import { NostrSignerPanel } from "../components/NostrSignerPanel";
import { RelaySettings } from "../components/RelaySettings";
import { selectedRelays } from "../relays";
import { useSession } from "../state/session-context";

export function DemoPage({ wizardRelays }: { wizardRelays?: string[] } = {}) {
  const session = useSession();
  const relays = selectedRelays(session.relayChoice);
  return (
    <div className="page">
      <PageHeader eyebrow="Demo" title="Create and use a BND identity">
        Bind a Bitcoin Cash key to a Nostr key, publish it, verify it and log in with it. Keys stay
        in this tab&apos;s memory only.
      </PageHeader>
      {session.network === "mainnet" && (
        <p className="banner" role="status">
          Mainnet: real funds and a real public identity are at stake.
        </p>
      )}
      <div className="card settings">
        <NetworkPicker
          network={session.network}
          onChange={session.setNetwork}
          disabled={session.bch !== null}
        />
        <RelaySettings choice={session.relayChoice} onChange={session.setRelayChoice} />
      </div>
      <NostrSignerPanel signer={session.nostr} onChange={session.setNostr} />
      <BchWalletPanel
        network={session.network}
        wallet={session.bch}
        onChange={session.setBch}
        {...(wizardRelays ? { wizardRelays } : {})}
      />
      <BindingPanel
        nostr={session.nostr}
        bch={session.bch}
        relays={relays}
        binding={session.binding}
        recovery={session.recovery}
        onBinding={(binding, recovery) => session.setIdentity({ binding, recovery })}
      />
      <DiscoverPanel
        relays={relays}
        {...(session.nostr ? { suggestion: session.nostr.npub } : {})}
      />
      <LoginPanel nostr={session.nostr} bch={session.bch} binding={session.binding} />
    </div>
  );
}
