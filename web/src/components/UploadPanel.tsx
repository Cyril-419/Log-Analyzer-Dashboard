import { useRef, useState, type DragEvent, type FormEvent } from "react";

import { DEFAULT_THRESHOLDS, type CreateAnalysisRequest, type LogFormat, type Thresholds } from "../../../shared/types.ts";
import { formatBytes } from "../format.ts";

const MAX_BYTES = 5 * 1024 * 1024; // matches the server's limit

const SAMPLES = [
  { file: "auth.log", label: "Linux SSH (auth.log)", format: "linux" },
  { file: "windows_security.json", label: "Windows Security events", format: "windows" },
  { file: "access.log", label: "Web server (access.log)", format: "web" },
] as const;

const THRESHOLD_FIELDS: { key: keyof Thresholds; label: string; help: string }[] = [
  { key: "window_minutes", label: "Window (minutes)", help: "Time window every rule looks at" },
  { key: "brute_force_failures", label: "Brute force: failures", help: "Failed logins from one IP" },
  { key: "spray_distinct_users", label: "Spray: distinct accounts", help: "Different usernames from one IP" },
  { key: "success_after_failures", label: "Success after: failures", help: "Failures before a success is flagged" },
];

interface LoadedLog {
  name: string;
  text: string;
  bytes: number;
}

interface Props {
  busy: boolean;
  onSubmit: (request: CreateAnalysisRequest) => void;
}

export function UploadPanel({ busy, onSubmit }: Props) {
  const [log, setLog] = useState<LoadedLog | null>(null);
  const [name, setName] = useState("");
  const [format, setFormat] = useState<LogFormat>("auto");
  const [thresholds, setThresholds] = useState<Thresholds>(DEFAULT_THRESHOLDS);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function loadFile(file: File) {
    setError(null);
    if (file.size > MAX_BYTES) {
      setError(`${file.name} is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_BYTES)}.`);
      return;
    }
    setLoading(true);
    try {
      const text = await file.text();
      setLog({ name: file.name, text, bytes: file.size });
      setName((current) => current || file.name);
    } finally {
      setLoading(false);
    }
  }

  async function loadSample(file: string, sampleFormat: LogFormat) {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/samples/${file}`);
      if (!res.ok) throw new Error();
      const text = await res.text();
      setLog({ name: file, text, bytes: new Blob([text]).size });
      setName(`Sample: ${file}`);
      setFormat(sampleFormat);
    } catch {
      setError("Couldn't load the sample file.");
    } finally {
      setLoading(false);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void loadFile(file);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!log) return setError("Choose a log file or a sample first.");
    // Only send thresholds that differ from the defaults.
    const changed = Object.fromEntries(
      Object.entries(thresholds).filter(([k, v]) => v !== DEFAULT_THRESHOLDS[k as keyof Thresholds]),
    );
    onSubmit({
      name: name.trim() || log.name,
      format,
      logs: log.text,
      ...(Object.keys(changed).length ? { thresholds: changed } : {}),
    });
  }

  const lineCount = log ? log.text.split("\n").filter(Boolean).length : 0;

  return (
    <form className="panel upload" onSubmit={submit} aria-label="New analysis" aria-busy={loading}>
      <h2>New analysis</h2>

      <div
        className={`dropzone ${dragging ? "dragging" : ""} ${log ? "has-file" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {loading ? (
          <p className="muted">Loading…</p>
        ) : log ? (
          <p data-testid="loaded-file">
            <strong>{log.name}</strong>
            <span className="muted"> · {formatBytes(log.bytes)} · {lineCount.toLocaleString()} lines</span>
          </p>
        ) : (
          <p className="muted">Drop a log file here</p>
        )}
        <button type="button" className="secondary" onClick={() => fileInput.current?.click()}>
          {log ? "Choose another file" : "Choose file"}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".log,.txt,.json,text/plain,application/json"
          hidden
          data-testid="file-input"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadFile(f); e.target.value = ""; }}
        />
      </div>

      <div className="samples">
        <span className="muted">Or try a sample:</span>
        {SAMPLES.map((s) => (
          <button key={s.file} type="button" className="chip" onClick={() => void loadSample(s.file, s.format)}>
            {s.label}
          </button>
        ))}
      </div>

      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="e.g. web01 auth.log, Nov 16" />
      </label>

      <label>
        Log format
        <select value={format} onChange={(e) => setFormat(e.target.value as LogFormat)}>
          <option value="auto">Detect automatically</option>
          <option value="linux">Linux SSH (auth.log / secure)</option>
          <option value="windows">Windows Security (4624/4625 JSON)</option>
          <option value="web">Web server (Apache/Nginx access log)</option>
        </select>
      </label>

      <details className="thresholds">
        <summary>Detection settings</summary>
        <div className="threshold-grid">
          {THRESHOLD_FIELDS.map((f) => (
            <label key={f.key} title={f.help}>
              {f.label}
              <input
                type="number"
                min={1}
                max={100000}
                value={thresholds[f.key]}
                onChange={(e) => setThresholds({ ...thresholds, [f.key]: Math.max(1, Number(e.target.value) || 1) })}
              />
            </label>
          ))}
        </div>
        <button type="button" className="link-button" onClick={() => setThresholds(DEFAULT_THRESHOLDS)}>
          Reset to defaults
        </button>
      </details>

      {error && <p className="error" role="alert">{error}</p>}

      <button type="submit" className="primary" disabled={busy || loading || !log}>
        {busy ? "Analyzing…" : "Analyze logs"}
      </button>
    </form>
  );
}
