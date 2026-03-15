/**
 * @emisso/self-healing
 *
 * Self-healing SDK for Next.js + Supabase + Vercel applications.
 * Monitors production errors, generates AI-powered fixes, tests them
 * in sandboxed environments, and creates PRs with human approval.
 */

export { HealingPipeline } from "./pipeline";
export { SelfHealingConfigSchema } from "./types";
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
  Severity,
  IssueSource,
  TokenUsage,
  CostEstimate,
  VercelLogEntry,
  SupabaseLogEntry,
  SlowQuery,
} from "./types";

// Ingestion
export {
  parseVercelLogs,
  verifyVercelSignature,
  detectSlowQueries,
  fetchSupabaseLogs,
  parseSupabaseWebhook,
  DeduplicationWindow,
} from "./ingestion";

// Analysis
export { analyzeIssue, triageIssue, prioritizeIssues } from "./analysis";
export type { TriageDecision } from "./analysis";

// Sandbox
export { testFixInSandbox } from "./sandbox";

// Repair
export { createFixPR } from "./repair";

// Notifications
export { sendSlackNotification, sendDiscordNotification, notifyAll } from "./notify";
