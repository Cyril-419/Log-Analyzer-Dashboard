import { useMemo, useState } from "react";

import type { Alert, Severity } from "../../../shared/types.ts";
import { formatDateTime, ruleLabel, SEVERITY_ORDER } from "../format.ts";

type Filter = "all" | Severity;

export function AlertsTable({ alerts }: { alerts: Alert[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<number | null>(null);

  const rows = useMemo(
    () =>
      alerts
        .map((alert, index) => ({ alert, index }))
        .filter(({ alert }) => filter === "all" || alert.severity === filter)
        .sort(
          (a, b) =>
            SEVERITY_ORDER[a.alert.severity] - SEVERITY_ORDER[b.alert.severity] ||
            a.alert.first_seen.localeCompare(b.alert.first_seen),
        ),
    [alerts, filter],
  );

  if (alerts.length === 0) {
    return (
      <section className="panel empty-alerts" aria-label="Alerts">
        <h3>Alerts</h3>
        <p>No attacks detected with the current thresholds. ✅</p>
      </section>
    );
  }

  return (
    <section className="panel" aria-label="Alerts">
      <div className="panel-head">
        <h3>Alerts</h3>
        <div className="segmented" role="group" aria-label="Filter alerts by severity">
          {(["all", "high", "medium", "low"] as Filter[]).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="table-wrap">
        <table className="alerts-table">
          <thead>
            <tr>
              <th>Severity</th>
              <th>Rule</th>
              <th>Source IP</th>
              <th>First seen</th>
              <th className="num">Events</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ alert, index }) => (
              <tr key={index} data-testid="alert-row">
                <td>
                  <span className={`badge badge-${alert.severity}`}>{alert.severity}</span>
                </td>
                <td>{ruleLabel(alert.rule)}</td>
                <td className="mono">{alert.src_ip ?? "—"}</td>
                <td>{formatDateTime(alert.first_seen)}</td>
                <td className="num">{alert.event_count}</td>
                <td className="details">
                  <span>{alert.description}</span>
                  {alert.users.length > 0 && (
                    <button
                      type="button"
                      className="link-button"
                      aria-expanded={expanded === index}
                      onClick={() => setExpanded(expanded === index ? null : index)}
                    >
                      {expanded === index ? "Hide accounts" : `${alert.users.length} account(s)`}
                    </button>
                  )}
                  {expanded === index && (
                    <ul className="users">
                      {alert.users.map((u) => (
                        <li key={u} className="mono">{u}</li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="muted pad">No {filter} severity alerts.</p>}
      </div>
    </section>
  );
}
