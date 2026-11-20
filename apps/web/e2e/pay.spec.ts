import { expect, test } from "@playwright/test";

// Pay by identity: after a rotation, an npub and a did:bnd both lead to the
// current address, as a BCH payment request and a token-aware address.

test("pays an identity by npub or DID, at its current address", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Create a new key" }).first().click();
  await page.getByRole("button", { name: "Create a test key" }).click();
  await page.getByRole("button", { name: "Create binding" }).click();
  await page.getByRole("button", { name: "Publish to relays" }).click();
  await expect(page.getByText("Published to 1 of 1 relays.")).toBeVisible();
  const binding = page.getByRole("region", { name: /Bind and publish/ });
  const did = (await binding.getByLabel("DID").textContent()) ?? "";
  const npub =
    (await page
      .getByText(/^npub1/)
      .first()
      .textContent()) ?? "";

  const identity = page.getByRole("region", { name: /Change the identity/ });
  await identity.getByRole("button", { name: "Create a test key" }).click();
  await identity.getByRole("button", { name: "Rotate the BCH key" }).click();
  await expect(identity.getByRole("status")).toContainText("Replaced");
  const current =
    (await page
      .getByRole("region", { name: /Bitcoin Cash key/ })
      .first()
      .getByText(/^bchtest:q/)
      .textContent()) ?? "";

  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Verify" })
    .click();
  const pay = page.getByRole("region", { name: /Pay this identity/ });
  for (const target of [npub, did]) {
    await pay.getByLabel("npub or did:bnd").fill(target);
    await pay.getByRole("button", { name: "Find where to pay" }).click();
    await expect(pay.getByLabel("Payment request")).toHaveText(new RegExp(`^${current}\\?label=`));
  }
  await pay.getByLabel("Amount in BCH (optional)").fill("0.002");
  await expect(pay.getByLabel("Payment request")).toContainText("?amount=0.002&label=");
  await expect(pay.getByLabel("Token address")).toHaveText(/^bchtest:z/);
  await expect(pay.getByRole("img", { name: "BCH payment request" })).toBeVisible();
});
