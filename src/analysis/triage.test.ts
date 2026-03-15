import { describe, it, expect } from "vitest";
import { triageIssue } from "./triage";
import type { DetectedIssue, SelfHealingConfig } from "../types";

function makeIssue(overrides: Partial<DetectedIssue> = {}): DetectedIssue {
  return {
    id: "sh_abc123",
    title: "Test error",
    source: "vercel-runtime",
    severity: "error",
    message: "Something went wrong",
    occurrenceCount: 1,
    firstSeen: new Date(),
    lastSeen: new Date(),
    ...overrides,
  };
}

function makeConfig(overrides: Partial<SelfHealingConfig> = {}): SelfHealingConfig {
  return {
    github: { owner: "test", repo: "test", token: "tok", baseBranch: "main" },
    claude: { apiKey: "key", model: "claude-sonnet-4-6", maxTurns: 30 },
    sandbox: { runtime: "node24", testCommand: "npm test -- --run", timeout: 300_000 },
    sources: {},
    safety: {
      maxPRsPerHour: 3,
      minConfidence: 0.8,
      excludePaths: ["migrations/", ".env", "secrets/", "*.key", "*.pem"],
      requireTests: true,
      autoMerge: false,
      dryRun: false,
    },
    ...overrides,
  } as SelfHealingConfig;
}

describe("triageIssue", () => {
  it("build errors should always be fixed (shouldFix: true)", () => {
    const issue = makeIssue({ source: "vercel-build", severity: "error" });
    const decision = triageIssue(issue, makeConfig());
    expect(decision.shouldFix).toBe(true);
    expect(decision.shouldNotify).toBe(true);
    expect(decision.priority).toBe(1);
  });

  it("critical severity should always be fixed", () => {
    const issue = makeIssue({ severity: "critical" });
    const decision = triageIssue(issue, makeConfig());
    expect(decision.shouldFix).toBe(true);
    expect(decision.shouldNotify).toBe(true);
    expect(decision.priority).toBe(1);
  });

  it("high-occurrence errors should be fixed", () => {
    const issue = makeIssue({ severity: "error", occurrenceCount: 15 });
    const decision = triageIssue(issue, makeConfig());
    expect(decision.shouldFix).toBe(true);
    expect(decision.reason).toContain("15");
  });

  it("errors with file context should be fixed", () => {
    const issue = makeIssue({
      severity: "error",
      filePath: "src/features/billing/service.ts",
      occurrenceCount: 3,
    });
    const decision = triageIssue(issue, makeConfig());
    expect(decision.shouldFix).toBe(true);
    expect(decision.reason).toContain("source file");
  });

  it("errors without file context should only notify", () => {
    const issue = makeIssue({
      severity: "error",
      filePath: undefined,
      occurrenceCount: 3,
    });
    const decision = triageIssue(issue, makeConfig());
    expect(decision.shouldFix).toBe(false);
    expect(decision.shouldNotify).toBe(true);
  });

  it("excluded paths should never be fixed", () => {
    const issue = makeIssue({
      severity: "critical",
      filePath: "migrations/0001_init.sql",
    });
    const decision = triageIssue(issue, makeConfig());
    expect(decision.shouldFix).toBe(false);
    expect(decision.shouldNotify).toBe(true);
    expect(decision.reason).toContain("exclude");
  });

  it("excluded glob patterns (e.g. *.pem) should never be fixed", () => {
    const issue = makeIssue({
      severity: "critical",
      filePath: "certs/server.pem",
    });
    const decision = triageIssue(issue, makeConfig());
    expect(decision.shouldFix).toBe(false);
  });

  it("warnings should only notify", () => {
    const issue = makeIssue({ severity: "warning" });
    const decision = triageIssue(issue, makeConfig());
    expect(decision.shouldFix).toBe(false);
    expect(decision.shouldNotify).toBe(true);
  });

  it("info severity should be skipped (shouldNotify: false)", () => {
    const issue = makeIssue({ severity: "info" });
    const decision = triageIssue(issue, makeConfig());
    expect(decision.shouldFix).toBe(false);
    expect(decision.shouldNotify).toBe(false);
  });
});
