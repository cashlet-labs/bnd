import { createBinding, verifyBinding, type VerifiedBinding } from "@cashlet-labs/bnd-core";
import type { PublishSummary } from "@cashlet-labs/bnd-nostr";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IdentityPanel } from "../src/components/IdentityPanel";
import { createTestBchSigner, type ConnectedBchSigner } from "../src/signers/bch";
import { createMemorySigner, type ConnectedNostrSigner } from "../src/signers/nostr";
import { createRecoveryKey, type RecoveryKey } from "../src/signers/recovery";
import { changeIdentity, type IdentityResult } from "../src/state/identity-actions";

afterEach(cleanup);

async function identity(withRecovery = false) {
  const nostr = createMemorySigner();
  const bch = createTestBchSigner("chipnet");
  const recovery = withRecovery ? createRecoveryKey() : null;
  const binding = await createBinding({
    nostrSigner: nostr.signer,
    bchSigner: bch.signer,
    bchKeyHash: bch.keyHash,
    network: "chipnet",
    proofType: "message",
    createdAt: Math.floor(Date.now() / 1000) - 100,
    ...(recovery ? { recoveryPublicKey: recovery.publicKey } : {}),
  });
  return { nostr, bch, recovery, binding };
}

describe("changeIdentity", () => {
  it("rotates the BCH key, approved by the Nostr key and the old BCH key", async () => {
    const { nostr, bch, binding } = await identity();
    const newBch = createTestBchSigner("chipnet");
    const result = await changeIdentity("rotate-bch", {
      binding,
      nostr,
      bch,
      recovery: null,
      newBch,
    });
    expect(result.bch).toBe(newBch);
    expect(result.binding).toMatchObject({
      approvedBy: ["nostr", "bch"],
      history: [binding.bindingId],
    });
    expect(result.binding.bch.address).toBe(newBch.address);
  });

  it("rotates the Nostr key, approved by the old Nostr key and the BCH key", async () => {
    const { nostr, bch, binding } = await identity();
    const newNostr = createMemorySigner();
    const result = await changeIdentity("rotate-nostr", {
      binding,
      nostr,
      bch,
      recovery: null,
      newNostr,
    });
    expect(result.nostr).toBe(newNostr);
    expect(result.binding.nostrPublicKey).toBe(newNostr.publicKey);
    expect(result.binding.approvedBy).toEqual(["nostr", "bch"]);
  });

  it("recovers from a lost Nostr key with the BCH key and the recovery key", async () => {
    const { nostr, bch, recovery, binding } = await identity(true);
    const newNostr = createMemorySigner();
    const result = await changeIdentity("recover-nostr", {
      binding,
      nostr,
      bch,
      recovery,
      newNostr,
    });
    expect(result.binding.approvedBy).toEqual(["bch", "recovery"]);
    // The recovery key stays in the new binding.
    expect(result.binding.record.recovery?.publicKey).toBe(recovery!.publicKey);
  });

  it("recovers from a lost BCH key with the Nostr key and the recovery key", async () => {
    const { nostr, bch, recovery, binding } = await identity(true);
    const result = await changeIdentity("recover-bch", {
      binding,
      nostr,
      bch,
      recovery,
      newBch: createTestBchSigner("chipnet"),
    });
    expect(result.binding.approvedBy).toEqual(["nostr", "recovery"]);
  });

  it("revokes with the BCH key or with the recovery key", async () => {
    const { nostr, bch, recovery, binding } = await identity(true);
    const byBch = await changeIdentity("revoke", { binding, nostr, bch, recovery });
    expect(byBch.binding).toMatchObject({ form: "revocation", approvedBy: ["nostr", "bch"] });
    const byRecovery = await changeIdentity("revoke", {
      binding,
      nostr,
      bch,
      recovery,
      revokeWith: "recovery",
    });
    expect(byRecovery.binding.approvedBy).toEqual(["nostr", "recovery"]);
  });

  it("refuses a recovery without the recovery key, or with the wrong one", async () => {
    const { nostr, bch, binding } = await identity(true);
    const newNostr = createMemorySigner();
    await expect(
      changeIdentity("recover-nostr", { binding, nostr, bch, recovery: null, newNostr }),
    ).rejects.toThrow("enter the recovery key's nsec first");
    await expect(
      changeIdentity("recover-nostr", {
        binding,
        nostr,
        bch,
        recovery: createRecoveryKey(),
        newNostr,
      }),
    ).rejects.toThrow("that is not this binding's recovery key");
    const plain = await identity(false);
    await expect(
      changeIdentity("recover-bch", {
        ...plain,
        recovery: createRecoveryKey(),
        newBch: createTestBchSigner("chipnet"),
      }),
    ).rejects.toThrow("this binding has no recovery key");
  });

  it("needs the new key for a rotation", async () => {
    const { nostr, bch, binding } = await identity();
    await expect(
      changeIdentity("rotate-bch", { binding, nostr, bch, recovery: null }),
    ).rejects.toThrow("choose the new BCH key");
    await expect(
      changeIdentity("rotate-nostr", { binding, nostr, bch, recovery: null }),
    ).rejects.toThrow("choose the new Nostr key");
  });
});

