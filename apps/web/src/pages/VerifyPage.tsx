import { DiscoverPanel } from "../components/DiscoverPanel";
import { PageHeader } from "../components/Layout";
import { PayPanel } from "../components/PayPanel";
import { RelaySettings } from "../components/RelaySettings";
import { selectedRelays } from "../relays";
import { useSession } from "../state/session-context";

export function VerifyPage() {
  const session = useSession();
  const relays = selectedRelays(session.relayChoice);
  return (
    <div className="page">
      <PageHeader eyebrow="Independent verifier" title="Verify a BND identity">
        Paste someone&apos;s npub or Bitcoin Cash address. This page asks the relays and checks
        every signature itself. No keys, wallet or account needed.
      </PageHeader>
      <div className="card settings">
        <RelaySettings choice={session.relayChoice} onChange={session.setRelayChoice} />
      </div>
      <DiscoverPanel relays={relays} variant="standalone" />
      <PayPanel relays={relays} />
    </div>
  );
}
