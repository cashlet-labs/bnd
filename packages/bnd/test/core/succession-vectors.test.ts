import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveIdentity, verifyBinding } from "../../src/core/binding-event.js";
import type { NostrEvent } from "../../src/core/event.js";

interface Vectors {
  valid: {
    name: string;
    event: unknown;
    bindingId: string;
    form: string;
    nostrPublicKey: string;
    history: string[];
    approvedBy: string[];
  }[];
  invalid: { name: string; event: unknown; reason: string }[];
  events: Record<string, NostrEvent>;
  resolution: {
    name: string;
    events: string[];
    key: { nostrPublicKey?: string; bchKeyHash?: string };
    status: string;
    head?: string;
    heads?: string[];
  }[];
}

const vectors = JSON.parse(
  readFileSync(new URL("../../../../spec/vectors/succession.json", import.meta.url), "utf8"),
) as Vectors;

describe("succession vectors", () => {
  for (const vector of vectors.valid) {
    it(`verifies: ${vector.name}`, () => {
      expect(verifyBinding(vector.event)).toMatchObject({
        ok: true,
        bindingId: vector.bindingId,
        form: vector.form,
        nostrPublicKey: vector.nostrPublicKey,
        history: vector.history,
        approvedBy: vector.approvedBy,
      });
    });
  }

  for (const vector of vectors.invalid) {
    it(`rejects: ${vector.name}`, () => {
      expect(verifyBinding(vector.event)).toEqual({ ok: false, reason: vector.reason });
    });
  }

  for (const vector of vectors.resolution) {
    it(`resolves: ${vector.name}`, () => {
      const state = resolveIdentity(
        vector.events.map((id) => vectors.events[id]),
        vector.key,
      );
      expect(state.status).toBe(vector.status);
      if (state.status === "current" || state.status === "revoked") {
        expect(state.binding.bindingId).toBe(vector.head);
      }
      if (state.status === "disputed") {
        expect(state.bindings.map((binding) => binding.bindingId)).toEqual(vector.heads);
      }
    });
  }

  it("covers each form and each takeover attempt", () => {
    expect(new Set(vectors.valid.map((v) => v.form))).toEqual(new Set(["successor", "revocation"]));
    expect(vectors.invalid.length).toBeGreaterThanOrEqual(9);
    expect(new Set(vectors.resolution.map((v) => v.status))).toEqual(
      new Set(["current", "revoked", "disputed"]),
    );
  });
});
