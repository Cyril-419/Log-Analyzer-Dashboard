import { useCallback, useEffect, useState } from "react";

import type { Analysis, AnalysisSummary, CreateAnalysisRequest } from "../../shared/types.ts";
import { api } from "./api.ts";
import { AlertsTable } from "./components/AlertsTable.tsx";
import { BarChart } from "./components/BarChart.tsx";
import { HistoryList } from "./components/HistoryList.tsx";
import { SummaryCards } from "./components/SummaryCards.tsx";
import { UploadPanel } from "./components/UploadPanel.tsx";
import { formatDateTime, ruleLabel } from "./format.ts";

type Health = "checking" | "ok" | "analyzer-down" | "server-down";

export function App() {
  const [history, setHistory] = useState<AnalysisSummary[]>([]);
  const [selected, setSelected] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health>("checking");

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await api.listAnalyses());
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void refreshHistory();
    api.health()
      .then(() => setHealth("ok"))
      .catch((err) => setHealth(err.status === 503 ? "analyzer-down" : "server-down"));
  }, [refreshHistory]);

  async function runAnalysis(request: CreateAnalysisRequest) {
    setBusy(true);
    setError(null);
    try {
      const analysis = await api.createAnalysis(request);
      setSelected(analysis);
      setHealth("ok");
      await refreshHistory();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function openAnalysis(id: number) {
    setError(null);
    try {
      setSelected(await api.getAnalysis(id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function removeAnalysis(id: number) {
    const item = history.find((h) => h.id === id);
    if (!window.confirm(`Delete "${item?.name ?? "this analysis"}"?`)) return;
    try {
      await api.deleteAnalysis(id);
      if (selected?.id === id) setSelected(null);
      await refreshHistory();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const result = selected?.result;
  const alertsByRule = result
    ? Object.entries(
        result.alerts.reduce<Record<string, number>>((acc, a) => ({ ...acc, [a.rule]: (acc[a.rule] ?? 0) + 1 }), {}),
      ).map(([rule, value]) => ({
        label: ruleLabel(rule),
        value,
        tone: rule === "brute_force" ? ("medium" as const) : ("high" as const),
      }))
    : [];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">🛡️</span>
          <div>
            <h1>Log Analyzer Dashboard</h1>
            <p className="muted">Detect brute force, password spraying and suspicious logins</p>
          </div>
        </div>
        <span className={`status status-${health}`} role="status" data-testid="health">
          {health === "checking" && "Checking services…"}
          {health === "ok" && "All services online"}
          {health === "analyzer-down" && "Analyzer service offline"}
          {health === "server-down" && "Server unreachable"}
        </span>
      </header>

      <main className="layout">
        <aside className="sidebar">
          <UploadPanel busy={busy} onSubmit={runAnalysis} />
          <HistoryList items={history} selectedId={selected?.id ?? null} onSelect={openAnalysis} onDelete={removeAnalysis} />
        </aside>

        <section className="results" aria-live="polite">
          {error && (
            <div className="banner banner-error" role="alert">
              <strong>Something went wrong:</strong> {error}
              <button type="button" className="icon-button" aria-label="Dismiss error" onClick={() => setError(null)}>✕</button>
            </div>
          )}

          {!selected || !result ? (
            <div className="panel empty-state">
              <h2>No analysis selected</h2>
              <p className="muted">
                Upload a Linux, Windows or web server log, or try one of the samples. Results are saved, so you can
                come back to them from History.
              </p>
            </div>
          ) : (
            <>
              <div className="results-head">
                <div>
                  <h2 data-testid="analysis-title">{selected.name}</h2>
                  <p className="muted">
                    {formatDateTime(selected.created_at)} · {result.format} format · analyzed in {result.summary.elapsed_ms} ms ·
                    window {result.thresholds.window_minutes} min
                  </p>
                </div>
              </div>

              <SummaryCards result={result} />

              <div className="charts">
                <BarChart title="Alerts by rule" bars={alertsByRule} emptyText="No alerts." />
                <BarChart
                  title="Top sources of failed logins"
                  bars={result.top_failing_ips.map((ip) => ({ label: ip.src_ip, value: ip.failures }))}
                  emptyText="No failed logins."
                />
              </div>

              <AlertsTable alerts={result.alerts} />
            </>
          )}
        </section>
      </main>
    </div>
  );
}
