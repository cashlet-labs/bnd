/** The part of the WebSocket API the client uses. Browsers and Node 22 provide it. */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
}

export type WebSocketConstructor = new (url: string) => WebSocketLike;

export const WS_OPEN = 1;
