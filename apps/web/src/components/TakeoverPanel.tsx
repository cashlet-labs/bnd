import { useState } from "react";
import {
  buildBinding,
  buildBindingEventTemplate,
  createBinding,
  createKeySigner,
  createLoginResponse,
  encodeBchAddress,
  historyAfter,
  keyHashFromPublicKey,
  parseChallenge,
  proveBchControl,
  verifyBinding,
  type VerifiedBinding,
} from "@cashlet-labs/bnd";
import {
  publishToRelay as defaultPublishToRelay,
  queryRelay as defaultQueryRelay,
} from "@cashlet-labs/bnd/nostr";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { SITE_RELAYS, SITE_RELAYS_LABEL } from "../relays";
import type { ConnectedNostrSigner } from "../signers/nostr";

export interface TakeoverPanelProps {
  nostr: ConnectedNostrSigner | null;
  binding: VerifiedBinding | null;
  /** Injected in tests. */
  fetchFn?: typeof fetch;
  origin?: string;
  publishToRelay?: typeof defaultPublishToRelay;
  queryRelay?: typeof defaultQueryRelay;
  siteRelays?: readonly string[];
}

interface Layer {
  title: string;
  /** True when this defence held: the attempt was refused. */
  held: boolean;
  /** True when the attempt was not made, and why is in `detail`. */
  skipped?: boolean;
  detail: string;
}

/** A BCH key the "attacker" controls, made up for this demonstration. */
function attackerKey(network: VerifiedBinding["bch"]["network"]) {
  const privateKey = secp256k1.utils.randomSecretKey();
  const keyHash = keyHashFromPublicKey(secp256k1.getPublicKey(privateKey, true));
  return {
    signer: createKeySigner(privateKey),
    keyHash,
    address: encodeBchAddress(keyHash, network),
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Plays an attacker who has stolen the Nostr key and nothing else, and tries
 * to point the identity at their own BCH key. Three independent defences
 * refuse it: the protocol, the relays and the verifier. Nothing is stored:
 * every attempt is refused, and only this site's relays are asked.
 */
export function TakeoverPanel({
  nostr,
  binding,
  fetchFn = (input, init) => fetch(input, init),
  origin = globalThis.location?.origin ?? "",
  publishToRelay = defaultPublishToRelay,
  queryRelay = defaultQueryRelay,
  siteRelays = SITE_RELAYS,
}: TakeoverPanelProps) {
  const [busy, setBusy] = useState(false);
  const [layers, setLayers] = useState<Layer[] | null>(null);
  const [attacker, setAttacker] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ready = nostr !== null && binding !== null && binding.form !== "revocation";

  async function attempt() {
    if (!nostr || !binding) return;
    setBusy(true);
    setError(null);
    setLayers(null);
    try {
      const network = binding.bch.network;
      const thief = attackerKey(network);
      setAttacker(thief.address);
      const result: Layer[] = [];

      // 1. A successor to the attacker's key, approved by the Nostr key only.
      const record = buildBinding({
        nostrPublicKey: binding.nostrPublicKey,
        bchKeyHash: thief.keyHash,
        network,
        createdAt: Math.max(Math.floor(Date.now() / 1000), binding.record.createdAt + 1),
        previous: binding.bindingId,
        ...(binding.record.recovery
          ? { recoveryPublicKey: binding.record.recovery.publicKey }
          : {}),
      });
      const proof = await proveBchControl(thief.signer, record, "message");
      const successor = await nostr.signer.signEvent(
        buildBindingEventTemplate(record, proof, {
          history: historyAfter(binding.event),
          approvals: {},
        }),
      );
      const checked = verifyBinding(successor);
      result.push({
        title: "The protocol: a replacement needs two of your keys",
        held: !checked.ok,
        detail: checked.ok ? "accepted" : checked.reason,
      });

      // 2. A fresh first binding for the same Nostr key. It goes only to this
      // site's relays that already hold the real binding: a relay without it
      // has nothing to protect and would store the fake one for good.
      const fake = await createBinding({
        nostrSigner: nostr.signer,
        bchSigner: thief.signer,
        bchKeyHash: thief.keyHash,
        network,
        proofType: "message",
      });
      const holding: string[] = [];
      for (const url of siteRelays) {
        const answer = await queryRelay(url, [
          { kinds: [30078], authors: [binding.nostrPublicKey], "#d": ["bnd1"], limit: 5 },
        ]);
        if (answer.events.some((event) => event.id === binding.event.id)) holding.push(url);
      }
      if (holding.length === 0) {
        result.push({
          title: `The relays (${SITE_RELAYS_LABEL}): your real binding cannot be overwritten`,
          held: true,
          skipped: true,
          detail: `Publish your binding to ${SITE_RELAYS_LABEL} first, so there is something to protect`,
        });
      } else {
        const answers = await Promise.all(holding.map((url) => publishToRelay(url, fake.event)));
        const accepted = answers.filter((answer) => answer.ok);
        result.push({
          title: `The relays (${SITE_RELAYS_LABEL}): your real binding cannot be overwritten`,
          held: accepted.length === 0,
          detail: answers
            .map((answer) => `${answer.url}: ${answer.message || "accepted"}`)
            .join("; "),
        });
      }

      // 3. Logging in with the fake binding at the verifier.
      const challengeResponse = await fetchFn("/challenge?level=dual");
      const challenge = parseChallenge(await challengeResponse.json());
      const login = await createLoginResponse({
        challenge,
        binding: fake.event,
        nostrSigner: nostr.signer,
        bchSigner: thief.signer,
        proofType: "message",
        expectedOrigin: origin,
      });
      const response = await fetchFn("/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(login),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      result.push({
        title: "The verifier: it logs in only your real, current binding",
        held: !response.ok,
        detail: response.ok ? "logged in" : (body?.error ?? `refused (${response.status})`),
      });

      setLayers(result);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  const allHeld = layers !== null && layers.every((layer) => layer.held);

  return (
    <section aria-labelledby="takeover-title">
      <h2 id="takeover-title">Try a takeover</h2>
      <p>
        Suppose an attacker stole your Nostr key, the one people know you by, but nothing else. They
        want to point your identity at their own BCH address, so payments meant for you go to them.
        This button plays that attacker with your current Nostr key and a made-up BCH key.
      </p>
      <p className="note">
        Nothing is stored: every attempt is refused, it is sent only to {SITE_RELAYS_LABEL}, and
        your real binding is untouched. Your Nostr signer is asked to sign three times.
      </p>
      {!ready && <p className="note">Create and publish a binding first.</p>}
      <button
        type="button"
        className="btn-danger"
        disabled={busy || !ready}
        onClick={() => void attempt()}
      >
        {busy ? "Attacking…" : "Try a takeover"}
      </button>

      {layers && (
        <div role="status">
          {attacker && (
            <p>
              Attacker&apos;s BCH address: <code className="wrap">{attacker}</code>
            </p>
          )}
          <ol className="checks" aria-label="Defences">
            {layers.map((layer) => (
              <li key={layer.title} className={layer.held ? "held" : "failed"}>
                <strong>
                  {layer.skipped ? "Skipped" : layer.held ? "Refused" : "NOT refused"}
                </strong>
                : {layer.title}
                <br />
                <span className="note">{layer.detail}</span>
              </li>
            ))}
          </ol>
          <p className={allHeld ? "verified" : "error"}>
            {allHeld
              ? "With only your Nostr key, the attacker could not move your identity. They would need a second key: your BCH key or your recovery key."
              : "A defence did not hold. Check which relays and verifier this page uses."}
          </p>
        </div>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
