import { signTxProofRequest, type TxProofRequest } from "@cashlet-labs/bnd";
import { decodeTransaction, hexToBin } from "@bitauth/libauth";
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import { toBigInt, toUint8Array } from "@wizardconnect/core";
import { DerivationPath, WalletConnectionManager } from "@wizardconnect/wallet";

export interface FakeWizardWalletOptions {
  mnemonic: string;
  /** Refuse every signing request with this message. */
  refuseWith?: string;
}

/**
 * A minimal WizardConnect wallet for tests: BIP44 BCH keys from a mnemonic,
 * the real wallet-side protocol, and an automatic "approve" for each request.
 */
export function createFakeWizardWallet(options: FakeWizardWalletOptions) {
  const account = HDKey.fromMasterSeed(mnemonicToSeedSync(options.mnemonic)).derive(
    "m/44'/145'/0'",
  );
  const chain = (path: DerivationPath) => account.deriveChild(path);
  const requests: unknown[] = [];

  const manager = new WalletConnectionManager({
    walletName: "Test wallet",
    walletIcon: "",
    getRelayPrivateKey: (uri) => {
      const bytes = new TextEncoder().encode(`relay:${uri}`);
      const key = new Uint8Array(32);
      for (let i = 0; i < bytes.length; i++) key[i % 32] = (key[i % 32]! * 31 + bytes[i]!) & 0xff;
      key[0] = key[0]! | 1;
      return key;
    },
    getPublicKey: (path, index) => chain(path).deriveChild(Number(index)).publicKey!,
    getXpub: (path) => chain(path).publicExtendedKey,
    signTransaction: async () => {
      throw new Error("not used: requests are answered through sendSignResponse");
    },
  });

  manager.on("pendingSignRequest", ({ connectionId, request }) => {
    requests.push(request);
    void (async () => {
      if (options.refuseWith) {
        await manager.sendSignError(connectionId, request.sequence, options.refuseWith);
        return;
      }
      const wire = request.transaction as unknown as {
        transaction: string;
        sourceOutputs: { lockingBytecode: string; valueSatoshis: string }[];
        userPrompt?: string;
      };
      const transaction = decodeTransaction(hexToBin(wire.transaction));
      if (typeof transaction === "string") throw new Error(transaction);
      const source = wire.sourceOutputs[0]!;
      const proofRequest: TxProofRequest = {
        transaction,
        sourceOutput: {
          lockingBytecode: toUint8Array(source.lockingBytecode),
          valueSatoshis: toBigInt(source.valueSatoshis),
        },
        transactionHex: wire.transaction,
        userPrompt: wire.userPrompt ?? "",
      };
      const [, path, index] = request.inputPaths[0]!;
      const childPath = path === "change" ? DerivationPath.Change : DerivationPath.Receive;
      const privateKey = chain(childPath).deriveChild(index).privateKey!;
      await manager.sendSignResponse(
        connectionId,
        request.sequence,
        signTxProofRequest(privateKey, proofRequest),
      );
    })();
  });

  return {
    requests,
    publicKey: (index = 0) => chain(DerivationPath.Receive).deriveChild(index).publicKey!,
    connect: (uri: string) => manager.connect(uri),
    close: () => manager.disconnectAll(),
  };
}
