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
