import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { Analysis, AnalysisResult, AnalysisSummary } from "../shared/types.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS analyses (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  created_at     TEXT    NOT NULL,
  format         TEXT    NOT NULL,
  events         INTEGER NOT NULL,
  login_failures INTEGER NOT NULL,
  alerts         INTEGER NOT NULL,
  high_alerts    INTEGER NOT NULL,
  result_json    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analyses_created ON analyses(created_at);
`;

const SUMMARY_COLUMNS = "id, name, created_at, format, events, login_failures, alerts, high_alerts";

/** Saves analysis results in SQLite. Every query uses ? placeholders (no SQL injection). */
export class AnalysisStore {
  private db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA);
  }

  create(name: string, result: AnalysisResult): AnalysisSummary {
    const createdAt = new Date().toISOString();
    const highAlerts = result.alerts.filter((a) => a.severity === "high").length;
    const info = this.db
      .prepare(
        `INSERT INTO analyses (name, created_at, format, events, login_failures, alerts, high_alerts, result_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        name,
        createdAt,
        result.format,
        result.summary.events,
        result.summary.login_failures,
        result.alerts.length,
        highAlerts,
        JSON.stringify(result),
      );
    return this.getSummary(Number(info.lastInsertRowid))!;
  }

  list(limit = 50): AnalysisSummary[] {
    return this.db
      .prepare(`SELECT ${SUMMARY_COLUMNS} FROM analyses ORDER BY id DESC LIMIT ?`)
      .all(limit) as unknown as AnalysisSummary[];
  }

  get(id: number): Analysis | undefined {
    const row = this.db
      .prepare(`SELECT ${SUMMARY_COLUMNS}, result_json FROM analyses WHERE id = ?`)
      .get(id) as (AnalysisSummary & { result_json: string }) | undefined;
    if (!row) return undefined;
    const { result_json, ...summary } = row;
    return { ...summary, result: JSON.parse(result_json) as AnalysisResult };
  }

  delete(id: number): boolean {
    return Number(this.db.prepare("DELETE FROM analyses WHERE id = ?").run(id).changes) > 0;
  }

  /** Used by the health check. */
  ping(): boolean {
    return this.db.prepare("SELECT 1 AS ok").get() !== undefined;
  }

  close(): void {
    this.db.close();
  }

  private getSummary(id: number): AnalysisSummary | undefined {
    return this.db.prepare(`SELECT ${SUMMARY_COLUMNS} FROM analyses WHERE id = ?`).get(id) as
      | AnalysisSummary
      | undefined;
  }
}
