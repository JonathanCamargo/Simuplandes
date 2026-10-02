/**
 * E2E config (decision 2): chromium only, a Vite dev server on a dedicated
 * port (NOT 5173, which may already be occupied by the user's own dev
 * server) with `strictPort` + `reuseExistingServer: false`, so this suite
 * NEVER talks to anything but its own freshly-started server. Kept outside
 * `npm run check` -- see `package.json`'s separate `"e2e"` script.
 *
 * `E2E_PORT` is overridable via the environment so that parallel executors
 * (Phase 5's plans 05-07/05-08, each running `npm run e2e` in the same
 * working tree at the same time) start their dev servers on distinct ports
 * and never collide.
 */
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 5199);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  retries: 0,
  outputDir: "test-results",
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 800 },
    headless: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort --host 127.0.0.1`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
