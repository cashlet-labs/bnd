// @vitest-environment node
import {
  buildBinding,
  bytesToHex,
  deriveBchKey,
  deriveNostrKey,
  proveBchControl,
  verifyBchProof,
} from "@cashlet-labs/bnd-core";
import { afterEach, describe, expect, it } from "vitest";
import { startDevRelay } from "../../dev-relay/src/server.js";
import { startWizardConnect } from "../src/signers/wizardconnect";
import { createFakeWizardWallet } from "./fake-wizard-wallet";
import { useQuietWebSockets } from "./quiet-websocket";

useQuietWebSockets();

const MNEMONIC = "leader monkey parrot ring guide accident before fence cannon height naive bean";

let cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

async function connect(options: { index?: number; refuseWith?: string } = {}) {
  const relay = await startDevRelay();
  cleanup.push(() => relay.close());
  const wallet = createFakeWizardWallet({
    mnemonic: MNEMONIC,
    ...(options.refuseWith ? { refuseWith: options.refuseWith } : {}),
  });
  cleanup.push(() => wallet.close());
  const session = startWizardConnect({
    network: "chipnet",
    relayUrls: [relay.url],
    ...(options.index === undefined ? {} : { index: options.index }),
  });
  cleanup.push(() => session.cancel());
  expect(session.uri).toMatch(/^wiz:\/\//);
  wallet.connect(session.uri);
  const connected = await session.connected;
  return { wallet, connected };
}

describe("WizardConnect signer", () => {
  it("receives the wallet's receive/0 key and address", async () => {
    const { connected } = await connect();
    const expected = deriveBchKey(MNEMONIC, 0, 0);
    expect(bytesToHex(connected.keyHash)).toBe(bytesToHex(expected.keyHash));
    expect(connected.address).toMatch(/^bchtest:q/);
    expect(connected.walletName).toBe("Test wallet");
    expect(connected.chain).toBe("receive");
    expect(connected.index).toBe(0);
  });

  it("uses another address index when asked", async () => {
    const { connected } = await connect({ index: 3 });
    expect(bytesToHex(connected.keyHash)).toBe(bytesToHex(deriveBchKey(MNEMONIC, 0, 3).keyHash));
  });

  it("gets a transaction proof the verifier accepts", async () => {
    const { connected } = await connect();
    const record = buildBinding({
      nostrPublicKey: deriveNostrKey(MNEMONIC).publicKey,
      bchKeyHash: connected.keyHash,
      network: "chipnet",
      createdAt: 1_700_000_000,
    });
    const proof = await proveBchControl(connected.signer, record, "tx");
    expect(verifyBchProof(record, proof)).toEqual({ ok: true });
  });

  it("asks the wallet not to broadcast and names the key path", async () => {
    const { wallet, connected } = await connect();
    const record = buildBinding({
      nostrPublicKey: deriveNostrKey(MNEMONIC).publicKey,
      bchKeyHash: connected.keyHash,
      network: "chipnet",
      createdAt: 1_700_000_000,
    });
    await proveBchControl(connected.signer, record, "tx");
    const request = wallet.requests[0] as {
      transaction: { broadcast: boolean; userPrompt: string; sourceOutputs: unknown[] };
      inputPaths: unknown[];
    };
    expect(request.transaction.broadcast).toBe(false);
    expect(request.transaction.userPrompt).toMatch(/Nothing is sent/);
    expect(request.transaction.sourceOutputs).toHaveLength(1);
    expect(request.inputPaths).toEqual([[0, "receive", 0]]);
  });

  it("cannot sign messages", async () => {
    const { connected } = await connect();
    expect(connected.signer.signMessage).toBeUndefined();
  });

  it("reports a refusal from the wallet", async () => {
    const { connected } = await connect({ refuseWith: "User rejected" });
    const record = buildBinding({
      nostrPublicKey: deriveNostrKey(MNEMONIC).publicKey,
      bchKeyHash: connected.keyHash,
      network: "chipnet",
      createdAt: 1_700_000_000,
    });
    await expect(proveBchControl(connected.signer, record, "tx")).rejects.toThrow(/User rejected/);
  });

  it("refuses to sign after disconnecting", async () => {
    const { connected } = await connect();
    await connected.disconnect();
    const record = buildBinding({
      nostrPublicKey: deriveNostrKey(MNEMONIC).publicKey,
      bchKeyHash: connected.keyHash,
      network: "chipnet",
      createdAt: 1_700_000_000,
    });
    await expect(proveBchControl(connected.signer, record, "tx")).rejects.toThrow("disconnected");
  });

  it("rejects an invalid address index", () => {
    expect(() => startWizardConnect({ network: "chipnet", index: -1, relayUrls: [] })).toThrow(
      RangeError,
    );
  });
});
