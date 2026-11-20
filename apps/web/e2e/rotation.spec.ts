import { expect, test, type Page } from "@playwright/test";

// Rotation, recovery, revocation and the takeover demo (BND-1 section 9),
// against the dev relay, which enforces succession as the Cashlet relays do.

function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

const region = (page: Page, name: RegExp) => page.getByRole("region", { name });
const identity = (page: Page) => region(page, /Change the identity/);
const login = (page: Page) => region(page, /Log in to an application/);

/** Keys in the page, then a published binding, optionally with a recovery key. */
async function publishedIdentity(page: Page, options: { recovery?: boolean } = {}) {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Create a new key" }).first().click();
  await page.getByRole("button", { name: "Create a test key" }).click();
  await expect(page.getByText(/^bchtest:q/).first()).toBeVisible();
  if (options.recovery) {
    await page.getByRole("radio", { name: "Create one in this page" }).check();
    await page.getByRole("button", { name: "Create a recovery key" }).click();
    await expect(page.getByLabel("Recovery key secret")).toHaveText(/^nsec1/);
    await page.getByRole("checkbox", { name: "I have saved the recovery key" }).check();
  }
  await page.getByRole("button", { name: "Create binding" }).click();
  await page.getByRole("button", { name: "Publish to relays" }).click();
  await expect(page.getByText("Published to 1 of 1 relays.")).toBeVisible();
}

async function logIn(page: Page) {
  await login(page).getByRole("button", { name: "Log in" }).click();
  await expect(login(page).getByText(/^both keys/)).toBeVisible();
}

async function logOut(page: Page) {
  await login(page).getByRole("button", { name: "Log out" }).click();
  await expect(login(page).getByText("Logged out.")).toBeVisible();
}

test("rotates the BCH key, then logs in with the new one and shows the chain", async ({ page }) => {
  const errors = watchForErrors(page);
  await publishedIdentity(page);
  await logIn(page);
  await logOut(page);

  const panel = identity(page);
  await panel.getByRole("button", { name: "Create a test key" }).click();
  await panel.getByRole("button", { name: "Rotate the BCH key" }).click();
  const status = panel.getByRole("status");
  await expect(status).toContainText("Replaced and published to 1 of 1 relays.");
  await expect(status).toContainText("Nostr key and BCH key");

  // The verifier pinned the first binding at the first login; the successor continues it.
  await logIn(page);

  await page.getByRole("button", { name: "Find and verify" }).click();
  const history = page.getByRole("list", { name: "Binding history" });
  await expect(history.getByRole("listitem")).toHaveCount(2);
  await expect(history).toContainText("new BCH key");
  await expect(history).toContainText("Approved by Nostr key and BCH key");
  expect(errors).toEqual([]);
});

test("rotates the Nostr key and logs in under the new key", async ({ page }) => {
  await publishedIdentity(page);
  const panel = identity(page);
  await panel.getByRole("radio", { name: "Rotate the Nostr key" }).check();
  await panel.getByRole("button", { name: "Create a new key" }).click();
  const newNpub = await panel.getByText(/^npub1/).textContent();
  await panel.getByRole("button", { name: "Rotate the Nostr key" }).click();
  await expect(panel.getByRole("status")).toContainText("Replaced");
  await logIn(page);
  await expect(login(page).getByText(newNpub ?? "")).toBeVisible();
});

test("recovers from a lost Nostr key with the recovery key", async ({ page }) => {
  await publishedIdentity(page, { recovery: true });
  // Once the binding exists, the secret is no longer shown.
  await expect(page.getByLabel("Recovery key secret")).toHaveCount(0);
  const panel = identity(page);
  await panel.getByRole("radio", { name: "Recover from a lost Nostr key" }).check();
  await panel.getByRole("button", { name: "Create a new key" }).click();
  await panel.getByRole("button", { name: "Recover with the recovery key" }).click();
  await expect(panel.getByRole("status")).toContainText("BCH key and recovery key");
  await logIn(page);
});

test("revokes the identity, after which login is refused", async ({ page }) => {
  await publishedIdentity(page);
  const panel = identity(page);
  await panel.getByRole("radio", { name: "Revoke the identity" }).check();
  await panel.getByRole("button", { name: "Revoke" }).click();
  await expect(panel.getByRole("status")).toContainText("Revoked and published");
  await expect(panel).toContainText("This identity is revoked.");

  await login(page).getByRole("button", { name: "Log in" }).click();
  await expect(login(page).getByRole("alert")).toHaveText("this identity has been revoked");

  await page.getByRole("button", { name: "Find and verify" }).click();
  await expect(page.getByText(/^Revoked on /)).toBeVisible();
});

test("a takeover with only the Nostr key is refused three times", async ({ page }) => {
  const errors = watchForErrors(page);
  await publishedIdentity(page);
  await logIn(page);

  const panel = region(page, /Try a takeover/);
  await panel.getByRole("button", { name: "Try a takeover" }).click();
  const defences = panel.getByRole("list", { name: "Defences" }).getByRole("listitem");
  await expect(defences).toHaveCount(3);
  for (let i = 0; i < 3; i++) await expect(defences.nth(i)).toHaveClass("held");
  await expect(defences.nth(0)).toContainText("got only the nostr key");
  await expect(defences.nth(1)).toContainText("this key already has a binding here");
  await expect(panel).toContainText("the attacker could not move your identity");

  // The real binding is untouched: the session still works and it still verifies.
  await login(page).getByRole("button", { name: "Try an action that needs both keys" }).click();
  await expect(login(page).getByText("Allowed: this session proved both keys.")).toBeVisible();
  await page.getByRole("button", { name: "Find and verify" }).click();
  await expect(
    page.getByText("Both the Nostr key and the BCH key signed this binding."),
  ).toBeVisible();
  // The browser logs the verifier's refusal of the fake login (401); that is the point.
  expect(errors.filter((error) => !error.includes("status of 401"))).toEqual([]);
  expect(errors.filter((error) => error.includes("status of 401"))).toHaveLength(1);
});