describe("IdentityPanel", () => {
  function setup(
    start: { nostr: ConnectedNostrSigner; bch: ConnectedBchSigner; binding: VerifiedBinding },
    recovery: RecoveryKey | null = null,
  ) {
    const onChange = vi.fn<(result: IdentityResult) => void>();
    const publish = vi.fn(async (_event: unknown, _options?: unknown): Promise<PublishSummary> => ({
      ok: true,
      accepted: ["ws://relay.test"],
      failed: [],
    }));
    render(
      <IdentityPanel
        nostr={start.nostr}
        bch={start.bch}
        binding={start.binding}
        recovery={recovery}
        relays={["ws://relay.test"]}
        onChange={onChange}
        publishBinding={publish}
      />,
    );
    return { onChange, publish };
  }

  it("rotates the BCH key to a new test key and publishes the successor", async () => {
    const start = await identity();
    const { onChange, publish } = setup(start);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Use a new test key" }));
    await user.click(screen.getByRole("button", { name: "Rotate the BCH key" }));
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Replaced and published to 1 of 1 relays.");
    expect(status.textContent).toContain("Nostr key and BCH key");
    const result = onChange.mock.calls[0]![0];
    expect(verifyBinding(result.binding.event).ok).toBe(true);
    expect(publish.mock.calls[0]![0]).toEqual(result.binding.event);
  });

  it("offers recovery only when the binding names a recovery key", async () => {
    setup(await identity(false));
    const option = screen.getByRole("radio", {
      name: /Recover from a lost Nostr key/,
    }) as HTMLInputElement;
    expect(option.disabled).toBe(true);
    expect(option.parentElement?.textContent).toContain("needs a recovery key in the binding");
  });

  it("recovers a lost Nostr key with the recovery key's nsec pasted back", async () => {
    const start = await identity(true);
    // A fresh tab: the page knows the recovery key's public key but not its secret.
    const { onChange } = setup(start, {
      publicKey: start.recovery!.publicKey,
      npub: start.recovery!.npub,
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "Recover from a lost Nostr key" }));
    await user.click(screen.getByRole("button", { name: "Create a new key" }));
    const recover = screen.getByRole("button", {
      name: "Recover with the recovery key",
    }) as HTMLButtonElement;
    expect(recover.disabled).toBe(true);
    await user.type(screen.getByLabelText(/Recovery key nsec/), start.recovery!.nsec);
    await user.click(recover);
    await screen.findByRole("status");
    expect(onChange.mock.calls[0]![0].binding.approvedBy).toEqual(["bch", "recovery"]);
  });

  it("does not switch keys when no relay accepts the change", async () => {
    const start = await identity();
    const onChange = vi.fn();
    render(
      <IdentityPanel
        nostr={start.nostr}
        bch={start.bch}
        binding={start.binding}
        recovery={null}
        relays={["ws://relay.test"]}
        onChange={onChange}
        publishBinding={async () => ({
          ok: false,
          accepted: [],
          failed: [{ url: "ws://relay.test", ok: false, message: "blocked: nope" }],
        })}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Use a new test key" }));
    await user.click(screen.getByRole("button", { name: "Rotate the BCH key" }));
    expect((await screen.findByRole("alert")).textContent).toContain("blocked: nope");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("says a revoked identity cannot change", async () => {
    const start = await identity();
    const revoked = await changeIdentity("revoke", { ...start, recovery: null });
    setup({ ...start, binding: revoked.binding });
    expect(
      screen.getByText("This identity is revoked. Nothing can follow a revocation."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();
  });
});
