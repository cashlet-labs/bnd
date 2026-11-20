import { expect, test } from "@playwright/test";

// The did:bnd shown in the page stays the same across a rotation, and the
// page's own resolver (/did/<did>) follows it to the current binding.

test("the DID survives a rotation and resolves to the current keys", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Create a new key" }).first().click();
  await page.getByRole("button", { name: "Create a test key" }).click();
  await page.getByRole("button", { name: "Create binding" }).click();
  await page.getByRole("button", { name: "Publish to relays" }).click();
  await expect(page.getByText("Published to 1 of 1 relays.")).toBeVisible();

  const binding = page.getByRole("region", { name: /Bind and publish/ });
  const did = (await binding.getByLabel("DID").textContent()) ?? "";
  expect(did).toMatch(/^did:bnd:chipnet:[0-9a-f]{64}:[0-9a-f]{64}$/);

  const panel = page.getByRole("region", { name: /Change the identity/ });
  await panel.getByRole("button", { name: "Create a test key" }).click();
  await panel.getByRole("button", { name: "Rotate the BCH key" }).click();
  await expect(panel.getByRole("status")).toContainText("Replaced");
  const newBinding = await panel.getByRole("status").locator("dd code").textContent();

  await page.getByRole("button", { name: "Find and verify" }).click();
  await expect(
    page.getByRole("region", { name: /Discover and verify/ }).getByLabel("DID"),
  ).toHaveText(did);

  const response = await page.request.get(`/did/${encodeURIComponent(did)}`);
  expect(response.status()).toBe(200);
  const result = (await response.json()) as {
    didDocument: { id: string; alsoKnownAs: string[] };
    didDocumentMetadata: { versionId: string };
  };
  expect(result.didDocument.id).toBe(did);
  expect(result.didDocumentMetadata.versionId).toBe(newBinding);
});
