import type { AuthIdentity, AuthLevel, BchProofType } from "@cashlet-labs/bnd-core";

export interface Session {
  identity: AuthIdentity;
  level: AuthLevel;
  bchProofType?: BchProofType;
  /** Unix seconds. */
  createdAt: number;
  /** Unix seconds of the last request that used the session. */
  lastSeenAt: number;
}

/**
 * Where sessions live. Applications with more than one process supply a
 * shared implementation. Tokens are random and never derived from identity.
 */
export interface SessionStore {
  create(session: Session): string | Promise<string>;
  /** Return the session and record use, or undefined if it has ended. */
  use(token: string, now: number): Session | undefined | Promise<Session | undefined>;
  delete(token: string): void | Promise<void>;
}

export interface MemorySessionStoreOptions {
  /** End a session after this many seconds without use. Default 1800. */
  idleSeconds?: number;
  /** End a session this many seconds after login, whatever its use. Default 28800. */
  absoluteSeconds?: number;
  /** Most sessions held at once; the oldest are dropped. Default 10000. */
  maxSessions?: number;
}

const TOKEN = /^[0-9a-f]{64}$/;

/** A single-process session store. Sessions are lost when the process stops. */
export class MemorySessionStore implements SessionStore {
  readonly idleSeconds: number;
  readonly absoluteSeconds: number;
  private readonly maxSessions: number;
  private readonly sessions = new Map<string, Session>();

  constructor(options: MemorySessionStoreOptions = {}) {
    this.idleSeconds = options.idleSeconds ?? 1800;
    this.absoluteSeconds = options.absoluteSeconds ?? 28_800;
    this.maxSessions = options.maxSessions ?? 10_000;
  }

  create(session: Session): string {
    while (this.sessions.size >= this.maxSessions) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) break;
      this.sessions.delete(oldest);
    }
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    this.sessions.set(token, { ...session });
    return token;
  }

  use(token: string, now: number): Session | undefined {
    if (!TOKEN.test(token)) return undefined;
    const session = this.sessions.get(token);
    if (session === undefined) return undefined;
    if (
      now - session.lastSeenAt > this.idleSeconds ||
      now - session.createdAt > this.absoluteSeconds
    ) {
      this.sessions.delete(token);
      return undefined;
    }
    session.lastSeenAt = now;
    return { ...session };
  }

  delete(token: string): void {
    this.sessions.delete(token);
  }
}
