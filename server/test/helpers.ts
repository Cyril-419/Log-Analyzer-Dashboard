import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { AnalysisResult } from "../../shared/types.ts";
import { AnalyzerError, type AnalyzerClient } from "../analyzerClient.ts";

export const SAMPLE_RESULT: AnalysisResult = {
  format: "linux",
  summary: { events: 120, login_failures: 45, login_successes: 75, alerts: 2, elapsed_ms: 1.2 },
  thresholds: { window_minutes: 5, brute_force_failures: 10, spray_distinct_users: 5, success_after_failures: 5 },
  alerts: [
    {
      rule: "brute_force", severity: "medium", src_ip: "203.0.113.45",
      first_seen: "2026-11-16T03:00:00", last_seen: "2026-11-16T03:00:27",
      event_count: 10, users: ["root"], description: "10 failed logins from 203.0.113.45 within 5 min",
    },
    {
      rule: "password_spray", severity: "high", src_ip: "198.51.100.23",
      first_seen: "2026-11-16T09:00:00", last_seen: "2026-11-16T09:01:20",
      event_count: 5, users: ["admin", "guest", "root", "test", "user"],
      description: "198.51.100.23 tried 5 different accounts within 5 min",
    },
  ],
  top_failing_ips: [{ src_ip: "203.0.113.45", failures: 40 }],
};

/** A stand-in for the Python service. Set `mode` to make it misbehave on purpose. */
export class FakeAnalyzer implements AnalyzerClient {
  mode: "ok" | "invalid-logs" | "down" = "ok";
  healthy = true;
  calls: unknown[] = [];

  async analyze(input: unknown): Promise<AnalysisResult> {
    this.calls.push(input);
    if (this.mode === "invalid-logs") throw new AnalyzerError(400, "could not parse logs as windows");
    if (this.mode === "down") throw new AnalyzerError(502, "the analyzer service is unavailable");
    return structuredClone(SAMPLE_RESULT);
  }

  async health(): Promise<boolean> {
    return this.healthy;
  }
}

/** Start a handler on a random free port and return its base URL. */
export async function listen(handler: RequestListener): Promise<{ url: string; server: Server }> {
  const server = createServer(handler);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, server };
}

export function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
