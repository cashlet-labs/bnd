import { DEFAULT_RELAYS } from "@cashlet-labs/bnd-nostr";
import { LOCAL_DEMO_RELAY, parseRelayList } from "../security-headers";
import { DEFAULT_NOSTR_CONNECT_RELAYS } from "./signers/nostr";

const env = import.meta.env as Record<string, string | undefined>;

/**
 * This site's own relays, from `VITE_RELAYS` (comma-separated). Without it, the
 * local relay that `npm run demo` and `npm run dev:relay` start.
 */
export const SITE_RELAYS: readonly string[] = parseRelayList(env.VITE_RELAYS, [LOCAL_DEMO_RELAY]);

/** How the page names the site's relays, from `VITE_RELAYS_LABEL`. */
export const SITE_RELAYS_LABEL: string = env.VITE_RELAYS_LABEL?.trim() || "Local demo relay";

export interface RelayChoice {
  /** This site's relays. */
  site: boolean;
  /** Well-known public relays; opt-in, because what is sent there stays public. */
  public: boolean;
}

/** The relays the demo publishes to and reads from, the site's own first. */
export function selectedRelays(choice: RelayChoice): string[] {
  return [
    ...new Set([...(choice.site ? SITE_RELAYS : []), ...(choice.public ? DEFAULT_RELAYS : [])]),
  ];
}

/**
 * Relays offered to NIP-46 signer apps: the site's secure relays first, then
 * well-known public ones. A phone cannot reach a loopback relay, so plain
 * `ws://` relays are left out.
 */
export const NOSTR_CONNECT_RELAYS: readonly string[] = [
  ...new Set([
    ...SITE_RELAYS.filter((url) => url.startsWith("wss://")),
    ...DEFAULT_NOSTR_CONNECT_RELAYS,
  ]),
];

export { DEFAULT_RELAYS as PUBLIC_RELAYS };
