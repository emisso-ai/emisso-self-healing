/**
 * Issue Triage — Classifies and prioritizes detected issues
 *
 * Determines which issues are worth auto-fixing and which should
 * only generate alerts.
 */

import type { DetectedIssue, SelfHealingConfig, Severity } from "../types";

/** Decision about what to do with a detected issue */
export interface TriageDecision {
  /** Whether to attempt auto-fixing */
  shouldFix: boolean;

  /** Whether to send a notification (even if not fixing) */
  shouldNotify: boolean;

  /** Reason for the decision */
  reason: string;

  /** Priority (lower = higher priority) */
  priority: number;
}

/**
 * Triage a detected issue to decide whether to attempt a fix.
 */
export function triageIssue(
  issue: DetectedIssue,
  config: SelfHealingConfig,
): TriageDecision {
  // Never fix issues from excluded paths
  if (issue.filePath && isExcludedPath(issue.filePath, config.safety.excludePaths)) {
    return {
      shouldFix: false,
      shouldNotify: true,
      reason: `File path matches exclude pattern: ${issue.filePath}`,
      priority: 99,
    };
  }

  // Build errors — always try to fix
  if (issue.source === "vercel-build") {
    return {
      shouldFix: true,
      shouldNotify: true,
      reason: "Build error — blocks deployment",
      priority: 1,
    };
  }

  // Critical severity — always try to fix
  if (issue.severity === "critical") {
    return {
      shouldFix: true,
      shouldNotify: true,
      reason: "Critical severity error",
      priority: 1,
    };
  }

  // High occurrence errors — worth fixing
  if (issue.occurrenceCount >= 10 && issue.severity === "error") {
    return {
      shouldFix: true,
      shouldNotify: true,
      reason: `High occurrence error (${issue.occurrenceCount} times)`,
      priority: 2,
    };
  }

  // Regular errors — fix if we have file context
  if (issue.severity === "error" && issue.filePath) {
    return {
      shouldFix: true,
      shouldNotify: true,
      reason: "Error with identifiable source file",
      priority: 3,
    };
  }

  // Errors without file context — notify only
  if (issue.severity === "error") {
    return {
      shouldFix: false,
      shouldNotify: true,
      reason: "Error without identifiable source file",
      priority: 5,
    };
  }

  // Slow queries — notify, suggest fix
  if (issue.source === "supabase-postgres" && issue.severity === "warning") {
    return {
      shouldFix: false,
      shouldNotify: true,
      reason: "Database performance warning — manual review recommended",
      priority: 4,
    };
  }

  // Warnings — notify only
  return {
    shouldFix: false,
    shouldNotify: issue.severity !== "info",
    reason: `Low severity (${issue.severity})`,
    priority: severityToPriority(issue.severity),
  };
}

/**
 * Sort issues by priority (most important first).
 */
export function prioritizeIssues(
  issues: DetectedIssue[],
  config: SelfHealingConfig,
): Array<{ issue: DetectedIssue; decision: TriageDecision }> {
  return issues
    .map((issue) => ({ issue, decision: triageIssue(issue, config) }))
    .sort((a, b) => a.decision.priority - b.decision.priority);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isExcludedPath(filePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.endsWith("/")) {
      return filePath.startsWith(pattern) || filePath.includes(`/${pattern}`);
    }
    if (pattern.startsWith("*.")) {
      return filePath.endsWith(pattern.substring(1));
    }
    return filePath.includes(pattern);
  });
}

function severityToPriority(severity: Severity): number {
  switch (severity) {
    case "critical": return 1;
    case "error": return 3;
    case "warning": return 5;
    case "info": return 7;
  }
}
