import { createBinding, encodeBchAddress, hexToBytes } from "@cashlet-labs/bnd";
import { didOf, type PayeeResult } from "@cashlet-labs/bnd/did";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PayPanel } from "../src/components/PayPanel";
import { createTestBchSigner } from "../src/signers/bch";
import { createMemorySigner } from "../src/signers/nostr";

afterEach(cleanup);

async function payee(): Promise<PayeeResult> {
  const nostr = createMemorySigner();
  const bch = createTestBchSigner("chipnet");
  const binding = await createBinding({
    nostrSigner: nostr.signer,
    bchSigner: bch.signer,
    bchKeyHash: bch.keyHash,
    network: "chipnet",
    proofType: "message",
  });
  return {
    ok: true,
    binding,
    did: didOf(binding),
    address: binding.bch.address,
    tokenAddress: encodeBchAddress(hexToBytes(binding.bch.keyHash), "chipnet", {
      tokenAware: true,
    }),
    relays: [{ url: "wss://relay.test", received: 1, valid: 1, complete: true }],
  };
}

describe("PayPanel", () => {
  it("shows a BCH payment request with the amount, and the token-aware address", async () => {
    const result = await payee();
    if (!result.ok) throw new Error("setup");
    const resolvePayee = vi.fn(async () => result);
    const user = userEvent.setup();
    render(<PayPanel relays={["wss://a.test", "wss://b.test"]} resolvePayee={resolvePayee} />);
    await user.type(screen.getByLabelText("npub or did:bnd"), result.did);
    await user.click(screen.getByRole("button", { name: "Find where to pay" }));
    await screen.findByRole("status");
    expect(resolvePayee).toHaveBeenCalledWith(result.did, {
      relays: ["wss://a.test", "wss://b.test"],
      minComplete: 2,
    });
    const request = screen.getByLabelText("Payment request");
    expect(request.textContent).toMatch(new RegExp(`^${result.address}\\?label=npub1`));
    await user.type(screen.getByLabelText("Amount in BCH (optional)"), "0.0015");
    // Typing passes through "0.", which is not an amount, so the request is redrawn.
    const withAmount = screen.getByLabelText("Payment request");
    expect(withAmount.textContent).toContain("?amount=0.0015&label=");
    expect(screen.getByRole("link", { name: "Open in wallet" }).getAttribute("href")).toBe(
      withAmount.textContent,
    );
    expect(screen.getByLabelText("Token address").textContent).toBe(result.tokenAddress);
    expect(result.tokenAddress).toMatch(/^bchtest:z/);
  });

  it("refuses an invalid amount without hiding the address", async () => {
    const result = await payee();
    const user = userEvent.setup();
    render(<PayPanel relays={["wss://a.test"]} resolvePayee={async () => result} />);
    await user.type(screen.getByLabelText("npub or did:bnd"), "npub1x");
    await user.click(screen.getByRole("button", { name: "Find where to pay" }));
    await screen.findByRole("status");
    await user.type(screen.getByLabelText("Amount in BCH (optional)"), "-1");
    expect(screen.getByRole("alert").textContent).toContain("the amount must be a positive number");
    expect(screen.queryByLabelText("Payment request")).toBeNull();
    expect(screen.getByLabelText("Token address")).toBeTruthy();
  });

  it("shows why an identity cannot be paid", async () => {
    const user = userEvent.setup();
    render(
      <PayPanel
        relays={["wss://a.test"]}
        resolvePayee={async () => ({ ok: false, reason: "this identity has been revoked" })}
      />,
    );
    await user.type(screen.getByLabelText("npub or did:bnd"), "npub1x");
    await user.click(screen.getByRole("button", { name: "Find where to pay" }));
    expect((await screen.findByRole("alert")).textContent).toBe("this identity has been revoked");
    expect(screen.queryByRole("status")).toBeNull();
  });
});
