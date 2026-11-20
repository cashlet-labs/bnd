import {
  bytesToHex,
  encodeBchAddress,
  keyHashFromPublicKey,
  type BchNetwork,
  type BchSigner,
  type TxProofRequest,
} from "@cashlet-labs/bnd";
import {
  initiateDappRelay,
  type DappRelayResult,
  type WalletReadyMessage,
} from "@wizardconnect/core";
import { DappConnectionManager } from "@wizardconnect/dapp";

/** WizardConnect names for the wallet's receive and change chains (BIP44 child 0 and 1). */
const CHAIN = { receive: 0, change: 1 } as const;
export type WalletChain = keyof typeof CHAIN;

export interface WizardConnectWallet {
  walletName: string;
  /** The wallet's public key for the chosen address. */
  publicKey: Uint8Array;
  keyHash: Uint8Array;
  /** The address as shown for the demo's network. */
  address: string;
  chain: WalletChain;
  index: number;
  /** Signs proof transactions. Never asks the wallet to broadcast. */
  signer: BchSigner;
  disconnect(): Promise<void>;
}

export interface WizardConnectSession {
  /** The `wiz://` link the wallet scans or pastes. */
  uri: string;
  /** Resolves once the wallet has connected and shared its public keys. */
  connected: Promise<WizardConnectWallet>;
  cancel(): Promise<void>;
}

export interface WizardConnectOptions {
  network: BchNetwork;
  /** Which address of the wallet to bind. Default receive/0. */
  chain?: WalletChain;
  index?: number;
  /** Name the wallet shows for this app. */
  appName?: string;
  /** Relays for the WizardConnect handshake. Defaults to the protocol's own relays. */
  relayUrls?: string[];
}

/** Encode values the way the WizardConnect relay expects: hex bytes, tagged bigints. */
function wireSourceOutput(request: TxProofRequest) {
  const input = request.transaction.inputs[0];
  if (request.transaction.inputs.length !== 1 || input === undefined) {
    throw new Error("a proof request has exactly one input");
  }
  return {
    outpointTransactionHash: bytesToHex(input.outpointTransactionHash),
    outpointIndex: input.outpointIndex,
    sequenceNumber: input.sequenceNumber,
    unlockingBytecode: bytesToHex(input.unlockingBytecode),
    lockingBytecode: bytesToHex(request.sourceOutput.lockingBytecode),
    valueSatoshis: `<bigint: ${request.sourceOutput.valueSatoshis}n>`,
  };
}

/**
 * Start a WizardConnect session. The wallet shares extended public keys for its
 * address chains; the demo picks one address and asks the wallet to sign proof
 * transactions for it. Every request carries `broadcast: false`.
 */
export function startWizardConnect(options: WizardConnectOptions): WizardConnectSession {
  const chain = options.chain ?? "receive";
  const index = options.index ?? 0;
  if (!Number.isInteger(index) || index < 0 || index >= 0x80000000) {
    throw new RangeError("address index must be a non-negative integer");
  }
  const manager = new DappConnectionManager(options.appName ?? "BND identity demo", undefined, {
    session: false,
  });
  let relay: DappRelayResult | undefined;
  relay = initiateDappRelay(
    (payload) => manager.updateConnection(payload.client, payload.status),
    options.relayUrls ? { explicitRelayUrls: options.relayUrls } : {},
  );
  manager.attachRelay(relay);

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    try {
      await manager.sendDisconnect("done");
    } catch {
      // The wallet may already be gone.
    }
    await manager.destroy();
    relay?.cleanup();
    relay = undefined;
  };

  const connected = new Promise<WizardConnectWallet>((resolve, reject) => {
    // Some wallets introduce themselves before the user approves, without keys.
    // Wait for a wallet_ready that shares at least one path.
    const onReady = (message: WalletReadyMessage): void => {
      const paths = (message.session as { hdwalletv1?: { paths?: unknown[] } }).hdwalletv1?.paths;
      if (!Array.isArray(paths) || paths.length === 0) return;
      manager.off("walletready", onReady);
      const publicKey = manager.getPubkey(CHAIN[chain], BigInt(index));
      if (publicKey === undefined) {
        reject(new Error(`the wallet did not share its ${chain} addresses`));
        void close();
        return;
      }
      const keyHash = keyHashFromPublicKey(publicKey);
      const signer: BchSigner = {
        signTransaction: async (request: TxProofRequest) => {
          if (closed) throw new Error("the wallet is disconnected");
          const response = await manager.signTransaction({
            transaction: {
              transaction: request.transactionHex,
              sourceOutputs: [wireSourceOutput(request)],
              userPrompt: request.userPrompt,
              broadcast: false,
            } as never,
            inputPaths: [[0, chain, index]],
          });
          if (response.error) throw new Error(`the wallet refused: ${response.error}`);
          if (typeof response.signedTransaction !== "string") {
            throw new Error("the wallet returned no signed transaction");
          }
          return response.signedTransaction;
        },
      };
      resolve({
        walletName: message.wallet_name || "wallet",
        publicKey,
        keyHash,
        address: encodeBchAddress(keyHash, options.network),
        chain,
        index,
        signer,
        disconnect: close,
      });
    };
    manager.on("walletready", onReady);
    manager.on("disconnect", (_reason, text) => {
      if (!closed) reject(new Error(`the wallet disconnected${text ? `: ${text}` : ""}`));
    });
  });

  return { uri: relay.uri, connected, cancel: close };
}
