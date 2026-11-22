import { createServer } from "node:http";
import { DEFAULT_RELAYS, isSafeRelayUrl } from "@cashlet-labs/bnd/nostr";
import { createDriverHandler } from "./handler.js";

/**
 * Configuration, all optional:
 *   PORT              port to listen on (default 8080)
 *   BND_RELAYS        comma-separated wss:// relay URLs (default: the enforcing
 *                     relays and BND's default public relays)
 *   BND_MIN_COMPLETE  complete relay answers needed to resolve (default 2)
 */
const VERSION = "0.1.0";
const ENFORCING = ["wss://relay.septemlabs.com", "wss://relay.bongacash.co.ke"];

const relays = (process.env.BND_RELAYS ?? [...ENFORCING, ...DEFAULT_RELAYS].join(","))
  .split(",")
  .map((url) => url.trim())
  .filter((url) => url !== "");
const unsafe = relays.filter((url) => !isSafeRelayUrl(url));
if (relays.length === 0 || unsafe.length > 0) {
  console.error(
    `BND_RELAYS must be public wss:// URLs; refused: ${unsafe.join(", ") || "(none given)"}`,
  );
  process.exit(1);
}
const minComplete = Number(process.env.BND_MIN_COMPLETE ?? 2);
if (!Number.isInteger(minComplete) || minComplete < 1 || minComplete > relays.length) {
  console.error(`BND_MIN_COMPLETE must be a whole number from 1 to ${relays.length}`);
  process.exit(1);
}
const port = Number(process.env.PORT ?? 8080);

const server = createServer(
  { requestTimeout: 30_000, headersTimeout: 10_000 },
  createDriverHandler({ resolve: { relays, minComplete }, version: VERSION }),
);
server.listen(port, "0.0.0.0", () => {
  console.log(
    `did:bnd driver ${VERSION} on port ${port}; ${minComplete} of ${relays.length} relays must answer: ${relays.join(", ")}`,
  );
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
