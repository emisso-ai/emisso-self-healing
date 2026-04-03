import { describe, it, expect } from "vitest";
import { triageIssue, prioritizeIssues, isExcludedPath, severityToPriority } from "../src/analysis/triage";
import type { DetectedIssue, SelfHealingConfig } from "../src/types";

const makeIssue = (overrides: Partial<DetectedIssue> = {}): DetectedIssue => ({
  id: "test-1",
  title: "Test error",
  source: "vercel-runtime",
  severity: "error",
  message: "Something broke",
  occurrenceCount: 1,
  firstSeen: new Date(),
  lastSeen: new Date(),
  ...overrides,
});

const config = {
  github: { owner: "o", repo: "r", token: "t", baseBranch: "main" },
  claude: { apiKey: "k", model: "m", maxTurns: 30 },
  sandbox: { runtime: "node24", testCommand: "npm test", timeout: 300000 },
  sources: {},
  safety: {
    maxPRsPerHour: 3,
    minConfidence: 0.8,
    excludePaths: ["migrations/", ".env", "*.key"],
    requireTests: true,
    autoMerge: false,
    dryRun: false,
  },
} as SelfHealingConfig;

describe("triageIssue", () => {
  it("excluded path → shouldFix=false, shouldNotify=true", () => {
    const d = triageIssue(makeIssue({ filePath: "migrations/001.sql" }), config);
    expect(d.shouldFix).toBe(false);
    expect(d.shouldNotify).toBe(true);
  });

  it("build error → shouldFix=true, priority=1", () => {
    const d = triageIssue(makeIssue({ source: "vercel-build" }), config);
    expect(d.shouldFix).toBe(true);
    expect(d.priority).toBe(1);
  });

  it("critical severity → priority=1", () => {
    const d = triageIssue(makeIssue({ severity: "critical" }), config);
    expect(d.shouldFix).toBe(true);
    expect(d.priority).toBe(1);
  });

  it("high occurrence error → shouldFix=true, priority=2", () => {
    const d = triageIssue(makeIssue({ occurrenceCount: 15, severity: "error" }), config);
    expect(d.shouldFix).toBe(true);
    expect(d.priority).toBe(2);
  });

  it("error with filePath → shouldFix=true, priority=3", () => {
    const d = triageIssue(makeIssue({ severity: "error", filePath: "src/auth.ts" }), config);
    expect(d.shouldFix).toBe(true);
    expect(d.priority).toBe(3);
  });

  it("error without filePath → shouldFix=false", () => {
    const d = triageIssue(makeIssue({ severity: "error" }), config);
    expect(d.shouldFix).toBe(false);
  });

  it("supabase warning → shouldNotify=true, shouldFix=false", () => {
    const d = triageIssue(makeIssue({ source: "supabase-postgres", severity: "warning" }), config);
    expect(d.shouldFix).toBe(false);
    expect(d.shouldNotify).toBe(true);
  });

  it("info severity → shouldNotify=false", () => {
    const d = triageIssue(makeIssue({ severity: "info" }), config);
    expect(d.shouldNotify).toBe(false);
  });
});

describe("isExcludedPath", () => {
  it("directory pattern matches", () => {
    expect(isExcludedPath("migrations/001.sql", ["migrations/"])).toBe(true);
  });

  it("extension pattern matches", () => {
    expect(isExcludedPath("secrets/prod.key", ["*.key"])).toBe(true);
  });

  it("exact substring matches", () => {
    expect(isExcludedPath(".env.local", [".env"])).toBe(true);
  });

  it("non-matching returns false", () => {
    expect(isExcludedPath("src/auth.ts", ["migrations/", ".env"])).toBe(false);
  });
});

describe("prioritizeIssues", () => {
  it("sorts by priority ascending", () => {
    const issues = [
      makeIssue({ id: "a", severity: "warning" }),
      makeIssue({ id: "b", severity: "critical" }),
      makeIssue({ id: "c", source: "vercel-build" }),
    ];
    const sorted = prioritizeIssues(issues, config);
    expect(sorted[0]!.decision.priority).toBeLessThanOrEqual(sorted[1]!.decision.priority);
  });
});

describe("severityToPriority", () => {
  it("critical=1, error=3, warning=5, info=7", () => {
    expect(severityToPriority("critical")).toBe(1);
    expect(severityToPriority("error")).toBe(3);
    expect(severityToPriority("warning")).toBe(5);
    expect(severityToPriority("info")).toBe(7);
  });
});
