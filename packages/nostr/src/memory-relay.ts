import { verifyEventSignature, type NostrEvent } from "@cashlet-labs/bnd-core";
import { isFilter, matchesAnyFilter, type Filter } from "./filter.js";

type Send = (message: string) => void;

interface Subscription {
  id: string;
  filters: Filter[];
}

export interface MemoryRelayOptions {
  /** Maximum events returned for one subscription when no limit is given. */
  defaultLimit?: number;
}

function isReplaceable(kind: number): boolean {
  return kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000);
}
function isAddressable(kind: number): boolean {
  return kind >= 30000 && kind < 40000;
}
function isEphemeral(kind: number): boolean {
  return kind >= 20000 && kind < 30000;
}

function replaceKey(event: NostrEvent): string | null {
  if (isReplaceable(event.kind)) return `${event.kind}:${event.pubkey}`;
  if (isAddressable(event.kind)) {
    const d = event.tags.find((tag) => tag[0] === "d")?.[1] ?? "";
    return `${event.kind}:${event.pubkey}:${d}`;
  }
  return null;
}

/** NIP-01 ordering: newer first, and the lower ID wins a tie. */
function newerThan(a: NostrEvent, b: NostrEvent): boolean {
  return a.created_at > b.created_at || (a.created_at === b.created_at && a.id < b.id);
}

/**
 * A small in-memory Nostr relay for tests and local demos. It validates
 * signatures, applies replaceable and addressable event rules, answers
 * subscriptions with stored events and sends new matching events live.
 * It is not a production relay.
 */
export class MemoryRelay {
  private readonly events = new Map<string, NostrEvent>();
  private readonly byKey = new Map<string, string>();
  private readonly sessions = new Set<RelaySession>();
  private readonly defaultLimit: number;

  /** Optional hook: return false to hide a stored event from queries. */
  hideFromQueries: ((event: NostrEvent) => boolean) | undefined;

  constructor(options: MemoryRelayOptions = {}) {
    this.defaultLimit = options.defaultLimit ?? 500;
  }

  /** Open a connection. `send` receives each message the relay sends. */
  connect(send: Send): RelaySession {
    const session = new RelaySession(this, send);
    this.sessions.add(session);
    return session;
  }

  /** Store an event without validation. Tests use it to plant bad data. */
  seed(event: NostrEvent): void {
    this.store(event);
  }

  /** All stored events, newest first. */
  all(): NostrEvent[] {
    return [...this.events.values()].sort((a, b) => (newerThan(a, b) ? -1 : 1));
  }

  /** @internal */
  closeSession(session: RelaySession): void {
    this.sessions.delete(session);
  }

  /** @internal */
  accept(event: NostrEvent): { ok: boolean; message: string } {
    if (this.events.has(event.id))
      return { ok: true, message: "duplicate: already have this event" };
    if (isEphemeral(event.kind)) {
      this.broadcast(event);
      return { ok: true, message: "" };
    }
    const key = replaceKey(event);
    if (key !== null) {
      const currentId = this.byKey.get(key);
      const current = currentId === undefined ? undefined : this.events.get(currentId);
      if (current && !newerThan(event, current)) {
        return { ok: true, message: "duplicate: have a newer version" };
      }
    }
    this.store(event);
    this.broadcast(event);
    return { ok: true, message: "" };
  }

  /** @internal */
  query(filters: Filter[]): NostrEvent[] {
    const limit = Math.min(
      ...filters.map((filter) => filter.limit ?? this.defaultLimit),
      this.defaultLimit,
    );
    return this.all()
      .filter((event) => matchesAnyFilter(filters, event))
      .filter((event) => this.hideFromQueries?.(event) !== true)
      .slice(0, limit);
  }

  private store(event: NostrEvent): void {
    const key = replaceKey(event);
    if (key !== null) {
      const previous = this.byKey.get(key);
      if (previous !== undefined) this.events.delete(previous);
      this.byKey.set(key, event.id);
    }
    this.events.set(event.id, event);
  }

  private broadcast(event: NostrEvent): void {
    for (const session of this.sessions) session.deliver(event);
  }
}

/** One client connection to a MemoryRelay. */
export class RelaySession {
  private readonly subscriptions = new Map<string, Subscription>();

  constructor(
    private readonly relay: MemoryRelay,
    private readonly send: Send,
  ) {}

  /** Handle one message from the client. */
  receive(raw: string): void {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      this.send(JSON.stringify(["NOTICE", "error: invalid JSON"]));
      return;
    }
    if (!Array.isArray(message) || typeof message[0] !== "string") {
      this.send(JSON.stringify(["NOTICE", "error: invalid message"]));
      return;
    }
    switch (message[0]) {
      case "EVENT":
        this.onEvent(message[1]);
        return;
      case "REQ":
        this.onReq(message[1], message.slice(2));
        return;
      case "CLOSE":
        if (typeof message[1] === "string") this.subscriptions.delete(message[1]);
        return;
      default:
        this.send(JSON.stringify(["NOTICE", `error: unknown message type ${message[0]}`]));
    }
  }

  close(): void {
    this.subscriptions.clear();
    this.relay.closeSession(this);
  }

  /** @internal */
  deliver(event: NostrEvent): void {
    for (const subscription of this.subscriptions.values()) {
      if (matchesAnyFilter(subscription.filters, event)) {
        this.send(JSON.stringify(["EVENT", subscription.id, event]));
      }
    }
  }

  private onEvent(value: unknown): void {
    const id =
      value !== null &&
      typeof value === "object" &&
      typeof (value as { id?: unknown }).id === "string"
        ? (value as { id: string }).id
        : "";
    if (!verifyEventSignature(value)) {
      this.send(JSON.stringify(["OK", id, false, "invalid: bad event or signature"]));
      return;
    }
    const result = this.relay.accept(value as NostrEvent);
    this.send(JSON.stringify(["OK", id, result.ok, result.message]));
  }

  private onReq(id: unknown, filters: unknown[]): void {
    if (typeof id !== "string" || id.length === 0 || id.length > 64) {
      this.send(JSON.stringify(["NOTICE", "error: invalid subscription id"]));
      return;
    }
    if (filters.length === 0 || !filters.every(isFilter)) {
      this.send(JSON.stringify(["CLOSED", id, "invalid: bad filter"]));
      return;
    }
    for (const event of this.relay.query(filters)) {
      this.send(JSON.stringify(["EVENT", id, event]));
    }
    this.send(JSON.stringify(["EOSE", id]));
    this.subscriptions.set(id, { id, filters });
  }
}
