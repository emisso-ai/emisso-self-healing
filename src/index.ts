export type {
  SelfHealingConfig,
  DetectedIssue,
  AnalysisResult,
  FilePatch,
  TestResult,
  PRResult,
  HealingNotification,
  HealingStatus,
  HealingEvent,
  HealingEventListener,
  TokenUsage,
  CostEstimate,
  Severity,
  IssueSource,
  VercelLogEntry,
  SupabaseLogEntry,
  SlowQuery,
  SupabaseMonitorConfig,
} from "./types.js";

export { SelfHealingConfigSchema } from "./types.js";

export { DeduplicationWindow } from "./ingestion/dedup.js";
export { parseVercelLogs, verifyVercelSignature } from "./ingestion/vercel-drain.js";
export { detectSlowQueries, fetchSupabaseLogs, parseSupabaseWebhook } from "./ingestion/supabase-monitor.js";

export { triageIssue, prioritizeIssues } from "./analysis/triage.js";
export type { TriageDecision } from "./analysis/triage.js";
export { analyzeIssue } from "./analysis/claude-analyzer.js";

export { testFixInSandbox } from "./sandbox/runner.js";
export { createFixPR } from "./repair/github.js";

export { notifyAll, sendSlackNotification, sendDiscordNotification } from "./notify/index.js";

export { HealingPipeline } from "./pipeline.js";
