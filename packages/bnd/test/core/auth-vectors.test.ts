import { readFileSync } from "node:fs";
import { sha256 } from "@noble/hashes/sha2.js";
import { describe, expect, it } from "vitest";
import {
  authStatement,
  checkLoginResponse,
  type AuthChallenge,
  type LoginResponse,
} from "../../src/core/auth.js";
import { verifyBinding } from "../../src/core/binding-event.js";
import { bytesToHex } from "../../src/core/bytes.js";

interface Case {
  name: string;
  challenge: AuthChallenge;
  verifyAt: number;
  response: LoginResponse;
  statementText?: string;
  statementDigest?: string;
  reason?: string;
  reasonStartsWith?: string;
}

const vectors = JSON.parse(
  readFileSync(new URL("../../../../spec/vectors/auth.json", import.meta.url), "utf8"),
) as { valid: Case[]; invalid: Case[] };

describe("login vectors", () => {
  for (const vector of vectors.valid) {
    it(`accepts: ${vector.name}`, () => {
      expect(checkLoginResponse(vector.challenge, vector.response, vector.verifyAt).ok).toBe(true);
    });

    it(`rebuilds the statement: ${vector.name}`, () => {
      const binding = verifyBinding(vector.response.binding);
      if (!binding.ok) throw new Error(binding.reason);
      const statement = authStatement(vector.challenge, binding.record);
      expect(statement.text).toBe(vector.statementText);
      expect(statement.digest).toBe(vector.statementDigest);
      expect(bytesToHex(sha256(new TextEncoder().encode(statement.text)))).toBe(
        vector.statementDigest,
      );
    });
  }

  for (const vector of vectors.invalid) {
    it(`rejects: ${vector.name}`, () => {
      const result = checkLoginResponse(vector.challenge, vector.response, vector.verifyAt);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      if (vector.reason) expect(result.reason).toBe(vector.reason);
      if (vector.reasonStartsWith)
        expect(result.reason.startsWith(vector.reasonStartsWith)).toBe(true);
    });
  }
});
