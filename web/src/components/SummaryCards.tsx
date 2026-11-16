import type { AnalysisResult } from "../../../shared/types.ts";
import { formatNumber } from "../format.ts";

export function SummaryCards({ result }: { result: AnalysisResult }) {
  const high = result.alerts.filter((a) => a.severity === "high").length;
  const { summary } = result;
  const failRate = summary.events ? Math.round((summary.login_failures / summary.events) * 100) : 0;

  const cards = [
    { label: "Events parsed", value: formatNumber(summary.events) },
    { label: "Failed logins", value: formatNumber(summary.login_failures), note: `${failRate}% of events` },
    { label: "Successful logins", value: formatNumber(summary.login_successes) },
    { label: "Alerts", value: formatNumber(result.alerts.length), tone: result.alerts.length ? "warn" : "ok" },
    { label: "High severity", value: formatNumber(high), tone: high ? "danger" : "ok" },
  ];

  return (
    <div className="cards" data-testid="summary-cards">
      {cards.map((c) => (
        <div key={c.label} className={`card ${c.tone ? `card-${c.tone}` : ""}`}>
          <span className="card-label">{c.label}</span>
          <span className="card-value">{c.value}</span>
          {c.note && <span className="card-note">{c.note}</span>}
        </div>
      ))}
    </div>
  );
}
