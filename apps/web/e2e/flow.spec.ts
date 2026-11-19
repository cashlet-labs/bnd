import { expect, test, type Page } from "@playwright/test";

/** Collects page errors and policy violations, which must stay empty. */
function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function createIdentity(page: Page) {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Create a new key" }).click();
  await page.getByRole("button", { name: "Create a test key" }).click();
  await expect(page.getByText(/^bchtest:q/).first()).toBeVisible();
}

test("the built page is served with a strict security policy", async ({ page }) => {
  const response = await page.goto("/");
  const headers = response?.headers() ?? {};
  const csp = headers["content-security-policy"] ?? "";
  expect(csp).toContain("default-src 'none'");
  // WebAssembly compilation only: libauth runs its secp256k1 code as WebAssembly.
  expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("font-src 'self'");
  expect(csp).not.toContain("unsafe-inline");
  expect(csp).not.toContain("'unsafe-eval'");
  expect(headers["referrer-policy"]).toBe("no-referrer");
});

for (const proof of ["Signed message", "Transaction proof (never broadcast)"] as const) {
  test(`binds, publishes, verifies and logs in with both keys: ${proof}`, async ({ page }) => {
    const errors = watchForErrors(page);
    await createIdentity(page);

    await page.getByRole("radio", { name: proof }).check();
    await page.getByRole("button", { name: "Create binding" }).click();
    await expect(page.getByText(/^[0-9a-f]{64}$/)).toBeVisible();
    await page.getByRole("button", { name: "Publish to relays" }).click();
    await expect(page.getByText("Published to 1 of 1 relays.")).toBeVisible();

    // Independent verification of our own npub through the relay.
    await page.getByRole("button", { name: "Find and verify" }).click();
    await expect(
      page.getByText("Both the Nostr key and the BCH key signed this binding."),
    ).toBeVisible();

    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByText(/^both keys/)).toBeVisible();
    await page.getByRole("button", { name: "Try an action that needs both keys" }).click();
    await expect(page.getByText("Allowed: this session proved both keys.")).toBeVisible();

    const cookies = await page.context().cookies();
    const session = cookies.find((cookie) => cookie.name === "bnd_session");
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe("Strict");

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page.getByText("Logged out.")).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("a Nostr-only login cannot do an action that needs both keys", async ({ page }) => {
  await createIdentity(page);
  await page.getByRole("button", { name: "Create binding" }).click();
  await page.getByRole("button", { name: "Publish to relays" }).click();
  await expect(page.getByText("Published to 1 of 1 relays.")).toBeVisible();
  await page.getByRole("radio", { name: "Nostr key only" }).check();
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Nostr key only", { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "Try an action that needs both keys" }).click();
  await expect(page.getByRole("alert")).toHaveText("this needs a login with both keys");
});

test("the verifier refuses a binding that was never published", async ({ page }) => {
  await createIdentity(page);
  await page.getByRole("button", { name: "Create binding" }).click();
  await expect(page.getByText(/^[0-9a-f]{64}$/)).toBeVisible();
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "binding is not current: binding is not published on any relay that answered",
  );
});

test("keys survive moving between the demo and the verifier", async ({ page }) => {
  await createIdentity(page);
  const npub = await page
    .getByText(/^npub1/)
    .first()
    .textContent();
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Verify" })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Verify a BND identity");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Demo" }).click();
  await expect(page.getByText(/^npub1/).first()).toHaveText(npub ?? "");
});

test("the verifier page finds and checks a binding published in the demo", async ({ page }) => {
  await createIdentity(page);
  await page.getByRole("button", { name: "Create binding" }).click();
  await page.getByRole("button", { name: "Publish to relays" }).click();
  await expect(page.getByText("Published to 1 of 1 relays.")).toBeVisible();
  const address = await page
    .getByText(/^bchtest:q/)
    .first()
    .textContent();
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Verify" })
    .click();
  await page.getByLabel("npub or BCH address").fill(address ?? "");
  await page.getByRole("button", { name: "Find and verify" }).click();
  const checks = page.getByRole("list", { name: "Checks passed" });
  await expect(checks).toBeVisible();
  await expect(checks.getByRole("listitem")).toHaveCount(4);
});
