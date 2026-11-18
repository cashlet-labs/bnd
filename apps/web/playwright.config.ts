import { defineConfig, devices } from "@playwright/test";

const PREVIEW_URL = "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: PREVIEW_URL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Build once, then serve the built page as users get it.
    command: "npx vite build && npx vite preview",
    url: PREVIEW_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
