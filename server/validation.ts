import { z } from "zod";

const threshold = z.number().int().min(1).max(100_000);

/** What the browser is allowed to send to POST /api/analyses. */
export const createAnalysisSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    format: z.enum(["auto", "linux", "windows", "web"]).default("auto"),
    year: z.number().int().min(1970).max(2100).optional(),
    logs: z.string().refine((s) => s.trim().length > 0, "logs must not be empty"),
    thresholds: z
      .object({
        window_minutes: threshold.optional(),
        brute_force_failures: threshold.optional(),
        spray_distinct_users: threshold.optional(),
        success_after_failures: threshold.optional(),
      })
      .strict()
      .optional(),
  })
  .strict(); // reject unknown fields instead of silently ignoring them

export type CreateAnalysisInput = z.infer<typeof createAnalysisSchema>;

/**
 * The analyzer is a separate service, so its responses are checked too.
 * If it ever returns something unexpected, the API fails cleanly instead of
 * storing bad data.
 */
export const analysisResultSchema = z.object({
  format: z.string(),
  summary: z.object({
    events: z.number(),
    login_failures: z.number(),
    login_successes: z.number(),
    alerts: z.number(),
    elapsed_ms: z.number(),
  }),
  thresholds: z.object({
    window_minutes: z.number(),
    brute_force_failures: z.number(),
    spray_distinct_users: z.number(),
    success_after_failures: z.number(),
  }),
  alerts: z.array(
    z.object({
      rule: z.string(),
      severity: z.enum(["low", "medium", "high"]),
      src_ip: z.string().nullable(),
      first_seen: z.string(),
      last_seen: z.string(),
      event_count: z.number(),
      users: z.array(z.string()),
      description: z.string(),
    }),
  ),
  top_failing_ips: z.array(z.object({ src_ip: z.string(), failures: z.number() })),
});

/** Turn zod's error list into one readable sentence. */
export function describeZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => (issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message))
    .join("; ");
}
