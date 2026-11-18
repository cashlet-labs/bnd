import { describe, expect, it } from "vitest";
import { isFilter, matchesAnyFilter, matchesFilter } from "../src/filter.js";
import { alice, bob, makeEvent } from "./helpers.js";

const event = makeEvent(alice, {
  kind: 30078,
  created_at: 1000,
  tags: [
    ["d", "bnd1"],
    ["b", "ab".repeat(20)],
  ],
});

describe("matchesFilter", () => {
  it("matches an empty filter", () => {
    expect(matchesFilter({}, event)).toBe(true);
  });

  it("matches by id, author and kind", () => {
    expect(matchesFilter({ ids: [event.id] }, event)).toBe(true);
    expect(matchesFilter({ ids: ["00".repeat(32)] }, event)).toBe(false);
    expect(matchesFilter({ authors: [alice.publicKey] }, event)).toBe(true);
    expect(matchesFilter({ authors: [bob.publicKey] }, event)).toBe(false);
    expect(matchesFilter({ kinds: [30078, 1] }, event)).toBe(true);
    expect(matchesFilter({ kinds: [1] }, event)).toBe(false);
  });

  it("matches the time window inclusively", () => {
    expect(matchesFilter({ since: 1000, until: 1000 }, event)).toBe(true);
    expect(matchesFilter({ since: 1001 }, event)).toBe(false);
    expect(matchesFilter({ until: 999 }, event)).toBe(false);
  });

  it("matches tag filters on any listed value", () => {
    expect(matchesFilter({ "#d": ["bnd1"] }, event)).toBe(true);
    expect(matchesFilter({ "#d": ["other", "bnd1"] }, event)).toBe(true);
    expect(matchesFilter({ "#d": ["other"] }, event)).toBe(false);
    expect(matchesFilter({ "#b": ["ab".repeat(20)] }, event)).toBe(true);
    expect(matchesFilter({ "#t": ["x"] }, event)).toBe(false);
  });

  it("requires every condition", () => {
    expect(matchesFilter({ kinds: [30078], "#d": ["bnd1"], authors: [bob.publicKey] }, event)).toBe(
      false,
    );
  });

  it("matches when any filter matches", () => {
    expect(matchesAnyFilter([{ kinds: [1] }, { kinds: [30078] }], event)).toBe(true);
    expect(matchesAnyFilter([{ kinds: [1] }], event)).toBe(false);
    expect(matchesAnyFilter([], event)).toBe(false);
  });
});

describe("isFilter", () => {
  it("accepts well-formed filters", () => {
    expect(isFilter({})).toBe(true);
    expect(isFilter({ kinds: [1], authors: ["a"], "#d": ["x"], limit: 5, since: 0 })).toBe(true);
  });

  it.each([
    ["null", null],
    ["an array", []],
    ["kinds with a string", { kinds: ["1"] }],
    ["authors that is not an array", { authors: "a" }],
    ["a negative limit", { limit: -1 }],
    ["a fractional since", { since: 1.5 }],
    ["a tag filter with numbers", { "#d": [1] }],
  ])("rejects %s", (_name, value) => {
    expect(isFilter(value)).toBe(false);
  });
});
