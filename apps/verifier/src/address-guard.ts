import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/**
 * Address ranges a server must never be talked into connecting to on behalf of
 * an untrusted party: private, loopback, link-local, shared, documentation,
 * benchmarking, multicast and reserved ranges, and IPv6 forms that embed IPv4.
 *
 * Node applies the IPv4 rules to IPv4-mapped IPv6 addresses (`::ffff:a.b.c.d`)
 * by itself, so that range is not listed: listing it would block all of IPv4.
 */
const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(network, prefix, "ipv6");
}

/** True when an IP address is publicly routable. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  if (family === 6) return !blocked.check(address, "ipv6");
  return false;
}

/**
 * True when every address a relay URL's host resolves to is public. Used before
 * connecting to relays named by users.
 *
 * Remaining risk: the name is resolved again when the connection opens, so a
 * DNS server that changes its answer in between (DNS rebinding) can still
 * steer that connection. Running the verifier with no route to internal
 * networks closes this completely.
 */
export async function resolvesToPublicAddresses(
  url: string,
  resolve: (host: string) => Promise<{ address: string }[]> = (host) =>
    lookup(host, { all: true, verbatim: true }),
): Promise<boolean> {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  try {
    const addresses = await resolve(host);
    return addresses.length > 0 && addresses.every((entry) => isPublicAddress(entry.address));
  } catch {
    return false;
  }
}
