import type { VerifiedBinding } from "@cashlet-labs/bnd";

/**
 * Remembers the newest binding this service accepted for each Nostr key, like
 * SSH's known_hosts (section 9). A later login must use that binding or one
 * that descends from it. This stops a thief who wiped the real binding from
 * the relays this service asks, as long as the service saw it first.
 */
export interface PinStore {
  /** Why `binding` conflicts with a pin, or null when it may be used. */
  conflict(binding: VerifiedBinding): string | null;
  /** Pin `binding` for every Nostr key in its chain. */
  pin(binding: VerifiedBinding): void;
  /** IDs of pinned bindings: verified before, so usable as checkpoints. */
  checkpoints(): ReadonlySet<string>;
}

function chainKeys(binding: VerifiedBinding): string[] {
  return [
    ...new Set([...binding.ancestors, binding.record].map((record) => record.nostr.publicKey)),
  ];
}

/** Pins in memory. They are forgotten on restart; `maxKeys` bounds memory. */
export class MemoryPinStore implements PinStore {
  readonly #pins = new Map<string, string>();
  readonly #counts = new Map<string, number>();
  readonly #maxKeys: number;

  constructor(maxKeys = 100_000) {
    this.#maxKeys = maxKeys;
  }

  get size(): number {
    return this.#pins.size;
  }

  conflict(binding: VerifiedBinding): string | null {
    for (const key of chainKeys(binding)) {
      const pinned = this.#pins.get(key);
      if (pinned === undefined || pinned === binding.bindingId) continue;
      if (!binding.history.includes(pinned)) {
        return "this binding does not continue the one this service accepted before for the same key";
      }
    }
    return null;
  }

  pin(binding: VerifiedBinding): void {
    for (const key of chainKeys(binding)) {
      this.#set(key, binding.bindingId);
    }
  }

  checkpoints(): ReadonlySet<string> {
    return new Set(this.#counts.keys());
  }

  #set(key: string, id: string): void {
    const old = this.#pins.get(key);
    if (old !== undefined) {
      this.#pins.delete(key);
      this.#release(old);
    } else if (this.#pins.size >= this.#maxKeys) {
      const oldest = this.#pins.entries().next().value;
      if (oldest !== undefined) {
        this.#pins.delete(oldest[0]);
        this.#release(oldest[1]);
      }
    }
    this.#pins.set(key, id);
    this.#counts.set(id, (this.#counts.get(id) ?? 0) + 1);
  }

  #release(id: string): void {
    const count = (this.#counts.get(id) ?? 1) - 1;
    if (count <= 0) this.#counts.delete(id);
    else this.#counts.set(id, count);
  }
}
