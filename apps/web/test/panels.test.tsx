import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBinding,
  type CreateBindingOptions,
  type VerifiedBinding,
} from "@cashlet-labs/bnd-core";
import type {
  DiscoveryResult,
  PublishSummary,
  ReverseDiscoveryResult,
} from "@cashlet-labs/bnd-nostr";
import { BchWalletPanel } from "../src/components/BchWalletPanel";
import { BindingPanel } from "../src/components/BindingPanel";
import { DiscoverPanel } from "../src/components/DiscoverPanel";
import { LoginPanel } from "../src/components/LoginPanel";
import { RelaySettings } from "../src/components/RelaySettings";
import { selectedRelays, SITE_RELAYS, type RelayChoice } from "../src/relays";
import { createTestBchSigner, type ConnectedBchSigner } from "../src/signers/bch";
import { createMemorySigner } from "../src/signers/nostr";
import type { WizardConnectSession } from "../src/signers/wizardconnect";

afterEach(cleanup);

async function realBinding() {
  const nostr = createMemorySigner();
  const bch = createTestBchSigner("chipnet");
  const binding = await createBinding({
    nostrSigner: nostr.signer,
    bchSigner: bch.signer,
    bchKeyHash: bch.keyHash,
    network: "chipnet",
    proofType: "message",
  });
  return { nostr, bch, binding };
}

describe("RelaySettings", () => {
  function Harness() {
    const [choice, setChoice] = useState<RelayChoice>({ site: true, public: false });
    return (
      <>
        <RelaySettings choice={choice} onChange={setChoice} />
        <output>{selectedRelays(choice).join(" ")}</output>
      </>
    );
  }

  it("starts with the site's relays only and makes public relays opt-in", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByRole("status", { hidden: true }).textContent ?? "").toBe(
      SITE_RELAYS.join(" "),
    );
    await user.click(screen.getByRole("checkbox", { name: /Public relays/ }));
    expect(screen.getByText(/visible to everyone/)).toBeTruthy();
    expect(document.querySelector("output")?.textContent).toContain("wss://");
  });

  it("warns when no relay is chosen", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("checkbox", { name: /Local demo relay/ }));
    expect(screen.getByRole("alert").textContent).toBe("Choose at least one relay.");
  });
});

