import type { DetectedIssue, Severity, SupabaseMonitorConfig, SlowQuery } from "../types.js";
import { createIssueId } from "./dedup.js";

export async function detectSlowQueries(config: SupabaseMonitorConfig): Promise<DetectedIssue[]> {
  const slowQueries = await querySlowQueriesView(config);
  return slowQueries.map((sq) => ({
    id: createIssueId("supabase-slow-query", sq.queryId),
    title: `Slow query: ${sq.query.substring(0, 80)}...`,
    source: "supabase-postgres" as const,
    severity: (sq.meanExecTimeMs > 5000 ? "critical" : "warning") as Severity,
    message: `Query averaging ${Math.round(sq.meanExecTimeMs)}ms over ${sq.calls} calls (max: ${Math.round(sq.maxExecTimeMs)}ms)`,
    occurrenceCount: sq.calls,
    firstSeen: new Date(),
    lastSeen: new Date(),
    context: {
      queryId: sq.queryId,
      query: sq.query,
      meanExecTimeMs: sq.meanExecTimeMs,
      maxExecTimeMs: sq.maxExecTimeMs,
      totalExecTimeMs: sq.totalExecTimeMs,
    },
  }));
}

export async function fetchSupabaseLogs(config: SupabaseMonitorConfig): Promise<DetectedIssue[]> {
  if (!config.projectRef || !config.managementToken) return [];

  const response = await fetch(
    `https://api.supabase.com/v1/projects/${config.projectRef}/analytics/endpoints/logs.all?iso_timestamp_start=${getTimeWindowStart()}`,
    { headers: { Authorization: `Bearer ${config.managementToken}` } },
  );

  if (!response.ok) {
    console.warn(`[self-healing] Failed to fetch Supabase logs: ${response.status}`);
    return [];
  }

  const data = (await response.json()) as { result?: Array<{ id: string; timestamp: string; event_message: string; metadata: Record<string, unknown> }> };
  const entries = data.result ?? [];

  return entries
    .filter((e) => isSupabaseError(e))
    .map((entry) => ({
      id: createIssueId("supabase-log", entry.id),
      title: entry.event_message.substring(0, 120),
      source: inferSupabaseSource(entry) as DetectedIssue["source"],
      severity: "error" as const,
      message: entry.event_message,
      occurrenceCount: 1,
      firstSeen: new Date(entry.timestamp),
      lastSeen: new Date(entry.timestamp),
      rawData: entry,
    }));
}

export function parseSupabaseWebhook(payload: {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: string;
  record: Record<string, unknown>;
  old_record?: Record<string, unknown>;
}): DetectedIssue | null {
  if (payload.type !== "INSERT") return null;

  const record = payload.record;
  const message = (record.message ?? record.error ?? record.event_message) as string | undefined;
  if (!message) return null;

  return {
    id: createIssueId("supabase-webhook", `${payload.table}:${(record.id as string) ?? Date.now()}`),
    title: message.substring(0, 120),
    source: "supabase-postgres",
    severity: inferSeverityFromRecord(record),
    message,
    stackTrace: record.stack_trace as string | undefined,
    occurrenceCount: 1,
    firstSeen: new Date(),
    lastSeen: new Date(),
    rawData: payload,
  };
}

async function querySlowQueriesView(config: SupabaseMonitorConfig): Promise<SlowQuery[]> {
  const thresholdMs = config.slowQueryThresholdMs ?? 1000;
  try {
    const response = await fetch(`${config.url}/rest/v1/rpc/get_slow_queries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: config.serviceKey,
        Authorization: `Bearer ${config.serviceKey}`,
      },
      body: JSON.stringify({ threshold_ms: thresholdMs }),
    });
    if (!response.ok) return [];
    const data = (await response.json()) as Array<{
      query_id: string; query: string; calls: number;
      mean_exec_time_ms: number; max_exec_time_ms: number; total_exec_time_ms: number;
    }>;
    return data.map((row) => ({
      queryId: row.query_id,
      query: row.query,
      calls: row.calls,
      meanExecTimeMs: row.mean_exec_time_ms,
      maxExecTimeMs: row.max_exec_time_ms,
      totalExecTimeMs: row.total_exec_time_ms,
    }));
  } catch {
    return [];
  }
}

function getTimeWindowStart(): string {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  return fiveMinutesAgo.toISOString();
}

function isSupabaseError(entry: { event_message: string }): boolean {
  const msg = entry.event_message.toLowerCase();
  return msg.includes("error") || msg.includes("fatal") || msg.includes("panic") || msg.includes("exception");
}

function inferSupabaseSource(entry: { metadata: Record<string, unknown> }): string {
  const source = (entry.metadata?.source as string) ?? "";
  if (source === "edge-function") return "supabase-edge-function";
  if (source === "auth") return "supabase-auth";
  if (source === "postgres") return "supabase-postgres";
  return "supabase-postgres";
}

function inferSeverityFromRecord(record: Record<string, unknown>): Severity {
  const level = ((record.level ?? record.severity ?? "error") as string).toLowerCase();
  switch (level) {
    case "critical":
    case "fatal":
      return "critical";
    case "error":
      return "error";
    case "warning":
    case "warn":
      return "warning";
    default:
      return "info";
  }
}
