import type { AnalysisResult } from "../shared/types.ts";
import { analysisResultSchema, type CreateAnalysisInput } from "./validation.ts";

/** Something went wrong talking to the analyzer. `status` is what our API should return. */
export class AnalyzerError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AnalyzerError";
    this.status = status;
  }
}

export interface AnalyzerClient {
  analyze(input: Omit<CreateAnalysisInput, "name">): Promise<AnalysisResult>;
  health(): Promise<boolean>;
}

/** Client for the Python analyzer's REST API (python -m loganalyzer serve). */
export function createHttpAnalyzer(baseUrl: string, timeoutMs: number): AnalyzerClient {
  return {
    async analyze(input) {
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        if (err instanceof Error && err.name === "TimeoutError") {
          throw new AnalyzerError(504, "the analyzer service took too long to respond");
        }
        throw new AnalyzerError(502, "the analyzer service is unavailable");
      }

      const body: unknown = await response.json().catch(() => null);

      // 400 from the analyzer means the logs or settings were invalid: the user can fix that.
      if (response.status === 400) {
        const message = (body as { message?: unknown } | null)?.message;
        throw new AnalyzerError(400, typeof message === "string" ? message : "the analyzer rejected the logs");
      }
      if (!response.ok) {
        throw new AnalyzerError(502, `the analyzer service returned an error (HTTP ${response.status})`);
      }

      const parsed = analysisResultSchema.safeParse(body);
      if (!parsed.success) {
        throw new AnalyzerError(502, "the analyzer service returned an unexpected response");
      }
      return parsed.data;
    },

    async health() {
      try {
        const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}
