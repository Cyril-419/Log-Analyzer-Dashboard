import type { AnalysisSummary } from "../../../shared/types.ts";
import { formatDateTime, formatNumber } from "../format.ts";

interface Props {
  items: AnalysisSummary[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
}

export function HistoryList({ items, selectedId, onSelect, onDelete }: Props) {
  return (
    <section className="panel" aria-label="Saved analyses">
      <h2>History</h2>
      {items.length === 0 ? (
        <p className="muted">Analyses you run are saved here.</p>
      ) : (
        <ul className="history" data-testid="history">
          {items.map((item) => (
            <li key={item.id} className={item.id === selectedId ? "selected" : ""}>
              <button type="button" className="history-item" onClick={() => onSelect(item.id)}
                      aria-current={item.id === selectedId ? "true" : undefined}>
                <span className="history-name">{item.name}</span>
                <span className="history-meta">
                  {formatDateTime(item.created_at)} · {item.format} · {formatNumber(item.events)} events
                </span>
              </button>
              <span className={`count ${item.high_alerts ? "count-high" : item.alerts ? "count-medium" : ""}`}
                    title={`${item.alerts} alert(s), ${item.high_alerts} high`}>
                {item.alerts}
              </span>
              <button type="button" className="icon-button" aria-label={`Delete ${item.name}`}
                      onClick={() => onDelete(item.id)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
