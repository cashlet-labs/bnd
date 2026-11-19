import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAppRouter } from "../src/router";
import { applyInitialTheme } from "../src/theme";

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

async function renderAt(path: string) {
  applyInitialTheme();
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  render(<RouterProvider router={router} />);
  await router.load();
  return router;
}

describe("routes", () => {
  it("shows the landing page with links to the demo and the verifier", async () => {
    await renderAt("/");
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toContain(
      "Verified by anyone.",
    );
    expect(screen.getByRole("link", { name: "Try the demo" }).getAttribute("href")).toBe("/demo");
    expect(screen.getByRole("link", { name: "Verify an identity" }).getAttribute("href")).toBe(
      "/verify",
    );
    expect(screen.getAllByRole("link", { name: "Spec" })[0]!.getAttribute("href")).toMatch(
      /spec\/BND-1\.md$/,
    );
  });

  it("shows the demo steps", async () => {
    await renderAt("/demo");
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe(
      "Create and use a BND identity",
    );
    for (const name of [/Nostr identity/, /Bitcoin Cash key/, /Bind and publish/, /Log in/]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeTruthy();
    }
  });

  it("shows the verifier without any key steps", async () => {
    await renderAt("/verify");
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe(
      "Verify a BND identity",
    );
    expect(screen.getByRole("button", { name: "Find and verify" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /Nostr identity/ })).toBeNull();
  });

  it("shows a not-found page for unknown paths", async () => {
    await renderAt("/nothing-here");
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Page not found");
  });

  it("keeps connected keys while moving between pages", async () => {
    const user = userEvent.setup();
    await renderAt("/demo");
    await user.click(await screen.findByRole("button", { name: "Create a new key" }));
    const npub = (await screen.findByText(/^npub1/)).textContent;
    await user.click(screen.getAllByRole("link", { name: "Verify" })[0]!);
    await screen.findByRole("heading", { level: 1, name: "Verify a BND identity" });
    await user.click(screen.getAllByRole("link", { name: "Demo" })[0]!);
    await waitFor(() => expect(screen.getByText(/^npub1/).textContent).toBe(npub));
  });

  it("marks the current page in the navigation", async () => {
    await renderAt("/verify");
    await screen.findByRole("heading", { level: 1 });
    const nav = screen.getByRole("navigation", { name: "Main" });
    const verify = [...nav.querySelectorAll("a")].find((a) => a.textContent === "Verify");
    expect(verify?.className).toContain("active");
  });
});

describe("theme", () => {
  it("toggles between light and dark and remembers the choice", async () => {
    const user = userEvent.setup();
    await renderAt("/");
    const initial = document.documentElement.dataset.theme;
    expect(initial === "light" || initial === "dark").toBe(true);
    const next = initial === "dark" ? "light" : "dark";
    await user.click(screen.getByRole("button", { name: `Switch to ${next} theme` }));
    expect(document.documentElement.dataset.theme).toBe(next);
    expect(localStorage.getItem("cashlet-theme")).toBe(next);
  });
});
