import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BchNetwork } from "@cashlet-labs/bnd-core";
import { App } from "../src/App";
import { NetworkPicker } from "../src/components/NetworkPicker";

afterEach(cleanup);

function setup(network: BchNetwork = "chipnet") {
  const onChange = vi.fn<(network: BchNetwork) => void>();
  render(<NetworkPicker network={network} onChange={onChange} />);
  return { onChange, user: userEvent.setup() };
}

describe("NetworkPicker", () => {
  it("starts on chipnet", () => {
    setup();
    expect(screen.getByRole<HTMLInputElement>("radio", { name: /chipnet/i }).checked).toBe(true);
  });

  it("does not switch to mainnet without confirmation", async () => {
    const { onChange, user } = setup();
    await user.click(screen.getByRole("radio", { name: /mainnet/i }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog").textContent).toMatch(/real funds/);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Use mainnet" }).disabled).toBe(
      true,
    );
  });

  it("switches to mainnet once the warning is acknowledged", async () => {
    const { onChange, user } = setup();
    await user.click(screen.getByRole("radio", { name: /mainnet/i }));
    await user.click(screen.getByRole("checkbox", { name: /real funds and identities/i }));
    await user.click(screen.getByRole("button", { name: "Use mainnet" }));
    expect(onChange).toHaveBeenCalledWith("mainnet");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("stays on chipnet when the user backs out", async () => {
    const { onChange, user } = setup();
    await user.click(screen.getByRole("radio", { name: /mainnet/i }));
    await user.click(screen.getByRole("button", { name: "Stay on chipnet" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks again after backing out", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("radio", { name: /mainnet/i }));
    await user.click(screen.getByRole("checkbox", { name: /real funds and identities/i }));
    await user.click(screen.getByRole("button", { name: "Stay on chipnet" }));
    await user.click(screen.getByRole("radio", { name: /mainnet/i }));
    expect(screen.getByRole<HTMLInputElement>("checkbox", { name: /real funds/i }).checked).toBe(
      false,
    );
  });

  it("switches back to chipnet without asking", async () => {
    const { onChange, user } = setup("mainnet");
    await user.click(screen.getByRole("radio", { name: /chipnet/i }));
    expect(onChange).toHaveBeenCalledWith("chipnet");
  });

  it("can be disabled", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<NetworkPicker network="chipnet" onChange={onChange} disabled />);
    const mainnet = screen.getByRole("radio", { name: /mainnet/i });
    expect(mainnet.matches(":disabled")).toBe(true);
    await user.click(mainnet);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("App network banner", () => {
  it("shows a mainnet banner only on mainnet", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.queryByRole("status")).toBeNull();
    await user.click(screen.getByRole("radio", { name: /mainnet/i }));
    await user.click(screen.getByRole("checkbox", { name: /real funds and identities/i }));
    await user.click(screen.getByRole("button", { name: "Use mainnet" }));
    expect(screen.getByRole("status").textContent).toMatch(/real funds/);
  });
});
