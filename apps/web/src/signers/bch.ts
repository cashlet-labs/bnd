import {
  createKeySigner,
  encodeBchAddress,
  keyHashFromPublicKey,
  type BchNetwork,
  type BchProofType,
  type BchSigner,
} from "@cashlet-labs/bnd-core";
import { secp256k1 } from "@noble/curves/secp256k1.js";

export type BchSignerKind = "wizardconnect" | "test-key";

/** A BCH key the page can get proofs from, and what the page shows about it. */
export interface ConnectedBchSigner {
  kind: BchSignerKind;
  /** Name of the connected wallet, or a description of the local key. */
  label: string;
  keyHash: Uint8Array;
  address: string;
  network: BchNetwork;
  signer: BchSigner;
  /** Proof types this connection can produce. */
  proofTypes: BchProofType[];
  disconnect(): Promise<void>;
}

/**
 * A throwaway BCH key generated in this page, for trying the demo without a
 * wallet. Chipnet only: it holds no funds and is lost when the page reloads.
 */
export function createTestBchSigner(network: BchNetwork): ConnectedBchSigner {
  if (network !== "chipnet") throw new Error("the local test key is only offered on chipnet");
  const privateKey = secp256k1.utils.randomSecretKey();
  const keyHash = keyHashFromPublicKey(secp256k1.getPublicKey(privateKey, true));
  const inner = createKeySigner(privateKey);
  let wiped = false;
  const guard = <T>(sign: () => T): T => {
    if (wiped) throw new Error("this key has been discarded");
    return sign();
  };
  return {
    kind: "test-key",
    label: "local test key",
    keyHash,
    address: encodeBchAddress(keyHash, network),
    network,
    signer: {
      signMessage: (message) => guard(() => inner.signMessage(message)),
      signTransaction: (request) => guard(() => inner.signTransaction(request)),
    },
    proofTypes: ["message", "tx"],
    disconnect: async () => {
      privateKey.fill(0);
      wiped = true;
    },
  };
}
