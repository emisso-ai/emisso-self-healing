/**
 * @emisso/self-healing — Core type definitions
 *
 * Types for the self-healing pipeline:
 *   Ingest → Analyze → Fix → Test → PR → Notify
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Config Schema
// ---------------------------------------------------------------------------

export const SelfHealingConfigSchema = z.object({
  /** GitHub repository configuration */
  github: z.object({
    owner: z.string(),
    repo: z.string(),
    token: z.string(),
    baseBranch: z.string().default("main"),
  }),
  /** Claude AI configuration */
  claude: z.object({
    apiKey: z.string(),
    model: z.string().default("claude-sonnet-4-6"),
    maxTurns: z.number().default(30),
  }),
  /** Vercel Sandbox configuration for testing fixes */
  sandbox: z.object({
    runtime: z.enum(["node22", "node24"]).default("node24"),
    testCommand: z.string().default("npm test -- --run"),
    buildCommand: z.string().optional(),
    timeout: z.number().default(300_000),
    snapshotId: z.string().optional(),
  }),
  /** Monitoring sources */
  sources: z.object({
    vercel: z
      .object({
        token: z.string(),
        projectId: z.string(),
        teamId: z.string().optional(),
      })
      .optional(),
    supabase: z
      .object({
        url: z.string(),
        serviceKey: z.string(),
        projectRef: z.string().optional(),
      })
      .optional(),
  }),
  /** Notification channels */
  notifications: z
    .object({
      slack: z
        .object({
          token: z.string().optional(),
          webhookUrl: z.string().optional(),
          channel: z.string(),
          approvalRequired: z.boolean().default(true),
        })
        .optional(),
      discord: z
        .object({
          webhookUrl: z.string(),
        })
        .optional(),
      custom: z
        .object({
          webhookUrl: z.string(),
          headers: z.record(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),
  /** Safety guardrails */
  safety: z
    .object({
      maxPRsPerHour: z.number().default(3),
      minConfidence: z.number().min(0).max(1).default(0.8),
      excludePaths: z
        .array(z.string())
        .default(["migrations/", ".env", "secrets/", "*.key", "*.pem"]),
      requireTests: z.boolean().default(true),
      autoMerge: z.boolean().default(false),
      dryRun: z.boolean().default(false),
    })
    .default({}),
});

export type SelfHealingConfig = z.infer<typeof SelfHealingConfigSchema>;

// ---------------------------------------------------------------------------
// Domain Types
// ---------------------------------------------------------------------------

export type Severity = "critical" | "error" | "warning" | "info";

export type IssueSource =
  | "vercel-runtime"
  | "vercel-build"
  | "vercel-edge"
  | "supabase-postgres"
  | "supabase-edge-function"
  | "supabase-auth"
  | "supabase-rls"
  | "custom";

export interface DetectedIssue {
  id: string;
  title: string;
  source: IssueSource;
  severity: Severity;
  message: string;
  stackTrace?: string;
  filePath?: string;
  lineNumber?: number;
  occurrenceCount: number;
  affectedUsers?: number;
  firstSeen: Date;
  lastSeen: Date;
  rawData?: unknown;
  context?: Record<string, unknown>;
}

export interface AnalysisResult {
  issue: DetectedIssue;
  rootCause: string;
  confidence: number;
  fix: FilePatch[];
  fixExplanation: string;
  prTitle: string;
  prBody: string;
  tokenUsage?: TokenUsage;
  durationMs: number;
  filesExplored: string[];
}

export interface FilePatch {
  filePath: string;
  action: "create" | "modify" | "delete";
  content?: string;
  diff?: string;
}

export interface TestResult {
  passed: boolean;
  exitCode: number;
  output: string;
  errorOutput: string;
  durationMs: number;
  sandboxId: string;
  buildPassed?: boolean;
}

export interface PRResult {
  number: number;
  url: string;
  branch: string;
  title: string;
  created: boolean;
}

export interface HealingNotification {
  issue: DetectedIssue;
  analysis?: AnalysisResult;
  testResult?: TestResult;
  pr?: PRResult;
  status: HealingStatus;
  summary: string;
  timestamp: Date;
  costEstimate?: CostEstimate;
}

export type HealingStatus =
  | "detected"
  | "analyzing"
  | "fix-generated"
  | "testing"
  | "test-passed"
  | "test-failed"
  | "pr-created"
  | "approved"
  | "merged"
  | "rejected"
  | "skipped"
  | "failed";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

export interface CostEstimate {
  claudeApiCost: number;
  sandboxCost: number;
  totalCost: number;
  currency: "USD";
}

export type HealingEvent =
  | { type: "issue:detected"; issue: DetectedIssue }
  | { type: "issue:skipped"; issue: DetectedIssue; reason: string }
  | { type: "analysis:started"; issue: DetectedIssue }
  | { type: "analysis:completed"; result: AnalysisResult }
  | { type: "analysis:failed"; issue: DetectedIssue; error: Error }
  | { type: "test:started"; analysis: AnalysisResult }
  | { type: "test:completed"; result: TestResult }
  | { type: "test:failed"; error: Error }
  | { type: "pr:created"; pr: PRResult }
  | { type: "pr:failed"; error: Error }
  | { type: "notification:sent"; channel: string }
  | { type: "notification:failed"; channel: string; error: Error }
  | { type: "pipeline:completed"; notification: HealingNotification }
  | { type: "pipeline:error"; error: Error };

export type HealingEventListener = (event: HealingEvent) => void;

export interface VercelLogEntry {
  id: string;
  message: string;
  timestamp: number;
  source: "lambda" | "edge" | "static" | "build";
  projectId: string;
  deploymentId: string;
  level: "info" | "warning" | "error";
  proxy?: {
    statusCode: number;
    method: string;
    path: string;
    userAgent?: string[];
    host?: string;
  };
}

export interface SupabaseLogEntry {
  id: string;
  timestamp: string;
  event_message: string;
  metadata: Record<string, unknown>;
}

export interface SlowQuery {
  queryId: string;
  query: string;
  calls: number;
  meanExecTimeMs: number;
  maxExecTimeMs: number;
  totalExecTimeMs: number;
}

export interface SupabaseMonitorConfig {
  url: string;
  serviceKey: string;
  projectRef?: string;
  managementToken?: string;
  slowQueryThresholdMs?: number;
}
