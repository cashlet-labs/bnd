import { test } from "@playwright/test";

// Saves full-page screenshots of each page in both themes, for review by eye.
// They go to test-results/screenshots, which git ignores.
for (const theme of ["dark", "light"] as const) {
  for (const [name, path] of [
    ["landing", "/"],
    ["demo", "/demo"],
    ["verify", "/verify"],
  ] as const) {
    test(`screenshot: ${name} (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(path);
      // Routes load lazily, so wait for the page itself before its fonts.
      await page.getByRole("heading", { level: 1 }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: `test-results/screenshots/${name}-${theme}.png`,
        fullPage: true,
      });
    });
  }
}
