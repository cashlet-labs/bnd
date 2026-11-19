/**
 * Security headers for the built page, shared by `vite preview` (vite.config.ts)
 * and the deployed nginx (deploy/web/write-nginx-headers.ts), so both serve the
 * same policy.
 *
 * Scripts, styles, fonts and images come only from the page itself (images also
 * as data: for QR codes). `'wasm-unsafe-eval'` lets libauth compile its
 * WebAssembly; JavaScript eval stays blocked. Network access is the page's own
 * origin, secure WebSocket relays (users choose their own), and any plain
 * `ws://` relay of the site, such as the local demo relay. Nothing may frame
 * the page.
 */
export function securityHeaders(siteRelays: readonly string[]): Record<string, string> {
  const plainRelays = siteRelays.filter((url) => url.startsWith("ws://"));
  const connect = ["'self'", ...plainRelays, "wss:"].join(" ");
  const csp = [
    "default-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connect}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join("; ");
  return {
    "Content-Security-Policy": csp,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
}

/** The site's relays from a comma-separated setting such as `VITE_RELAYS`. */
export function parseRelayList(value: string | undefined, fallback: readonly string[]): string[] {
  const relays = (value ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url !== "");
  return relays.length > 0 ? relays : [...fallback];
}

export const LOCAL_DEMO_RELAY = "ws://127.0.0.1:7777";

/**
 * The headers as nginx `add_header` lines. `always` sends them on error pages
 * too. Values must not contain double quotes or new lines.
 */
export function nginxHeaders(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([name, value]) => {
      if (/["\n\r\\]/.test(value)) throw new Error(`header ${name} cannot be written for nginx`);
      return `add_header ${name} "${value}" always;`;
    })
    .join("\n");
}