describe("BchWalletPanel", () => {
  function Harness(props: { start?: () => WizardConnectSession; network?: "chipnet" | "mainnet" }) {
    const [wallet, setWallet] = useState<ConnectedBchSigner | null>(null);
    return (
      <BchWalletPanel
        network={props.network ?? "chipnet"}
        wallet={wallet}
        onChange={setWallet}
        {...(props.start ? { startWizardConnect: props.start } : {})}
      />
    );
  }

  it("creates a local test key with both proof types", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Create a test key" }));
    expect(screen.getByText(/^bchtest:q/)).toBeTruthy();
    expect(screen.getByText(/transaction, message|message, transaction/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Discard this key" }));
    expect(screen.getByRole("button", { name: "Create a test key" })).toBeTruthy();
  });

  it("offers the test key on chipnet only", () => {
    render(<Harness network="mainnet" />);
    expect(screen.getByRole("button", { name: "Create a test key" }).matches(":disabled")).toBe(
      true,
    );
    expect(screen.getByText("Only available on chipnet.")).toBeTruthy();
    expect(() => createTestBchSigner("mainnet")).toThrow("only offered on chipnet");
  });

  it("shows a WizardConnect code and takes the wallet once it connects", async () => {
    const bch = createTestBchSigner("chipnet");
    let resolve!: (value: Awaited<WizardConnectSession["connected"]>) => void;
    const session: WizardConnectSession = {
      uri: "wiz://?p=abc&s=def",
      connected: new Promise((r) => (resolve = r)),
      cancel: vi.fn(async () => {}),
    };
    const start = vi.fn(() => session);
    const user = userEvent.setup();
    render(<Harness start={start} />);
    await user.click(screen.getByRole("button", { name: "Connect a wallet" }));
    expect(await screen.findByRole("img", { name: /WizardConnect code/ })).toBeTruthy();
    expect(screen.getByText("wiz://?p=abc&s=def")).toBeTruthy();
    resolve({
      walletName: "Some wallet",
      publicKey: new Uint8Array(33),
      keyHash: bch.keyHash,
      address: bch.address,
      chain: "receive",
      index: 0,
      signer: bch.signer,
      disconnect: async () => {},
    });
    expect(await screen.findByText(/Connected: Some wallet/)).toBeTruthy();
    expect(screen.getByText(/can give: transaction$/)).toBeTruthy();
  });

  it("reports a wallet that fails to connect", async () => {
    const start = vi.fn((): WizardConnectSession => ({
      uri: "wiz://x",
      connected: Promise.reject(new Error("the wallet disconnected")),
      cancel: async () => {},
    }));
    const user = userEvent.setup();
    render(<Harness start={start} />);
    await user.click(screen.getByRole("button", { name: "Connect a wallet" }));
    expect((await screen.findByRole("alert")).textContent).toBe("the wallet disconnected");
  });
});

describe("BindingPanel", () => {
  function Harness(props: {
    create: (options: CreateBindingOptions) => Promise<VerifiedBinding>;
    publish: () => Promise<PublishSummary>;
    nostr: ReturnType<typeof createMemorySigner>;
    bch: ConnectedBchSigner;
  }) {
    const [binding, setBinding] = useState<VerifiedBinding | null>(null);
    return (
      <BindingPanel
        nostr={props.nostr}
        bch={props.bch}
        relays={["ws://relay.test"]}
        binding={binding}
        onBinding={setBinding}
        createBinding={props.create}
        publishBinding={props.publish}
      />
    );
  }

  it("asks for a Nostr identity and a BCH key first", () => {
    render(
      <BindingPanel nostr={null} bch={null} relays={[]} binding={null} onBinding={() => {}} />,
    );
    expect(screen.getByText(/Connect a Nostr identity and a Bitcoin Cash key first/)).toBeTruthy();
  });

  it("creates a binding with the chosen proof and publishes it", async () => {
    const nostr = createMemorySigner();
    const bch = createTestBchSigner("chipnet");
    const create = vi.fn((options: CreateBindingOptions) => createBinding(options));
    const publish = vi.fn(async (): Promise<PublishSummary> => ({
      ok: true,
      accepted: ["ws://relay.test"],
      failed: [],
    }));
    const user = userEvent.setup();
    render(<Harness create={create} publish={publish} nostr={nostr} bch={bch} />);
    await user.click(screen.getByRole("radio", { name: "Signed message" }));
    await user.click(screen.getByRole("button", { name: "Create binding" }));
    expect(await screen.findByText(/^[0-9a-f]{64}$/)).toBeTruthy();
    expect(create.mock.calls[0]![0].proofType).toBe("message");
    expect(screen.getByText("signed message")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Publish to relays" }));
    expect((await screen.findByRole("status")).textContent).toContain(
      "Published to 1 of 1 relays.",
    );
  });

  it("lists relays that refused", async () => {
    const nostr = createMemorySigner();
    const bch = createTestBchSigner("chipnet");
    const publish = vi.fn(async (): Promise<PublishSummary> => ({
      ok: false,
      accepted: [],
      failed: [{ url: "ws://relay.test", ok: false, message: "could not connect" }],
    }));
    const user = userEvent.setup();
    render(<Harness create={createBinding} publish={publish} nostr={nostr} bch={bch} />);
    await user.click(screen.getByRole("button", { name: "Create binding" }));
    await user.click(await screen.findByRole("button", { name: "Publish to relays" }));
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("No relay accepted the binding.");
    expect(status.textContent).toContain("ws://relay.test: could not connect");
  });

  it("shows a signer failure", async () => {
    const nostr = createMemorySigner();
    const bch = createTestBchSigner("chipnet");
    const create = vi.fn(async () => {
      throw new Error("signer returned an invalid proof");
    });
    const user = userEvent.setup();
    render(<Harness create={create} publish={vi.fn()} nostr={nostr} bch={bch} />);
    await user.click(screen.getByRole("button", { name: "Create binding" }));
    expect((await screen.findByRole("alert")).textContent).toBe("signer returned an invalid proof");
  });
});

describe("DiscoverPanel", () => {
  it("finds and shows a verified binding for an npub", async () => {
    const { nostr, binding } = await realBinding();
    const discoverBinding = vi.fn(async (): Promise<DiscoveryResult> => ({
      binding,
      relays: [{ url: "ws://relay.test", received: 1, valid: 1, complete: true }],
    }));
    const user = userEvent.setup();
    render(
      <DiscoverPanel
        relays={["ws://relay.test"]}
        suggestion={nostr.npub}
        discoverBinding={discoverBinding}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Find and verify" }));
    const status = await screen.findByRole("status");
    expect(discoverBinding).toHaveBeenCalledWith(nostr.npub, { relays: ["ws://relay.test"] });
    expect(status.textContent).toContain("Both the Nostr key and the BCH key signed this binding.");
    expect(status.textContent).toContain(binding.bch.address);
  });

  it("looks up a BCH address in reverse", async () => {
    const { binding } = await realBinding();
    const discoverByBchKeyHash = vi.fn(
      async (_keyHash: Uint8Array | string): Promise<ReverseDiscoveryResult> => ({
        bindings: [binding],
        relays: [],
      }),
    );
    const user = userEvent.setup();
    render(
      <DiscoverPanel relays={["ws://relay.test"]} discoverByBchKeyHash={discoverByBchKeyHash} />,
    );
    await user.type(screen.getByLabelText("npub or BCH address"), binding.bch.address);
    await user.click(screen.getByRole("button", { name: "Find and verify" }));
    await screen.findByRole("status");
    expect(discoverByBchKeyHash.mock.calls[0]![0]).toBeInstanceOf(Uint8Array);
  });

  it("says when nothing was found and reports bad input", async () => {
    const discoverBinding = vi.fn(async (): Promise<DiscoveryResult> => ({
      binding: null,
      relays: [],
    }));
    const user = userEvent.setup();
    render(<DiscoverPanel relays={["ws://relay.test"]} discoverBinding={discoverBinding} />);
    await user.type(screen.getByLabelText("npub or BCH address"), "ab".repeat(32));
    await user.click(screen.getByRole("button", { name: "Find and verify" }));
    expect((await screen.findByRole("status")).textContent).toContain("No verified binding found");
    await user.clear(screen.getByLabelText("npub or BCH address"));
    await user.type(screen.getByLabelText("npub or BCH address"), "nonsense");
    await user.click(screen.getByRole("button", { name: "Find and verify" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/CashAddr/);
  });
});

describe("LoginPanel", () => {
  it("waits for a binding", () => {
    render(<LoginPanel nostr={null} bch={null} binding={null} />);
    expect(screen.getByText("Create and publish a binding first.")).toBeTruthy();
  });

  it("logs in with both keys, checks step-up and logs out", async () => {
    const { nostr, bch, binding } = await realBinding();
    const origin = "http://app.test";
    const calls: string[] = [];
    let level = "dual";
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.startsWith("/challenge")) {
        level = new URLSearchParams(url.split("?")[1]).get("level") ?? "dual";
        const now = Math.floor(Date.now() / 1000);
        return Response.json({
          nonce: "ab".repeat(32),
          audience: `${origin}/login`,
          level,
          issuedAt: now,
          expiresAt: now + 300,
        });
      }
      if (url === "/login") {
        const body = JSON.parse(String(init?.body)) as { bchProof?: { type: string } };
        return Response.json({
          identity: {
            npub: nostr.npub,
            bch: { address: bch.address },
            bindingId: binding.bindingId,
          },
          level,
          ...(body.bchProof ? { bchProofType: body.bchProof.type } : {}),
        });
      }
      if (url === "/me?require=dual") return Response.json({ level });
      if (url === "/me") return Response.json({ level });
      return Response.json({ ok: true });
    });
    const user = userEvent.setup();
    render(
      <LoginPanel nostr={nostr} bch={bch} binding={binding} fetchFn={fetchFn} origin={origin} />,
    );
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByText(/both keys \(message proof\)/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Try an action that needs both keys" }));
    expect((await screen.findByRole("status")).textContent).toBe(
      "Allowed: this session proved both keys.",
    );
    await user.click(screen.getByRole("button", { name: "Log out" }));
    expect((await screen.findByRole("status")).textContent).toBe("Logged out.");
    expect(calls).toEqual([
      "GET /challenge?level=dual",
      "POST /login",
      "GET /me?require=dual",
      "POST /logout",
    ]);
  });

  it("refuses a challenge for another site", async () => {
    const { nostr, bch, binding } = await realBinding();
    const now = Math.floor(Date.now() / 1000);
    const fetchFn = vi.fn(async () =>
      Response.json({
        nonce: "ab".repeat(32),
        audience: "https://evil.test/login",
        level: "dual",
        issuedAt: now,
        expiresAt: now + 300,
      }),
    );
    const user = userEvent.setup();
    render(
      <LoginPanel
        nostr={nostr}
        bch={bch}
        binding={binding}
        fetchFn={fetchFn}
        origin="http://app.test"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "challenge is for a different site",
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("shows the verifier's reason for refusing", async () => {
    const { nostr, bch, binding } = await realBinding();
    const origin = "http://app.test";
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith("/challenge")) {
        const now = Math.floor(Date.now() / 1000);
        return Response.json({
          nonce: "ab".repeat(32),
          audience: `${origin}/login`,
          level: "nostr",
          issuedAt: now,
          expiresAt: now + 300,
        });
      }
      return Response.json(
        { error: "binding is not current: binding is not published on any relay that answered" },
        { status: 401 },
      );
    });
    const user = userEvent.setup();
    render(
      <LoginPanel nostr={nostr} bch={bch} binding={binding} fetchFn={fetchFn} origin={origin} />,
    );
    await user.click(screen.getByRole("radio", { name: "Nostr key only" }));
    await user.click(screen.getByRole("button", { name: "Log in" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "binding is not current: binding is not published on any relay that answered",
      ),
    );
  });
});
