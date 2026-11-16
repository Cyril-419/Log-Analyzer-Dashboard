// Types shared by the Node API and the React frontend.
// They mirror the JSON returned by the Python analyzer's POST /analyze.

export type LogFormat = "auto" | "linux" | "windows" | "web";
export type Severity = "low" | "medium" | "high";

export interface Thresholds {
  window_minutes: number;
  brute_force_failures: number;
  spray_distinct_users: number;
  success_after_failures: number;
}

export interface Alert {
  rule: string;
  severity: Severity;
  src_ip: string | null;
  first_seen: string;
  last_seen: string;
  event_count: number;
  users: string[];
  description: string;
}

export interface AnalysisResult {
  format: string;
  summary: {
    events: number;
    login_failures: number;
    login_successes: number;
    alerts: number;
    elapsed_ms: number;
  };
  thresholds: Thresholds;
  alerts: Alert[];
  top_failing_ips: { src_ip: string; failures: number }[];
}

/** One row in the history list. */
export interface AnalysisSummary {
  id: number;
  name: string;
  created_at: string;
  format: string;
  events: number;
  login_failures: number;
  alerts: number;
  high_alerts: number;
}

/** A saved analysis with its full result. */
export interface Analysis extends AnalysisSummary {
  result: AnalysisResult;
}

/** Body of POST /api/analyses. */
export interface CreateAnalysisRequest {
  name?: string;
  format?: LogFormat;
  year?: number;
  logs: string;
  thresholds?: Partial<Thresholds>;
}

export interface ApiError {
  error: string;
  message: string;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  window_minutes: 5,
  brute_force_failures: 10,
  spray_distinct_users: 5,
  success_after_failures: 5,
};
