import type { AuthChallenge } from "./auth.js";

/**
 * Where an application keeps the challenges it has issued. A challenge is
 * valid until it expires or is used once. Applications that run more than one
 * process need a shared implementation (a database or cache) whose `consume`
 * is atomic. This module provides an in-memory one for a single process.
 */
export interface ChallengeStore {
  /** Remember a newly issued challenge. */
  put(challenge: AuthChallenge): void | Promise<void>;
  /** Return the challenge if it exists and has not expired. Does not use it up. */
  get(nonce: string): AuthChallenge | undefined | Promise<AuthChallenge | undefined>;
  /** Count a failed attempt. The store discards the challenge after too many. */
  fail(nonce: string): void | Promise<void>;
  /** Remove the challenge. True for exactly one caller, even when calls race. */
  consume(nonce: string): boolean | Promise<boolean>;
}

export class ChallengeStoreFullError extends Error {
  constructor() {
    super("too many outstanding challenges");
    this.name = "ChallengeStoreFullError";
  }
}

export interface MemoryChallengeStoreOptions {
  /** Most challenges held at once. Default 10000. */
  maxOutstanding?: number;
  /** Failed attempts allowed per challenge. Default 5. */
  maxAttempts?: number;
  /** Clock in Unix seconds. Tests replace it. */
  now?: () => number;
}

interface Entry {
  challenge: AuthChallenge;
  attempts: number;
}

/** A single-process challenge store. State is lost when the process stops. */
export class MemoryChallengeStore implements ChallengeStore {
  private readonly entries = new Map<string, Entry>();
  private readonly maxOutstanding: number;
  private readonly maxAttempts: number;
  private readonly now: () => number;

  constructor(options: MemoryChallengeStoreOptions = {}) {
    this.maxOutstanding = options.maxOutstanding ?? 10_000;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }

  /** How many challenges are held right now, expired ones removed. */
  get size(): number {
    this.prune();
    return this.entries.size;
  }

  put(challenge: AuthChallenge): void {
    this.prune();
    if (this.entries.size >= this.maxOutstanding) throw new ChallengeStoreFullError();
    this.entries.set(challenge.nonce, { challenge, attempts: 0 });
  }

  get(nonce: string): AuthChallenge | undefined {
    const entry = this.entries.get(nonce);
    if (entry === undefined) return undefined;
    if (this.now() > entry.challenge.expiresAt) {
      this.entries.delete(nonce);
      return undefined;
    }
    return entry.challenge;
  }

  fail(nonce: string): void {
    const entry = this.entries.get(nonce);
    if (entry === undefined) return;
    entry.attempts += 1;
    if (entry.attempts >= this.maxAttempts) this.entries.delete(nonce);
  }

  consume(nonce: string): boolean {
    if (this.get(nonce) === undefined) return false;
    return this.entries.delete(nonce);
  }

  private prune(): void {
    const now = this.now();
    for (const [nonce, entry] of this.entries) {
      if (now > entry.challenge.expiresAt) this.entries.delete(nonce);
    }
  }
}
