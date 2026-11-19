import { useState } from "react";
import {
  createLoginResponse,
  parseChallenge,
  type AuthLevel,
  type BchProofType,
  type VerifiedBinding,
} from "@cashlet-labs/bnd-core";
import type { ConnectedBchSigner } from "../signers/bch";
import type { ConnectedNostrSigner } from "../signers/nostr";

export interface LoginPanelProps {
  nostr: ConnectedNostrSigner | null;
  bch: ConnectedBchSigner | null;
  binding: VerifiedBinding | null;
  /** Injected in tests. Defaults to the page's own origin. */
  fetchFn?: typeof fetch;
  origin?: string;
}

interface SessionView {
  identity: { npub: string; bch: { address: string }; bindingId: string };
  level: AuthLevel;
  bchProofType?: BchProofType;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorOf(body: unknown, status: number): string {
  const text = (body as { error?: unknown } | null)?.error;
  return typeof text === "string" ? text : `the server answered ${status}`;
}

/** Logs in to the demonstration verifier with the binding just created. */
export function LoginPanel({
  nostr,
  bch,
  binding,
  fetchFn = (input, init) => fetch(input, init),
  origin = globalThis.location?.origin ?? "",
}: LoginPanelProps) {
  const [level, setLevel] = useState<AuthLevel>("dual");
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<SessionView | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const proofType: BchProofType | undefined = bch?.proofTypes[0];
  const ready = nostr !== null && binding !== null && (level === "nostr" || bch !== null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const login = () =>
    run(async () => {
      if (!nostr || !binding) return;
      const challengeResponse = await fetchFn(`/challenge?level=${level}`);
      const challengeBody = await readJson(challengeResponse);
      if (!challengeResponse.ok) throw new Error(errorOf(challengeBody, challengeResponse.status));
      const challenge = parseChallenge(challengeBody);
      const body = await createLoginResponse({
        challenge,
        binding: binding.event,
        nostrSigner: nostr.signer,
        ...(level === "dual" && bch && proofType ? { bchSigner: bch.signer, proofType } : {}),
        expectedOrigin: origin,
      });
      const response = await fetchFn("/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await readJson(response);
      if (!response.ok) throw new Error(errorOf(result, response.status));
      setSession(result as SessionView);
    });

  const check = (requireDual: boolean) =>
    run(async () => {
      const response = await fetchFn(requireDual ? "/me?require=dual" : "/me");
      const body = await readJson(response);
      if (!response.ok) throw new Error(errorOf(body, response.status));
      setStatus(
        requireDual
          ? "Allowed: this session proved both keys."
          : `Still logged in at level ${(body as SessionView).level}.`,
      );
    });

  const logout = () =>
    run(async () => {
      await fetchFn("/logout", { method: "POST" });
      setSession(null);
      setStatus("Logged out.");
    });

  return (
    <section aria-labelledby="login-title">
      <h2 id="login-title">5. Log in to an application</h2>
      <p>
        The demo verifier issues a one-time challenge. It checks your signatures itself and asks
        relays only whether this binding is your current one.
      </p>
      {!binding && <p className="note">Create and publish a binding first.</p>}

      {binding && !session && (
        <>
          <fieldset disabled={busy}>
            <legend>Keys to prove</legend>
            <label>
              <input
                type="radio"
                name="login-level"
                value="dual"
                checked={level === "dual"}
                onChange={() => setLevel("dual")}
              />{" "}
              Both keys (Nostr and BCH)
            </label>
            <label>
              <input
                type="radio"
                name="login-level"
                value="nostr"
                checked={level === "nostr"}
                onChange={() => setLevel("nostr")}
              />{" "}
              Nostr key only
            </label>
          </fieldset>
          {level === "dual" && !bch && (
            <p className="note">Connect the BCH key from step 2 to prove both keys.</p>
          )}
          <button type="button" disabled={busy || !ready} onClick={() => void login()}>
            {busy ? "Signing in…" : "Log in"}
          </button>
        </>
      )}

      {session && (
        <>
          <dl className="facts verified">
            <dt>Logged in as</dt>
            <dd>
              <code className="wrap">{session.identity.npub}</code>
            </dd>
            <dt>BCH address</dt>
            <dd>
              <code className="wrap">{session.identity.bch.address}</code>
            </dd>
            <dt>Level</dt>
            <dd>
              {session.level === "dual" ? "both keys" : "Nostr key only"}
              {session.bchProofType
                ? ` (${session.bchProofType === "tx" ? "transaction" : "message"} proof)`
                : ""}
            </dd>
          </dl>
          <div className="actions">
            <button type="button" disabled={busy} onClick={() => void check(false)}>
              Check session
            </button>
            <button type="button" disabled={busy} onClick={() => void check(true)}>
              Try an action that needs both keys
            </button>
            <button type="button" disabled={busy} onClick={() => void logout()}>
              Log out
            </button>
          </div>
        </>
      )}

      {status && <p role="status">{status}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
