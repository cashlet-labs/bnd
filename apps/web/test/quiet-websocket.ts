import { useWebSocketImplementation } from "nostr-tools/pool";
import WebSocket from "ws";

/**
 * nostr-tools clears a socket's `onerror` and then calls `close()`. If the
 * socket is still connecting, `ws` emits an "error" event on the next tick, and
 * with no listener left Node treats it as an uncaught exception. In tests this
 * happens when a relay pool shuts down while it is reconnecting, and it fails
 * the run at random. This socket always keeps one listener, so that late event
 * is dropped; `onerror` still sees every other error.
 */
export class QuietWebSocket extends WebSocket {
  constructor(...args: ConstructorParameters<typeof WebSocket>) {
    super(...args);
    this.on("error", () => {});
  }
}

/** Make relay pools created from now on use {@link QuietWebSocket}. */
export function useQuietWebSockets(): void {
  useWebSocketImplementation(QuietWebSocket);
}
