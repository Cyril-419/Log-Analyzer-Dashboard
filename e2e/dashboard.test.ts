// End-to-end tests: a real browser drives the React app, which calls the real
// Node API, which calls the real Python analyzer service.
//
// Needs the analyzer running first:  python -m loganalyzer serve   (port 8080)
// and a built frontend:              npm run build
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { chromium, type Browser, type Page } from "playwright";

import { createHttpAnalyzer } from "../server/analyzerClient.ts";
import { createApp } from "../server/app.ts";
import { AnalysisStore } from "../server/db.ts";
import { listen } from "../server/test/helpers.ts";

const ANALYZER_URL = process.env.ANALYZER_URL ?? "http://127.0.0.1:8080";

/** Click a sample button and wait until the file has fully loaded into the form. */
async function loadSample(page: Page, label: string, file: string) {
  await Promise.all([page.waitForResponse((r) => r.url().endsWith(`/samples/${file}`)), page.getByRole("button", { name: label }).click()]);
  await page.locator('form[aria-busy="false"]').waitFor();
  await page.getByTestId("loaded-file").filter({ hasText: file }).waitFor();
}

describe("dashboard end to end", () => {
  let base: string;
  let server: Server;
  let store: AnalysisStore;
  let browser: Browser;
  let page: Page;
  const pageErrors: string[] = [];

  before(async () => {
    const analyzer = createHttpAnalyzer(ANALYZER_URL, 30_000);
    assert.ok(await analyzer.health(), `analyzer not reachable at ${ANALYZER_URL}; start it with: python -m loganalyzer serve`);

    store = new AnalysisStore(join(mkdtempSync(join(tmpdir(), "dash-e2e-")), "e2e.db"));
    ({ url: base, server } = await listen(
      createApp({ store, analyzer, maxBodyBytes: 5 * 1024 * 1024, rateLimitPerMinute: 1000, staticDir: "web/dist" }),
    ));

    // CHROME_PATH lets you use an installed Chrome instead of Playwright's download.
    browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
    page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg) => { if (msg.type() === "error") pageErrors.push(msg.text()); });
    page.on("dialog", (dialog) => void dialog.accept()); // confirm() on delete
  });

  after(async () => {
    await browser?.close();
    server?.close();
    store?.close();
  });

  test("shows that every service is online", async () => {
    await page.goto(base);
    await page.getByTestId("health").filter({ hasText: "All services online" }).waitFor();
    await page.getByText("No analysis selected").waitFor();
  });

  test("analyzes a sample log and shows the planted attacks", async () => {
    await loadSample(page, "Linux SSH (auth.log)", "auth.log");
    await page.getByRole("button", { name: "Analyze logs" }).click();

    await page.getByTestId("analysis-title").filter({ hasText: "Sample: auth.log" }).waitFor();
    const rows = page.getByTestId("alert-row");
    await rows.first().waitFor();
    assert.equal(await rows.count(), 3);
    const text = await page.locator(".alerts-table").innerText();
    for (const expected of ["Brute force", "Password spray", "Success after failures", "203.0.113.45"]) {
      assert.ok(text.includes(expected), `alerts table should mention ${expected}`);
    }
    assert.equal(await page.getByTestId("history").locator("li").count(), 1);
  });

  test("filters alerts by severity and expands the accounts tried", async () => {
    await page.getByRole("button", { name: "High", exact: true }).click();
    assert.equal(await page.getByTestId("alert-row").count(), 2);
    await page.getByRole("button", { name: "Medium", exact: true }).click();
    assert.equal(await page.getByTestId("alert-row").count(), 1);
    await page.getByRole("button", { name: "All", exact: true }).click();

    await page.getByRole("button", { name: /5 account\(s\)/ }).click();
    await page.locator(".users li").first().waitFor();
    assert.equal(await page.locator(".users li").count(), 5);
  });

  test("custom thresholds change the result", async () => {
    await loadSample(page, "Linux SSH (auth.log)", "auth.log");
    await page.locator("summary", { hasText: "Detection settings" }).click();
    await page.getByLabel("Brute force: failures").fill("1000");
    await page.getByLabel("Name").fill("Strict brute-force threshold");
    await page.getByRole("button", { name: "Analyze logs" }).click();
    await page.getByTestId("analysis-title").filter({ hasText: "Strict brute-force threshold" }).waitFor();
    const text = await page.locator(".alerts-table").innerText();
    assert.ok(!text.includes("Brute force"), "brute force should not fire with a 1000-failure threshold");
  });

  test("history survives a reload and reopens a saved analysis", async () => {
    await page.reload();
    const history = page.getByTestId("history").locator("li");
    await history.first().waitFor();
    assert.equal(await history.count(), 2);
    await page.getByTestId("history").locator(".history-item", { hasText: "Sample: auth.log" }).click();
    await page.getByTestId("analysis-title").filter({ hasText: "Sample: auth.log" }).waitFor();
    assert.equal(await page.getByTestId("alert-row").count(), 3);
  });

  test("an invalid upload shows the analyzer's error message", async () => {
    await page.getByTestId("file-input").setInputFiles({
      name: "broken.json",
      mimeType: "application/json",
      buffer: Buffer.from('[{"EventID": 4625, "IpAddress": "1.2.3.4"}]'),
    });
    await page.getByTestId("loaded-file").filter({ hasText: "broken.json" }).waitFor();
    await page.getByLabel("Log format").selectOption("windows");
    await page.getByRole("button", { name: "Analyze logs" }).click();
    const banner = page.getByRole("alert").filter({ hasText: "could not parse logs" });
    await banner.waitFor();
  });

  test("deletes an analysis", async () => {
    await page.getByRole("button", { name: "Delete Strict brute-force threshold" }).click();
    await page.getByTestId("history").locator(".history-item", { hasText: "Strict brute-force threshold" })
      .waitFor({ state: "detached" });
    assert.equal(await page.getByTestId("history").locator("li").count(), 1);
  });

  test("no JavaScript errors or CSP violations in the browser", () => {
    // The invalid upload above returns a 400, which the browser logs as a failed request; that one is expected.
    const unexpected = pageErrors.filter((e) => !/status of 400/.test(e));
    assert.deepEqual(unexpected, []);
  });
});
