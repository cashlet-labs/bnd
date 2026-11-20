import { createContext, useContext } from "react";
import type { BchNetwork, VerifiedBinding } from "@cashlet-labs/bnd";
import type { RelayChoice } from "../relays";
import type { ConnectedBchSigner } from "../signers/bch";
import type { ConnectedNostrSigner } from "../signers/nostr";
import type { RecoveryKey } from "../signers/recovery";

/**
 * What the visitor has connected in this tab. It lives in memory only and is kept
 * while moving between pages, so leaving the demo for the verifier does not drop
 * the keys. A reload or a closed tab ends it.
 */
export interface Session {
  network: BchNetwork;
  setNetwork: (network: BchNetwork) => void;
  relayChoice: RelayChoice;
  setRelayChoice: (choice: RelayChoice) => void;
  nostr: ConnectedNostrSigner | null;
  setNostr: (signer: ConnectedNostrSigner | null) => void;
  bch: ConnectedBchSigner | null;
  setBch: (signer: ConnectedBchSigner | null) => void;
  binding: VerifiedBinding | null;
  setBinding: (binding: VerifiedBinding | null) => void;
  /** The binding's recovery key, if it names one (BND-1 section 9.4). */
  recovery: RecoveryKey | null;
  setRecovery: (key: RecoveryKey | null) => void;
  /**
   * Replace the keys and the binding together, after a rotation or recovery.
   * Fields left out keep their value.
   */
  setIdentity: (identity: {
    nostr?: ConnectedNostrSigner | null;
    bch?: ConnectedBchSigner | null;
    binding: VerifiedBinding | null;
    recovery?: RecoveryKey | null;
  }) => void;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === null) throw new Error("useSession must be used inside SessionProvider");
  return session;
}
