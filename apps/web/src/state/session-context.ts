import { createContext, useContext } from "react";
import type { BchNetwork, VerifiedBinding } from "@cashlet-labs/bnd-core";
import type { RelayChoice } from "../relays";
import type { ConnectedBchSigner } from "../signers/bch";
import type { ConnectedNostrSigner } from "../signers/nostr";

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
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === null) throw new Error("useSession must be used inside SessionProvider");
  return session;
}
