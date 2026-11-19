import { expect, test } from "@playwright/test";

test("the landing page loads without errors or WebAssembly", async ({ page }) => {
  const errors: string[] = [];
  const scripts: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("request", (request) => {
    if (request.resourceType() === "script") scripts.push(request.url());
  });
  await page.goto("/");
  await expect(page).toHaveTitle("Cashlet BND · Bitcoin Cash and Nostr identity");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Verified by anyone.");
  expect(errors).toEqual([]);
  // The demo and verifier code, which carries the WebAssembly crypto, loads only when needed.
  expect(scripts.some((url) => /\/assets\/demo-/.test(url))).toBe(false);
});

test("the landing page leads to the demo and the verifier", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Try the demo" }).click();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Create and use a BND identity");
  await page.goto("/");
  await page.getByRole("link", { name: "Verify an identity" }).click();
  await expect(page).toHaveURL(/\/verify$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Verify a BND identity");
});

test("deep links and unknown paths work on a fresh load", async ({ page }) => {
  await page.goto("/verify");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Verify a BND identity");
  await page.goto("/no-such-page");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
});

test("the theme can be switched and is remembered after a reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("the page follows the system theme when nothing is saved", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("the self-hosted fonts load", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() =>
    [...document.fonts].filter((font) => font.status === "loaded").map((font) => font.family),
  );
  expect(loaded.join(" ")).toContain("DM Sans");
  expect(loaded.join(" ")).toContain("Space Grotesk");
});
