import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NostrSignerPanel, type NostrSignerPanelProps } from "../src/components/NostrSignerPanel";
import {
  createMemorySigner,
  type ConnectedNostrSigner,
  type NostrConnectRequest,
} from "../src/signers/nostr";

afterEach(cleanup);

function Harness(props: Omit<NostrSignerPanelProps, "signer" | "onChange">) {
  const [signer, setSigner] = useState<ConnectedNostrSigner | null>(null);
  return <NostrSignerPanel {...props} signer={signer} onChange={setSigner} />;
}

function pendingRequest(): NostrConnectRequest {
  return {
    uri: "nostrconnect://" + "ab".repeat(32) + "?relay=wss%3A%2F%2Fnos.lol&secret=x",
    connected: new Promise(() => {}),
    cancel: vi.fn(),
  };
}

function remoteStub(overrides: Partial<NonNullable<NostrSignerPanelProps["remote"]>> = {}) {
  return {
    connectBunker: vi.fn(async () => createMemorySigner()),
    startNostrConnect: vi.fn(pendingRequest),
    ...overrides,
  };
}

describe("NostrSignerPanel", () => {
  it("creates an in-page key and warns that reload loses it", async () => {
    const user = userEvent.setup();
    render(<Harness nip07Provider={null} remote={remoteStub()} />);
    await user.click(screen.getByRole("button", { name: "Create a new key" }));
    expect(screen.getByText(/npub1/)).toBeTruthy();
    expect(screen.getByText(/Reloading the page loses it/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Discard this key" }));
    expect(screen.getByRole("button", { name: "Create a new key" })).toBeTruthy();
  });

  it("says when no extension is installed", () => {
    render(<Harness nip07Provider={null} remote={remoteStub()} />);
    expect(screen.getByText("No Nostr extension found in this browser.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Use my browser extension" })).toBeNull();
  });

  it("connects through an extension", async () => {
    const key = createMemorySigner();
    const provider = { getPublicKey: async () => key.publicKey, signEvent: async () => ({}) };
    const user = userEvent.setup();
    render(<Harness nip07Provider={provider} remote={remoteStub()} />);
    await user.click(screen.getByRole("button", { name: "Use my browser extension" }));
    expect(screen.getByText(key.npub)).toBeTruthy();
    expect(screen.getByText(/browser extension \(NIP-07\)/)).toBeTruthy();
  });

  it("shows an extension's refusal", async () => {
    const provider = {
      getPublicKey: async () => {
        throw new Error("permission denied");
      },
      signEvent: async () => ({}),
    };
    const user = userEvent.setup();
    render(<Harness nip07Provider={provider} remote={remoteStub()} />);
    await user.click(screen.getByRole("button", { name: "Use my browser extension" }));
    expect((await screen.findByRole("alert")).textContent).toBe("permission denied");
  });

  it("connects with a bunker link", async () => {
    const remote = remoteStub();
    const user = userEvent.setup();
    render(<Harness nip07Provider={null} remote={remote} />);
    const button = screen.getByRole<HTMLButtonElement>("button", {
      name: "Connect with bunker link",
    });
    expect(button.disabled).toBe(true);
    await user.type(screen.getByLabelText("Bunker link"), "bunker://abc");
    await user.click(button);
    expect(remote.connectBunker).toHaveBeenCalledWith("bunker://abc", expect.any(Object));
    expect(await screen.findByText(/npub1/)).toBeTruthy();
  });

  it("shows a connection code and cancels it", async () => {
    const startNostrConnect = vi.fn(pendingRequest);
    const remote = remoteStub({ startNostrConnect });
    const user = userEvent.setup();
    render(<Harness nip07Provider={null} remote={remote} />);
    await user.click(screen.getByRole("button", { name: "Show connection code" }));
    expect(startNostrConnect).toHaveBeenCalledWith(
      ["wss://relay.damus.io", "wss://nos.lol"],
      expect.any(Object),
    );
    expect(await screen.findByRole("img", { name: /Nostr Connect code/ })).toBeTruthy();
    expect(screen.getByText(/^nostrconnect:\/\//)).toBeTruthy();
    const request = startNostrConnect.mock.results[0]!.value as NostrConnectRequest;
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(request.cancel).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Show connection code" })).toBeTruthy();
  });

  it("finishes when the signer app answers the code", async () => {
    const answer = createMemorySigner();
    const remote = remoteStub({
      startNostrConnect: vi.fn(() => ({
        uri: "nostrconnect://x",
        connected: Promise.resolve(answer),
        cancel: vi.fn(),
      })),
    });
    const user = userEvent.setup();
    render(<Harness nip07Provider={null} remote={remote} />);
    await user.click(screen.getByRole("button", { name: "Show connection code" }));
    expect(await screen.findByText(answer.npub)).toBeTruthy();
  });

  it("reports invalid relays for the code", async () => {
    const remote = remoteStub({
      startNostrConnect: vi.fn(() => {
        throw new Error("not a wss:// relay URL: http://x");
      }),
    });
    const user = userEvent.setup();
    render(<Harness nip07Provider={null} remote={remote} />);
    await user.click(screen.getByRole("button", { name: "Show connection code" }));
    expect(screen.getByRole("alert").textContent).toContain("not a wss://");
  });

  it("shows an https approval link and never one with another scheme", async () => {
    const user = userEvent.setup();
    const connectWith = (url: string) =>
      remoteStub({
        connectBunker: vi.fn(
          async (_link: string, options?: { onAuthUrl?: (u: string) => void }) => {
            options?.onAuthUrl?.(url);
            return new Promise<ConnectedNostrSigner>(() => {});
          },
        ),
      });

    const { unmount } = render(
      <Harness nip07Provider={null} remote={connectWith("https://signer.example/approve")} />,
    );
    await user.type(screen.getByLabelText("Bunker link"), "bunker://abc");
    await user.click(screen.getByRole("button", { name: "Connect with bunker link" }));
    const link = await screen.findByRole("link", { name: "open the approval page" });
    expect(link.getAttribute("href")).toBe("https://signer.example/approve");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    unmount();

    render(<Harness nip07Provider={null} remote={connectWith("javascript:alert(1)")} />);
    await user.type(screen.getByLabelText("Bunker link"), "bunker://abc");
    await user.click(screen.getByRole("button", { name: "Connect with bunker link" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/not https/));
    expect(screen.queryByRole("link")).toBeNull();
  });
});
