import { createNostrKeySigner, npubEncode, type NostrSigner } from "@cashlet-labs/bnd-core";
import { BunkerSigner, createNostrConnectURI, parseBunkerInput } from "nostr-tools/nip46";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

/** How the page reaches a Nostr key. */
export type NostrSignerKind = "nip07" | "memory" | "nip46";

/** A connected Nostr signer plus what the page shows about it. */
export interface ConnectedNostrSigner {
  kind: NostrSignerKind;
  signer: NostrSigner;
  publicKey: string;
  npub: string;
  /** Release the connection or wipe the in-memory key. */
  disconnect(): Promise<void>;
}

/** The NIP-07 provider a browser extension adds to the page. */
export interface Nip07Provider {
  getPublicKey(): Promise<string>;
  signEvent(event: unknown): Promise<unknown>;
}

const HEX_32 = /^[0-9a-f]{64}$/;

function connected(
  kind: NostrSignerKind,
  signer: NostrSigner,
  publicKey: string,
  disconnect: () => Promise<void>,
): ConnectedNostrSigner {
  if (!HEX_32.test(publicKey)) throw new Error("the signer returned an invalid public key");
  return { kind, signer, publicKey, npub: npubEncode(publicKey), disconnect };
}

/** The extension's provider, if one is installed. */
export function findNip07Provider(scope: unknown = globalThis): Nip07Provider | null {
  const candidate = (scope as { nostr?: unknown }).nostr;
  if (candidate === null || typeof candidate !== "object") return null;
  const provider = candidate as Partial<Nip07Provider>;
  return typeof provider.getPublicKey === "function" && typeof provider.signEvent === "function"
    ? (provider as Nip07Provider)
    : null;
}

/**
 * Use a NIP-07 browser extension. The key stays in the extension. Whatever it
 * returns is checked later: a binding or login is verified before use.
 */
export async function connectNip07(provider: Nip07Provider): Promise<ConnectedNostrSigner> {
  const publicKey = await provider.getPublicKey();
  const signer: NostrSigner = {
    getPublicKey: () => publicKey,
    signEvent: async (template) => (await provider.signEvent({ ...template })) as never,
  };
  return connected("nip07", signer, publicKey, async () => {});
}

/**
 * Generate a new key that lives only in this page's memory. It is gone when
 * the page reloads, and `disconnect` overwrites it.
 */
export function createMemorySigner(): ConnectedNostrSigner {
  const privateKey = generateSecretKey();
  const inner = createNostrKeySigner(privateKey);
  let wiped = false;
  const signer: NostrSigner = {
    getPublicKey: () => inner.getPublicKey(),
    signEvent: (template) => {
      if (wiped) throw new Error("this key has been discarded");
      return inner.signEvent(template);
    },
  };
  return connected("memory", signer, getPublicKey(privateKey), async () => {
    privateKey.fill(0);
    wiped = true;
  });
}

export interface RemoteSignerOptions {
  /** Called with a URL the remote signer wants the user to open to approve. */
  onAuthUrl?: (url: string) => void;
  /** Milliseconds to wait for each answer from the remote signer. Default 60 s. */
  timeoutMs?: number;
}

function wrapBunker(bunker: BunkerSigner, publicKey: string): ConnectedNostrSigner {
  const signer: NostrSigner = {
    getPublicKey: () => publicKey,
    signEvent: async (template) => (await bunker.signEvent({ ...template })) as never,
  };
  return connected("nip46", signer, publicKey, () => bunker.close());
}

function bunkerParams(options: RemoteSignerOptions) {
  return {
    timeout: options.timeoutMs ?? 60_000,
    ...(options.onAuthUrl ? { onauth: options.onAuthUrl } : {}),
  };
}

/**
 * Connect to a remote signer from a `bunker://` link the user pasted. Names
 * like `user@domain` are refused, so the page never fetches arbitrary sites.
 */
export async function connectBunker(
  link: string,
  options: RemoteSignerOptions = {},
): Promise<ConnectedNostrSigner> {
  const input = link.trim();
  if (!input.startsWith("bunker://")) throw new Error("paste a link that starts with bunker://");
  const pointer = await parseBunkerInput(input);
  if (pointer === null) throw new Error("this bunker link is not valid");
  if (pointer.relays.length === 0) throw new Error("this bunker link names no relays");
  const bunker = BunkerSigner.fromBunker(generateSecretKey(), pointer, bunkerParams(options));
  try {
    await bunker.connect({ name: "BND identity demo" });
    return wrapBunker(bunker, await bunker.getPublicKey());
  } catch (error) {
    await bunker.close();
    throw error;
  }
}

/** A pending `nostrconnect://` request, shown to the user as a QR code. */
export interface NostrConnectRequest {
  uri: string;
  /** Resolves when a signer app has scanned the code and answered. */
  connected: Promise<ConnectedNostrSigner>;
  cancel(): void;
}

/** Ask a signer app to connect by scanning a `nostrconnect://` code. */
export function startNostrConnect(
  relays: string[],
  options: RemoteSignerOptions = {},
): NostrConnectRequest {
  if (relays.length === 0) throw new Error("name at least one relay");
  for (const relay of relays) {
    // Plain ws:// is allowed only for a relay on this machine, such as the demo relay.
    const local = /^ws:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(relay);
    if (!local && !/^wss:\/\/[^\s]+$/.test(relay)) {
      throw new Error(`not a wss:// relay URL: ${relay}`);
    }
  }
  const clientKey = generateSecretKey();
  const secret = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const uri = createNostrConnectURI({
    clientPubkey: getPublicKey(clientKey),
    relays,
    secret,
    name: "BND identity demo",
  });
  const abort = new AbortController();
  const connectedSigner = (async () => {
    const bunker = await BunkerSigner.fromURI(clientKey, uri, bunkerParams(options), abort.signal);
    try {
      return wrapBunker(bunker, await bunker.getPublicKey());
    } catch (error) {
      await bunker.close();
      throw error;
    }
  })();
  return { uri, connected: connectedSigner, cancel: () => abort.abort() };
}

/** Relays the QR code asks the signer app to use, unless the user changes them. */
export const DEFAULT_NOSTR_CONNECT_RELAYS = ["wss://relay.damus.io", "wss://nos.lol"];
