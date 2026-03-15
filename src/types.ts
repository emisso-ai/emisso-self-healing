/**
 * @emisso/self-healing — Core type definitions
 *
 * Types for the self-healing pipeline:
 *   Ingest → Analyze → Fix → Test → PR → Notify
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Configuration
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
    vercel: z.object({
      token: z.string(),
      projectId: z.string(),
      teamId: z.string().optional(),
    }).optional(),
    supabase: z.object({
      url: z.string(),
      serviceKey: z.string(),
      projectRef: z.string().optional(),
    }).optional(),
  }),

  /** Notification channels */
  notifications: z.object({
    slack: z.object({
      token: z.string().optional(),
      webhookUrl: z.string().optional(),
      channel: z.string(),
      approvalRequired: z.boolean().default(true),
    }).optional(),
    discord: z.object({
      webhookUrl: z.string(),
    }).optional(),
    custom: z.object({
      webhookUrl: z.string(),
      headers: z.record(z.string()).optional(),
    }).optional(),
  }).optional(),

  /** Safety guardrails */
  safety: z.object({
    maxPRsPerHour: z.number().default(3),
    minConfidence: z.number().min(0).max(1).default(0.8),
    excludePaths: z.array(z.string()).default([
      "migrations/",
      ".env",
      "secrets/",
      "*.key",
      "*.pem",
    ]),
    requireTests: z.boolean().default(true),
    autoMerge: z.boolean().default(false),
    dryRun: z.boolean().default(false),
  }).default({}),
});

export type SelfHealingConfig = z.infer<typeof SelfHealingConfigSchema>;

// ---------------------------------------------------------------------------
// Error Detection
// ---------------------------------------------------------------------------

/** Severity levels for detected issues */
export type Severity = "critical" | "error" | "warning" | "info";

/** Source of the detected issue */
export type IssueSource =
  | "vercel-runtime"
  | "vercel-build"
  | "vercel-edge"
  | "supabase-postgres"
  | "supabase-edge-function"
  | "supabase-auth"
  | "supabase-rls"
  | "custom";

/** A detected production issue */
export interface DetectedIssue {
  /** Unique issue ID (hash of key fields for deduplication) */
  id: string;

  /** Human-readable title */
  title: string;

  /** Where this issue was detected */
  source: IssueSource;

  /** Severity classification */
  severity: Severity;

  /** Error message or description */
  message: string;

  /** Stack trace if available */
  stackTrace?: string;

  /** File path where the error originates (if known) */
  filePath?: string;

  /** Line number (if known) */
  lineNumber?: number;

  /** How many times this error occurred in the detection window */
  occurrenceCount: number;

  /** Number of unique users affected (if known) */
  affectedUsers?: number;

  /** First seen timestamp */
  firstSeen: Date;

  /** Last seen timestamp */
  lastSeen: Date;

  /** Raw log entries or error data */
  rawData?: unknown;

  /** Additional context (e.g., request URL, HTTP status) */
  context?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// AI Analysis
// ---------------------------------------------------------------------------

/** Result of AI analysis on a detected issue */
export interface AnalysisResult {
  /** The issue that was analyzed */
  issue: DetectedIssue;

  /** Root cause explanation */
  rootCause: string;

  /** Confidence score (0-1) */
  confidence: number;

  /** Generated fix as a list of file changes */
  fix: FilePatch[];

  /** Natural-language explanation of the fix */
  fixExplanation: string;

  /** Suggested PR title */
  prTitle: string;

  /** Suggested PR body */
  prBody: string;

  /** Token usage for cost tracking */
  tokenUsage?: TokenUsage;

  /** Duration of the analysis in ms */
  durationMs: number;

  /** Files that were read during analysis */
  filesExplored: string[];
}

/** A single file change in the fix */
export interface FilePatch {
  /** Path relative to repo root */
  filePath: string;

  /** Action: create, modify, or delete */
  action: "create" | "modify" | "delete";

  /** New file content (for create/modify) */
  content?: string;

  /** Unified diff (for modify) */
  diff?: string;
}

// ---------------------------------------------------------------------------
// Sandbox Testing
// ---------------------------------------------------------------------------

/** Result of testing a fix in Vercel Sandbox */
export interface TestResult {
  /** Whether all tests passed */
  passed: boolean;

  /** Exit code of the test command */
  exitCode: number;

  /** Test output (stdout) */
  output: string;

  /** Error output (stderr) */
  errorOutput: string;

  /** Duration of the test run in ms */
  durationMs: number;

  /** Sandbox ID for debugging */
  sandboxId: string;

  /** Whether the build succeeded (if buildCommand configured) */
  buildPassed?: boolean;
}

// ---------------------------------------------------------------------------
// PR Creation
// ---------------------------------------------------------------------------

/** Result of creating a GitHub PR */
export interface PRResult {
  /** GitHub PR number */
  number: number;

  /** Full PR URL */
  url: string;

  /** Branch name */
  branch: string;

  /** PR title */
  title: string;

  /** Whether the PR was created (false if dry run) */
  created: boolean;
}

// ---------------------------------------------------------------------------
// Notification
// ---------------------------------------------------------------------------

/** Payload sent to notification channels */
export interface HealingNotification {
  /** The detected issue */
  issue: DetectedIssue;

  /** Analysis result (if analysis succeeded) */
  analysis?: AnalysisResult;

  /** Test result (if tests were run) */
  testResult?: TestResult;

  /** PR result (if PR was created) */
  pr?: PRResult;

  /** Overall status of the healing pipeline */
  status: HealingStatus;

  /** Human-readable summary */
  summary: string;

  /** Timestamp */
  timestamp: Date;

  /** Cost estimate for this healing attempt */
  costEstimate?: CostEstimate;
}

export type HealingStatus =
  | "detected"         // Issue found, starting analysis
  | "analyzing"        // AI is analyzing the issue
  | "fix-generated"    // Fix created, pending testing
  | "testing"          // Fix being tested in sandbox
  | "test-passed"      // Tests passed, creating PR
  | "test-failed"      // Tests failed, no PR created
  | "pr-created"       // PR created, waiting for approval
  | "approved"         // Human approved the fix
  | "merged"           // Fix merged
  | "rejected"         // Human rejected the fix
  | "skipped"          // Issue skipped (low confidence, rate limit, etc.)
  | "failed";          // Pipeline error

// ---------------------------------------------------------------------------
// Cost Tracking
// ---------------------------------------------------------------------------

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

export interface CostEstimate {
  /** Claude API cost */
  claudeApiCost: number;
  /** Vercel Sandbox compute cost */
  sandboxCost: number;
  /** Total cost */
  totalCost: number;
  /** Currency (always USD) */
  currency: "USD";
}

// ---------------------------------------------------------------------------
// Pipeline Events
// ---------------------------------------------------------------------------

/** Events emitted during the healing pipeline */
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

/** Listener for healing events */
export type HealingEventListener = (event: HealingEvent) => void;

// ---------------------------------------------------------------------------
// Vercel Log Drain Types
// ---------------------------------------------------------------------------

/** Vercel runtime log entry (from log drain webhook) */
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

// ---------------------------------------------------------------------------
// Supabase Log Types
// ---------------------------------------------------------------------------

/** Supabase log entry from the analytics API */
export interface SupabaseLogEntry {
  id: string;
  timestamp: string;
  event_message: string;
  metadata: Record<string, unknown>;
}

/** Slow query detected via pg_stat_statements */
export interface SlowQuery {
  queryId: string;
  query: string;
  calls: number;
  meanExecTimeMs: number;
  maxExecTimeMs: number;
  totalExecTimeMs: number;
}
