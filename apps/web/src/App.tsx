import { useState } from "react";
import type { BchNetwork } from "@cashlet-labs/bnd-core";
import { NetworkPicker } from "./components/NetworkPicker";

export function App() {
  const [network, setNetwork] = useState<BchNetwork>("chipnet");

  return (
    <main>
      <h1>BND identity demo</h1>
      <p>Bind a Bitcoin Cash key to a Nostr key, publish it, verify it and log in with it.</p>
      {network === "mainnet" && (
        <p className="banner" role="status">
          Mainnet: real funds and a real public identity are at stake.
        </p>
      )}
      <NetworkPicker network={network} onChange={setNetwork} />
    </main>
  );
}
