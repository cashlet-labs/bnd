// Prints the page's security headers as nginx add_header lines, from the same
// source vite preview uses. The web image runs this at build time.
import {
  LOCAL_DEMO_RELAY,
  nginxHeaders,
  parseRelayList,
  securityHeaders,
} from "../../apps/web/security-headers.js";

const relays = parseRelayList(process.env.VITE_RELAYS, [LOCAL_DEMO_RELAY]);
process.stdout.write(`${nginxHeaders(securityHeaders(relays))}\n`);
