import { expect, test } from "@playwright/test";

test("the built page loads without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await expect(page).toHaveTitle("BND identity demo");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("BND identity demo");
  expect(errors).toEqual([]);
});

test("creates an in-page Nostr key in a real browser", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Create a new key" }).click();
  await expect(page.getByText(/^npub1[0-9a-z]{58}$/)).toBeVisible();
  await expect(page.getByText(/Reloading the page loses it/)).toBeVisible();
  await page.getByRole("button", { name: "Discard this key" }).click();
  await expect(page.getByRole("button", { name: "Create a new key" })).toBeVisible();
  expect(errors).toEqual([]);
});
