import { deriveNostrKey, signEvent, type NostrEvent } from "@cashlet-labs/bnd-core";

const MNEMONIC = "leader monkey parrot ring guide accident before fence cannon height naive bean";

export const alice = deriveNostrKey(MNEMONIC, 0);
export const bob = deriveNostrKey(MNEMONIC, 1);

export function makeEvent(
  key: { privateKey: Uint8Array },
  fields: { kind?: number; created_at?: number; tags?: string[][]; content?: string } = {},
): NostrEvent {
  return signEvent(key.privateKey, {
    kind: fields.kind ?? 1,
    created_at: fields.created_at ?? 1_700_000_000,
    tags: fields.tags ?? [],
    content: fields.content ?? "",
  });
}

/** Collects the messages a relay sends to one connection. */
export function capture(): { messages: unknown[][]; send: (raw: string) => void } {
  const messages: unknown[][] = [];
  return { messages, send: (raw) => messages.push(JSON.parse(raw) as unknown[]) };
}
