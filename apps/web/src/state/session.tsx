import { useMemo, useState, type ReactNode } from "react";
import type { BchNetwork, VerifiedBinding } from "@cashlet-labs/bnd-core";
import type { RelayChoice } from "../relays";
import type { ConnectedBchSigner } from "../signers/bch";
import type { ConnectedNostrSigner } from "../signers/nostr";
import { SessionContext, type Session } from "./session-context";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [network, setNetwork] = useState<BchNetwork>("chipnet");
  const [relayChoice, setRelayChoice] = useState<RelayChoice>({ local: true, public: false });
  const [nostr, setNostrState] = useState<ConnectedNostrSigner | null>(null);
  const [bch, setBchState] = useState<ConnectedBchSigner | null>(null);
  const [binding, setBinding] = useState<VerifiedBinding | null>(null);

  const value = useMemo<Session>(
    () => ({
      network,
      setNetwork,
      relayChoice,
      setRelayChoice,
      nostr,
      // A binding names both keys, so replacing either key discards it.
      setNostr: (signer) => {
        setNostrState(signer);
        setBinding(null);
      },
      bch,
      setBch: (signer) => {
        setBchState(signer);
        setBinding(null);
      },
      binding,
      setBinding,
    }),
    [network, relayChoice, nostr, bch, binding],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
