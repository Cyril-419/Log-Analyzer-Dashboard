import type { Analysis, AnalysisSummary, ApiError, CreateAnalysisRequest } from "../../shared/types.ts";

/** Error carrying the message the API sent back, so the UI can show it. */
export class ApiRequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiRequestError(0, "Can't reach the dashboard server. Is it running?");
  }
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as T | ApiError | null;
  if (!res.ok) {
    const message = (body as ApiError | null)?.message ?? `Request failed (HTTP ${res.status})`;
    throw new ApiRequestError(res.status, message);
  }
  return body as T;
}

export const api = {
  listAnalyses: () => request<AnalysisSummary[]>("/api/analyses"),
  getAnalysis: (id: number) => request<Analysis>(`/api/analyses/${id}`),
  deleteAnalysis: (id: number) => request<void>(`/api/analyses/${id}`, { method: "DELETE" }),
  createAnalysis: (body: CreateAnalysisRequest) =>
    request<Analysis>("/api/analyses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  health: () => request<{ status: string; database: string; analyzer: string }>("/api/health"),
};
