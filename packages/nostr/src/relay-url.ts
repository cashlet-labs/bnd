/**
 * Rules for relay URLs that come from someone else, such as a user's NIP-65
 * relay list. Connecting to them on that person's say-so can be abused to
 * reach hosts the connecting side can see and they cannot (server-side
 * request forgery), so only plain public `wss://` URLs pass.
 *
 * A DNS name can still resolve to a private address. Servers should also
 * check resolved addresses before connecting; browsers cannot.
 */

const MAX_URL_LENGTH = 200;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** True when an untrusted relay URL is safe enough to connect to. */
export function isSafeRelayUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_URL_LENGTH)
    return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "wss:") return false;
  if (url.username !== "" || url.password !== "") return false;
  if (url.search !== "" || url.hash !== "") return false;
  const host = url.hostname.toLowerCase();
  if (host === "" || host.startsWith("[") || IPV4.test(host)) return false;
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (!host.includes(".") || host.endsWith(".")) return false;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa"))
    return false;
  return true;
}

/** A URL in one canonical form, so the same relay is not counted twice. */
export function normalizeRelayUrl(value: string): string {
  const url = new URL(value);
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${url.host.toLowerCase()}${path}`;
}
