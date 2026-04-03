import { describe, it, expect } from "vitest";
import { generateBranchName, buildPRBody } from "../src/repair/github";
import type { AnalysisResult, DetectedIssue, TestResult } from "../src/types";

const makeIssue = (title = "TypeError in auth module"): DetectedIssue => ({
  id: "test-1",
  title,
  source: "vercel-runtime",
  severity: "error",
  message: "Error",
  occurrenceCount: 1,
  firstSeen: new Date(),
  lastSeen: new Date(),
});

const makeAnalysis = (): AnalysisResult => ({
  issue: makeIssue(),
  rootCause: "Missing check",
  confidence: 0.9,
  fix: [{ filePath: "src/auth.ts", action: "modify" }],
  fixExplanation: "Added null guard",
  prTitle: "fix(auth): null check",
  prBody: "## Self-Healing Fix\n\nDetails here",
  durationMs: 5000,
  filesExplored: ["src/auth.ts"],
});

describe("generateBranchName", () => {
  it("slugifies title", () => {
    const name = generateBranchName(makeIssue("TypeError: Cannot Read Property"));
    expect(name).toMatch(/^self-healing\/typeerror-cannot-read-property/);
  });

  it("truncates long titles to 40 chars", () => {
    const longTitle = "A".repeat(100);
    const name = generateBranchName(makeIssue(longTitle));
    const slug = name.replace("self-healing/", "").replace(/-[a-z0-9]+$/, "");
    expect(slug.length).toBeLessThanOrEqual(40);
  });

  it("includes timestamp suffix", () => {
    const name = generateBranchName(makeIssue());
    // Should end with a base-36 timestamp
    expect(name).toMatch(/-[a-z0-9]+$/);
  });

  it("starts with self-healing/ prefix", () => {
    expect(generateBranchName(makeIssue())).toMatch(/^self-healing\//);
  });
});

describe("buildPRBody", () => {
  it("includes test results when present", () => {
    const testResult: TestResult = {
      passed: true,
      exitCode: 0,
      output: "All tests passed",
      errorOutput: "",
      durationMs: 12000,
      sandboxId: "sb-123",
    };
    const body = buildPRBody(makeAnalysis(), testResult);
    expect(body).toContain("Test Results");
    expect(body).toContain("All tests passed");
    expect(body).toContain("sb-123");
  });

  it("shows failure when tests fail", () => {
    const testResult: TestResult = {
      passed: false,
      exitCode: 1,
      output: "",
      errorOutput: "FAIL",
      durationMs: 5000,
      sandboxId: "sb-456",
    };
    const body = buildPRBody(makeAnalysis(), testResult);
    expect(body).toContain("Tests failed");
  });

  it("without test results", () => {
    const body = buildPRBody(makeAnalysis(), undefined);
    expect(body).not.toContain("Test Results");
  });

  it("includes build status when present", () => {
    const testResult: TestResult = {
      passed: true,
      exitCode: 0,
      output: "",
      errorOutput: "",
      durationMs: 8000,
      sandboxId: "sb-789",
      buildPassed: true,
    };
    const body = buildPRBody(makeAnalysis(), testResult);
    expect(body).toContain("Build:");
  });
});
