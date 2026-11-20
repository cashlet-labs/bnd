import {
  createBinding,
  npubEncode,
  type CreateBindingOptions,
  type VerifiedBinding,
} from "@cashlet-labs/bnd";
import type { PublishSummary } from "@cashlet-labs/bnd/nostr";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { decode } from "nostr-tools/nip19";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BindingPanel } from "../src/components/BindingPanel";
import { createTestBchSigner } from "../src/signers/bch";
import { createMemorySigner } from "../src/signers/nostr";
import {
  createRecoveryKey,
  recoveryKeyFromNpub,
  recoveryKeyFromNsec,
  type RecoveryKey,
} from "../src/signers/recovery";

afterEach(cleanup);

describe("recovery keys", () => {
  it("creates a key whose nsec, npub and signer agree", async () => {
    const key = createRecoveryKey();
    expect(key.npub).toBe(npubEncode(key.publicKey));
    expect(decode(key.nsec).type).toBe("nsec");
    expect(await key.signer.getPublicKey()).toBe(key.publicKey);
    expect(recoveryKeyFromNsec(key.nsec).publicKey).toBe(key.publicKey);
  });

  it("reads a recovery key kept elsewhere from its npub, without a signer", () => {
    const key = createRecoveryKey();
    const own = recoveryKeyFromNpub(`  ${key.npub} `);
    expect(own).toEqual({ publicKey: key.publicKey, npub: key.npub });
  });

  it("refuses the wrong kind of input", () => {
    const key = createRecoveryKey();
    expect(() => recoveryKeyFromNpub(key.nsec)).toThrow("enter the recovery key's npub");
    expect(() => recoveryKeyFromNpub("npub1nope")).toThrow();
    expect(() => recoveryKeyFromNsec(key.npub)).toThrow("enter the recovery key's nsec");
    expect(() => recoveryKeyFromNsec("garbage")).toThrow("enter the recovery key's nsec");
  });
});

describe("BindingPanel with a recovery key", () => {
  function Harness(props: {
    create: (options: CreateBindingOptions) => Promise<VerifiedBinding>;
    onRecovery: (key: RecoveryKey | null) => void;
  }) {
    const [nostr] = useState(createMemorySigner);
    const [bch] = useState(() => createTestBchSigner("chipnet"));
    const [binding, setBinding] = useState<VerifiedBinding | null>(null);
    const [recovery, setRecovery] = useState<RecoveryKey | null>(null);
    return (
      <BindingPanel
        nostr={nostr}
        bch={bch}
        relays={["ws://relay.test"]}
        binding={binding}
        recovery={recovery}
        onBinding={(next, key) => {
          setBinding(next);
          setRecovery(key);
          props.onRecovery(key);
        }}
        createBinding={props.create}
        publishBinding={async (): Promise<PublishSummary> => ({
          ok: true,
          accepted: [],
          failed: [],
        })}
      />
    );
  }

  it("shows a created key once and binds only after the user confirms saving it", async () => {
    const create = vi.fn((options: CreateBindingOptions) => createBinding(options));
    const onRecovery = vi.fn();
    const user = userEvent.setup();
    render(<Harness create={create} onRecovery={onRecovery} />);
    await user.click(screen.getByRole("radio", { name: "Create one in this page" }));
    const bind = screen.getByRole("button", { name: "Create binding" }) as HTMLButtonElement;
    expect(bind.disabled).toBe(true);

    await user.click(screen.getByRole("button", { name: "Create a recovery key" }));
    const secret = screen.getByLabelText("Recovery key secret").textContent ?? "";
    expect(secret).toMatch(/^nsec1/);
    expect(screen.getByText(/this page will not show it again/)).toBeTruthy();
    expect(bind.disabled).toBe(true);

    await user.click(screen.getByRole("checkbox", { name: "I have saved the recovery key" }));
    expect(bind.disabled).toBe(false);
    await user.click(bind);

    const expected = recoveryKeyFromNsec(secret).publicKey;
    expect(create.mock.calls[0]![0].recoveryPublicKey).toBe(expected);
    const kept = onRecovery.mock.calls.at(-1)![0] as RecoveryKey;
    expect(kept.publicKey).toBe(expected);
    expect(kept.signer).toBeDefined();
    expect("nsec" in kept).toBe(false);
    // The secret is gone from the page once the binding exists.
    expect(screen.queryByLabelText("Recovery key secret")).toBeNull();
    expect(screen.getByText(kept.npub)).toBeTruthy();
  });

  it("binds a recovery key kept elsewhere, by npub", async () => {
    const create = vi.fn((options: CreateBindingOptions) => createBinding(options));
    const onRecovery = vi.fn();
    const own = createRecoveryKey();
    const user = userEvent.setup();
    render(<Harness create={create} onRecovery={onRecovery} />);
    await user.click(screen.getByRole("radio", { name: "Use my own (enter its npub)" }));
    const bind = screen.getByRole("button", { name: "Create binding" }) as HTMLButtonElement;
    await user.type(screen.getByLabelText("Recovery key npub"), "not a key");
    expect(bind.disabled).toBe(true);
    await user.clear(screen.getByLabelText("Recovery key npub"));
    await user.type(screen.getByLabelText("Recovery key npub"), own.npub);
    await user.click(bind);
    expect(create.mock.calls[0]![0].recoveryPublicKey).toBe(own.publicKey);
    expect(onRecovery.mock.calls.at(-1)![0]).toEqual({ publicKey: own.publicKey, npub: own.npub });
  });

  it("binds without a recovery key by default", async () => {
    const create = vi.fn((options: CreateBindingOptions) => createBinding(options));
    const onRecovery = vi.fn();
    const user = userEvent.setup();
    render(<Harness create={create} onRecovery={onRecovery} />);
    await user.click(screen.getByRole("button", { name: "Create binding" }));
    expect(create.mock.calls[0]![0].recoveryPublicKey).toBeUndefined();
    expect(onRecovery.mock.calls.at(-1)![0]).toBeNull();
  });
});
