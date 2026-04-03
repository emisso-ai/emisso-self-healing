import type { DetectedIssue, SelfHealingConfig, Severity } from "../types.js";

export interface TriageDecision {
  shouldFix: boolean;
  shouldNotify: boolean;
  reason: string;
  priority: number;
}

export function triageIssue(
  issue: DetectedIssue,
  config: SelfHealingConfig,
): TriageDecision {
  if (issue.filePath && isExcludedPath(issue.filePath, config.safety.excludePaths)) {
    return {
      shouldFix: false,
      shouldNotify: true,
      reason: `File path matches exclude pattern: ${issue.filePath}`,
      priority: 99,
    };
  }

  if (issue.source === "vercel-build") {
    return { shouldFix: true, shouldNotify: true, reason: "Build error — blocks deployment", priority: 1 };
  }

  if (issue.severity === "critical") {
    return { shouldFix: true, shouldNotify: true, reason: "Critical severity error", priority: 1 };
  }

  if (issue.occurrenceCount >= 10 && issue.severity === "error") {
    return {
      shouldFix: true,
      shouldNotify: true,
      reason: `High occurrence error (${issue.occurrenceCount} times)`,
      priority: 2,
    };
  }

  if (issue.severity === "error" && issue.filePath) {
    return { shouldFix: true, shouldNotify: true, reason: "Error with identifiable source file", priority: 3 };
  }

  if (issue.severity === "error") {
    return { shouldFix: false, shouldNotify: true, reason: "Error without identifiable source file", priority: 5 };
  }

  if (issue.source === "supabase-postgres" && issue.severity === "warning") {
    return {
      shouldFix: false,
      shouldNotify: true,
      reason: "Database performance warning — manual review recommended",
      priority: 4,
    };
  }

  return {
    shouldFix: false,
    shouldNotify: issue.severity !== "info",
    reason: `Low severity (${issue.severity})`,
    priority: severityToPriority(issue.severity),
  };
}

export function prioritizeIssues(
  issues: DetectedIssue[],
  config: SelfHealingConfig,
): Array<{ issue: DetectedIssue; decision: TriageDecision }> {
  return issues
    .map((issue) => ({ issue, decision: triageIssue(issue, config) }))
    .sort((a, b) => a.decision.priority - b.decision.priority);
}

export function isExcludedPath(filePath: string, patterns: string[]): boolean {
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

export function severityToPriority(severity: Severity): number {
  switch (severity) {
    case "critical": return 1;
    case "error": return 3;
    case "warning": return 5;
    case "info": return 7;
  }
}
