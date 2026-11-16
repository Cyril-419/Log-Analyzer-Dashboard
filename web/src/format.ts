// Small display helpers, kept separate so they're easy to reuse and test.

export const RULE_LABELS: Record<string, string> = {
  brute_force: "Brute force",
  password_spray: "Password spray",
  success_after_failures: "Success after failures",
};

export const ruleLabel = (rule: string) => RULE_LABELS[rule] ?? rule.replace(/_/g, " ");

export const formatNumber = (n: number) => n.toLocaleString();

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const;
