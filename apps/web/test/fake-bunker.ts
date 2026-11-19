import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { decrypt, encrypt, getConversationKey } from "nostr-tools/nip44";
import { SimplePool } from "nostr-tools/pool";

const NOSTR_CONNECT = 24133;

export interface FakeBunkerOptions {
  relays: string[];
  /** Ask for approval at this URL before answering the first sign_event. */
  authUrl?: string;
  /** Refuse to sign anything. */
  refuseSigning?: boolean;
}

/**
 * A minimal NIP-46 remote signer for tests. It holds a user key, listens on
 * the given relays, and answers connect, get_public_key, sign_event, ping and
 * switch_relays over NIP-44 encrypted kind 24133 events.
 */
export function startFakeBunker(options: FakeBunkerOptions) {
  const userKey = generateSecretKey();
  const bunkerKey = generateSecretKey();
  const bunkerPubkey = getPublicKey(bunkerKey);
  const pool = new SimplePool();
  const seen: string[] = [];
  let askedForAuth = false;

  async function reply(
    clientPubkey: string,
    id: string,
    body: { result?: string; error?: string },
  ) {
    const key = getConversationKey(bunkerKey, clientPubkey);
    const event = finalizeEvent(
      {
        kind: NOSTR_CONNECT,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", clientPubkey]],
        content: encrypt(JSON.stringify({ id, ...body }), key),
      },
      bunkerKey,
    );
    try {
      await Promise.any(pool.publish(options.relays, event));
    } catch {
      // The test already closed the connection; nobody is waiting for this answer.
    }
  }

  const subscription = pool.subscribe(
    options.relays,
    { kinds: [NOSTR_CONNECT], "#p": [bunkerPubkey], limit: 0 },
    {
      onevent: async (event) => {
        let request: { id: string; method: string; params: string[] };
        try {
          request = JSON.parse(decrypt(event.content, getConversationKey(bunkerKey, event.pubkey)));
        } catch {
          return;
        }
        seen.push(request.method);
        switch (request.method) {
          case "connect":
            return reply(event.pubkey, request.id, { result: "ack" });
          case "get_public_key":
            return reply(event.pubkey, request.id, { result: getPublicKey(userKey) });
          case "ping":
            return reply(event.pubkey, request.id, { result: "pong" });
          case "switch_relays":
            return reply(event.pubkey, request.id, { result: "null" });
          case "sign_event": {
            if (options.refuseSigning) {
              return reply(event.pubkey, request.id, { error: "user refused" });
            }
            if (options.authUrl && !askedForAuth) {
              askedForAuth = true;
              await reply(event.pubkey, request.id, { result: "auth_url", error: options.authUrl });
            }
            const template = JSON.parse(request.params[0] ?? "{}");
            const signed = finalizeEvent(template, userKey);
            return reply(event.pubkey, request.id, { result: JSON.stringify(signed) });
          }
          default:
            return reply(event.pubkey, request.id, {
              error: `unsupported method ${request.method}`,
            });
        }
      },
    },
  );

  return {
    userPubkey: getPublicKey(userKey),
    bunkerPubkey,
    bunkerUrl: `bunker://${bunkerPubkey}?${options.relays.map((r) => `relay=${encodeURIComponent(r)}`).join("&")}`,
    seen,
    /** Answer a nostrconnect:// request as a signer app does after scanning it. */
    async acceptNostrConnect(uri: string) {
      const url = new URL(uri);
      const clientPubkey = url.hostname || url.pathname.replace(/^\/+/, "");
      const secret = url.searchParams.get("secret") ?? "";
      await reply(clientPubkey, Math.random().toString(36).slice(2), { result: secret });
    },
    close() {
      subscription.close();
      pool.destroy();
    },
  };
}
