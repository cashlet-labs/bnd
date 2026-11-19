import { DEFAULT_RELAYS } from "@cashlet-labs/bnd-nostr";

/** The demo's own relay, started by `npm run demo` or `npm run dev:relay`. */
export const LOCAL_RELAY: string =
  (import.meta.env.VITE_LOCAL_RELAY as string | undefined) ?? "ws://127.0.0.1:7777";

export interface RelayChoice {
  local: boolean;
  public: boolean;
}

/** The relays the demo publishes to and reads from. */
export function selectedRelays(choice: RelayChoice): string[] {
  return [...(choice.local ? [LOCAL_RELAY] : []), ...(choice.public ? DEFAULT_RELAYS : [])];
}

export { DEFAULT_RELAYS as PUBLIC_RELAYS };
