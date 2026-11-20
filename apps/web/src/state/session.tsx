import { useMemo, useState, type ReactNode } from "react";
import type { BchNetwork, VerifiedBinding } from "@cashlet-labs/bnd-core";
import type { RelayChoice } from "../relays";
import type { ConnectedBchSigner } from "../signers/bch";
import type { ConnectedNostrSigner } from "../signers/nostr";
import type { RecoveryKey } from "../signers/recovery";
import { SessionContext, type Session } from "./session-context";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [network, setNetwork] = useState<BchNetwork>("chipnet");
  const [relayChoice, setRelayChoice] = useState<RelayChoice>({ site: true, public: false });
  const [nostr, setNostrState] = useState<ConnectedNostrSigner | null>(null);
  const [bch, setBchState] = useState<ConnectedBchSigner | null>(null);
  const [binding, setBinding] = useState<VerifiedBinding | null>(null);
  const [recovery, setRecovery] = useState<RecoveryKey | null>(null);

  const value = useMemo<Session>(
    () => ({
      network,
      setNetwork,
      relayChoice,
      setRelayChoice,
      nostr,
      // A binding names both keys, so replacing either key on its own discards it.
      setNostr: (signer) => {
        setNostrState(signer);
        setBinding(null);
        setRecovery(null);
      },
      bch,
      setBch: (signer) => {
        setBchState(signer);
        setBinding(null);
        setRecovery(null);
      },
      binding,
      setBinding,
      recovery,
      setRecovery,
      setIdentity: (identity) => {
        if (identity.nostr !== undefined) setNostrState(identity.nostr);
        if (identity.bch !== undefined) setBchState(identity.bch);
        if (identity.recovery !== undefined) setRecovery(identity.recovery);
        setBinding(identity.binding);
      },
    }),
    [network, relayChoice, nostr, bch, binding, recovery],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
