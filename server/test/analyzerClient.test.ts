import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { after, before, describe, test } from "node:test";

import { AnalyzerError, createHttpAnalyzer } from "../analyzerClient.ts";
import { RateLimiter } from "../rateLimit.ts";
import { listen, SAMPLE_RESULT } from "./helpers.ts";

/** A fake Python service whose behavior depends on the "logs" text it receives. */
async function fakeService(req: IncomingMessage, res: ServerResponse) {
  if (req.url === "/health") return void res.end('{"status":"ok"}');
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const { logs } = JSON.parse(raw);
  const reply = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (logs === "bad-input") return reply(400, { error: "Bad Request", message: "could not parse logs as linux" });
  if (logs === "crash") return reply(500, { error: "Internal Server Error" });
  if (logs === "wrong-shape") return reply(200, { hello: "world" });
  if (logs === "slow") return void setTimeout(() => reply(200, SAMPLE_RESULT), 500);
  return reply(200, SAMPLE_RESULT);
}

describe("analyzer client", () => {
  let url: string;
  let close: () => void;

  before(async () => {
    const started = await listen((req, res) => void fakeService(req, res));
    url = started.url;
    close = () => started.server.close();
  });
  after(() => close());

  const client = () => createHttpAnalyzer(url, 200);

  async function expectError(logs: string, status: number, message: RegExp) {
    await assert.rejects(client().analyze({ logs, format: "auto" }), (err: unknown) => {
      assert.ok(err instanceof AnalyzerError);
      assert.equal(err.status, status);
      assert.match(err.message, message);
      return true;
    });
  }

  test("returns a validated result", async () => {
    const result = await client().analyze({ logs: "ok", format: "linux" });
    assert.equal(result.alerts.length, 2);
  });

  test("passes the analyzer's 400 message through", () => expectError("bad-input", 400, /could not parse/));
  test("analyzer 500 becomes 502", () => expectError("crash", 502, /HTTP 500/));
  test("unexpected response shape becomes 502", () => expectError("wrong-shape", 502, /unexpected response/));
  test("slow analyzer becomes 504", () => expectError("slow", 504, /too long/));

  test("unreachable analyzer becomes 502 and health() is false", async () => {
    const dead = createHttpAnalyzer("http://127.0.0.1:9", 500);
    await assert.rejects(dead.analyze({ logs: "x", format: "auto" }), /unavailable/);
    assert.equal(await dead.health(), false);
    assert.equal(await client().health(), true);
  });
});

describe("rate limiter", () => {
  test("allows `limit` requests per window per client", () => {
    const limiter = new RateLimiter(2, 1000);
    assert.deepEqual([limiter.allow("a", 0), limiter.allow("a", 1), limiter.allow("a", 2)], [true, true, false]);
    assert.equal(limiter.allow("b", 2), true, "other clients are counted separately");
    assert.equal(limiter.allow("a", 1000), true, "a new window resets the count");
  });

  test("a limit of 0 disables it", () => {
    const limiter = new RateLimiter(0, 1000);
    assert.ok(Array.from({ length: 50 }, () => limiter.allow("a")).every(Boolean));
  });
});
