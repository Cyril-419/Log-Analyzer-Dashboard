// All settings come from environment variables, with safe defaults for local use.

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer, got "${raw}"`);
  }
  return value;
}

export const config = {
  port: intFromEnv("PORT", 3000),
  host: process.env.HOST || "127.0.0.1",
  // Where the Python analyzer service (python -m loganalyzer serve) is running
  analyzerUrl: (process.env.ANALYZER_URL || "http://127.0.0.1:8080").replace(/\/$/, ""),
  analyzerTimeoutMs: intFromEnv("ANALYZER_TIMEOUT_MS", 30_000),
  dbPath: process.env.DB_PATH || "data/dashboard.db",
  // Largest request body the API accepts. Kept under the analyzer's own 10 MB limit.
  maxBodyBytes: intFromEnv("MAX_BODY_MB", 5) * 1024 * 1024,
  // New analyses allowed per client IP per minute
  rateLimitPerMinute: intFromEnv("RATE_LIMIT_PER_MINUTE", 30),
  staticDir: process.env.STATIC_DIR || "web/dist",
};
