import type { NostrEvent } from "@cashlet-labs/bnd-core";

/** A NIP-01 subscription filter. Tag filters use a `#` and one letter. */
export interface Filter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  [tag: `#${string}`]: string[] | undefined;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** Check that untrusted input has the shape of a filter. */
export function isFilter(value: unknown): value is Filter {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  for (const [key, member] of Object.entries(value)) {
    if (key === "ids" || key === "authors") {
      if (!isStringArray(member)) return false;
    } else if (key === "kinds") {
      if (!Array.isArray(member) || !member.every((kind) => Number.isSafeInteger(kind)))
        return false;
    } else if (key === "since" || key === "until" || key === "limit") {
      if (!Number.isSafeInteger(member) || (member as number) < 0) return false;
    } else if (/^#[a-zA-Z]$/.test(key)) {
      if (!isStringArray(member)) return false;
    }
    // Unknown members are ignored, as relays do.
  }
  return true;
}

/** True when the event satisfies every condition in the filter. */
export function matchesFilter(filter: Filter, event: NostrEvent): boolean {
  if (filter.ids && !filter.ids.includes(event.id)) return false;
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.since !== undefined && event.created_at < filter.since) return false;
  if (filter.until !== undefined && event.created_at > filter.until) return false;
  for (const [key, wanted] of Object.entries(filter)) {
    if (!/^#[a-zA-Z]$/.test(key)) continue;
    const name = key.slice(1);
    const values = event.tags.filter((tag) => tag[0] === name).map((tag) => tag[1]);
    if (!(wanted as string[]).some((value) => values.includes(value))) return false;
  }
  return true;
}

/** True when the event satisfies at least one filter. */
export function matchesAnyFilter(filters: readonly Filter[], event: NostrEvent): boolean {
  return filters.some((filter) => matchesFilter(filter, event));
}
