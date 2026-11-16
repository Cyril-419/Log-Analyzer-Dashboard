import { createServer } from "node:http";

import { createHttpAnalyzer } from "./analyzerClient.ts";
import { createApp } from "./app.ts";
import { config } from "./config.ts";
import { AnalysisStore } from "./db.ts";

const store = new AnalysisStore(config.dbPath);
const analyzer = createHttpAnalyzer(config.analyzerUrl, config.analyzerTimeoutMs);

const server = createServer(
  createApp({
    store,
    analyzer,
    maxBodyBytes: config.maxBodyBytes,
    rateLimitPerMinute: config.rateLimitPerMinute,
    staticDir: config.staticDir,
  }),
);

server.listen(config.port, config.host, async () => {
  console.log(`Dashboard running at http://${config.host}:${config.port}`);
  const ok = await analyzer.health();
  console.log(
    ok
      ? `Connected to analyzer at ${config.analyzerUrl}`
      : `WARNING: analyzer not reachable at ${config.analyzerUrl}. Start it with: python -m loganalyzer serve`,
  );
});

// Close the database cleanly on Ctrl+C or when a container is stopped.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
}
