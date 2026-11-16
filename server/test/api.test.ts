import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";

import { createApp } from "../app.ts";
import { AnalysisStore } from "../db.ts";
import { FakeAnalyzer, listen, postJson } from "./helpers.ts";

const VALID = { name: "Server auth log", format: "linux", logs: "Nov 16 09:00:01 web01 sshd[1]: Failed password ..." };

describe("REST API", () => {
  let base: string;
  let server: Server;
  let analyzer: FakeAnalyzer;
  let store: AnalysisStore;

  before(async () => {
    const staticDir = mkdtempSync(join(tmpdir(), "dash-static-"));
    writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>dashboard</title>");
    writeFileSync(join(staticDir, "app.js"), "console.log('hi')");
    analyzer = new FakeAnalyzer();
    store = new AnalysisStore(":memory:");
    ({ url: base, server } = await listen(
      createApp({ store, analyzer, maxBodyBytes: 1024 * 1024, rateLimitPerMinute: 1000, staticDir }),
    ));
  });

  after(() => {
    server.close();
    store.close();
  });

  beforeEach(() => {
    analyzer.mode = "ok";
    analyzer.healthy = true;
  });

  // ---------------------------------------------------------------- health
  test("GET /api/health reports database and analyzer status", async () => {
    let res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok", database: "ok", analyzer: "ok" });

    analyzer.healthy = false;
    res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).analyzer, "unreachable");
  });

  // ------------------------------------------------------------------ CRUD
  test("POST /api/analyses runs the analyzer and saves the result", async () => {
    const res = await postJson(`${base}/api/analyses`, { ...VALID, thresholds: { brute_force_failures: 20 } });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.name, "Server auth log");
    assert.equal(body.alerts, 2);
    assert.equal(body.high_alerts, 1);
    assert.equal(body.result.alerts[0].rule, "brute_force");
    assert.equal(res.headers.get("location"), `/api/analyses/${body.id}`);

    // The name stays in our database; only the analysis input goes to the analyzer.
    const sent = analyzer.calls.at(-1) as Record<string, unknown>;
    assert.equal(sent.name, undefined);
    assert.deepEqual(sent.thresholds, { brute_force_failures: 20 });
  });

  test("a name is generated when none is given", async () => {
    const res = await postJson(`${base}/api/analyses`, { logs: "x" });
    assert.equal(res.status, 201);
    assert.match((await res.json()).name, /^Analysis \d{4}-\d{2}-\d{2}/);
  });

  test("GET /api/analyses lists newest first, GET /:id returns the full result", async () => {
    const created = await (await postJson(`${base}/api/analyses`, { ...VALID, name: "newest" })).json();
    const list = await (await fetch(`${base}/api/analyses`)).json();
    assert.equal(list[0].name, "newest");
    assert.equal(list[0].result, undefined, "list rows should be summaries only");

    const one = await (await fetch(`${base}/api/analyses/${created.id}`)).json();
    assert.equal(one.result.top_failing_ips[0].src_ip, "203.0.113.45");
  });

  test("DELETE /api/analyses/:id removes it", async () => {
    const created = await (await postJson(`${base}/api/analyses`, VALID)).json();
    const del = await fetch(`${base}/api/analyses/${created.id}`, { method: "DELETE" });
    assert.equal(del.status, 204);
    assert.equal((await fetch(`${base}/api/analyses/${created.id}`)).status, 404);
    assert.equal((await fetch(`${base}/api/analyses/${created.id}`, { method: "DELETE" })).status, 404);
  });

  // ------------------------------------------------------------ validation
  const invalidBodies: [string, unknown, RegExp][] = [
    ["missing logs", { name: "x" }, /logs/],
    ["blank logs", { logs: "   " }, /logs must not be empty/],
    ["bad format", { logs: "x", format: "syslog" }, /format/],
    ["unknown field", { logs: "x", admin: true }, /Unrecognized key/],
    ["threshold too small", { logs: "x", thresholds: { window_minutes: 0 } }, /thresholds\.window_minutes/],
    ["unknown threshold", { logs: "x", thresholds: { foo: 1 } }, /Unrecognized key/],
    ["name too long", { logs: "x", name: "a".repeat(121) }, /name/],
  ];
  for (const [label, body, message] of invalidBodies) {
    test(`400 for invalid input: ${label}`, async () => {
      const res = await postJson(`${base}/api/analyses`, body);
      assert.equal(res.status, 400);
      assert.match((await res.json()).message, message);
    });
  }

  test("400 for malformed JSON, 415 for the wrong content type", async () => {
    assert.equal((await postJson(`${base}/api/analyses`, "{not json")).status, 400);
    const res = await fetch(`${base}/api/analyses`, { method: "POST", body: "logs", headers: { "Content-Type": "text/plain" } });
    assert.equal(res.status, 415);
  });

  test("413 when the body is over the size limit", async () => {
    const res = await postJson(`${base}/api/analyses`, { logs: "a".repeat(1024 * 1024 + 10) });
    assert.equal(res.status, 413);
  });

  test("bad ids, unknown routes and wrong methods", async () => {
    assert.equal((await fetch(`${base}/api/analyses/abc`)).status, 400);
    assert.equal((await fetch(`${base}/api/analyses/0`)).status, 400);
    assert.equal((await fetch(`${base}/api/analyses/999999`)).status, 404);
    assert.equal((await fetch(`${base}/api/nope`)).status, 404);
    assert.equal((await fetch(`${base}/api/analyses`, { method: "PUT" })).status, 405);
  });

  // ------------------------------------------------------- analyzer errors
  test("analyzer validation errors are passed back as 400", async () => {
    analyzer.mode = "invalid-logs";
    const res = await postJson(`${base}/api/analyses`, VALID);
    assert.equal(res.status, 400);
    assert.match((await res.json()).message, /could not parse/);
  });

  test("analyzer outage becomes 502 and nothing is saved", async () => {
    const before = (await (await fetch(`${base}/api/analyses?limit=200`)).json()).length;
    analyzer.mode = "down";
    assert.equal((await postJson(`${base}/api/analyses`, VALID)).status, 502);
    const afterCount = (await (await fetch(`${base}/api/analyses?limit=200`)).json()).length;
    assert.equal(afterCount, before);
  });

  // ------------------------------------------------------------- security
  test("security headers are on API and page responses", async () => {
    for (const path of ["/api/analyses", "/"]) {
      const res = await fetch(`${base}${path}`);
      assert.match(res.headers.get("content-security-policy") ?? "", /default-src 'self'/);
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
      assert.equal(res.headers.get("x-frame-options"), "DENY");
    }
  });

  test("serves the React build, with index.html for client-side routes", async () => {
    const js = await fetch(`${base}/app.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get("content-type") ?? "", /javascript/);
    const page = await fetch(`${base}/some/client/route`);
    assert.match(await page.text(), /<title>dashboard<\/title>/);
  });

  test("path traversal can't read files outside the build folder", async () => {
    for (const path of ["/..%2f..%2fetc%2fpasswd", "/%2e%2e/%2e%2e/etc/passwd"]) {
      const res = await fetch(`${base}${path}`);
      const text = await res.text();
      assert.doesNotMatch(text, /root:/);
    }
    assert.equal((await fetch(`${base}/%E0%A4%A`)).status, 400, "malformed percent-encoding is a 400, not a crash");
  });
});

describe("rate limiting", () => {
  test("429 after the per-minute limit", async () => {
    const store = new AnalysisStore(":memory:");
    const { url, server } = await listen(
      createApp({ store, analyzer: new FakeAnalyzer(), maxBodyBytes: 1024, rateLimitPerMinute: 2 }),
    );
    try {
      const codes = [];
      for (let i = 0; i < 3; i++) codes.push((await postJson(`${url}/api/analyses`, { logs: "x" })).status);
      assert.deepEqual(codes, [201, 201, 429]);
    } finally {
      server.close();
      store.close();
    }
  });
});
