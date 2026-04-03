import { describe, it, expect } from "vitest";
import {
  parseAnalysisOutput,
  buildAnalysisPrompt,
  buildPRBody,
  buildSystemPrompt,
} from "../src/analysis/claude-analyzer";
import type { DetectedIssue, SelfHealingConfig } from "../src/types";

const makeIssue = (overrides: Partial<DetectedIssue> = {}): DetectedIssue => ({
  id: "test-1",
  title: "TypeError in auth module",
  source: "vercel-runtime",
  severity: "error",
  message: "Cannot read property 'id' of null",
  occurrenceCount: 5,
  firstSeen: new Date(),
  lastSeen: new Date(),
  ...overrides,
});

describe("parseAnalysisOutput", () => {
  it("valid JSON block → extracts all fields", () => {
    const raw = `Some text\n\`\`\`json\n{"rootCause":"Null check missing","confidence":0.9,"explanation":"Added guard","prTitle":"fix(auth): add null check","patches":[{"filePath":"src/auth.ts","action":"modify","diff":"+ if (!user) return;"}]}\n\`\`\``;
    const result = parseAnalysisOutput(raw);
    expect(result.rootCause).toBe("Null check missing");
    expect(result.confidence).toBe(0.9);
    expect(result.explanation).toBe("Added guard");
    expect(result.prTitle).toBe("fix(auth): add null check");
    expect(result.patches).toHaveLength(1);
  });

  it("confidence clamped to [0,1]", () => {
    const raw = '```json\n{"rootCause":"x","confidence":5,"explanation":"y","patches":[]}\n```';
    expect(parseAnalysisOutput(raw).confidence).toBe(1);

    const raw2 = '```json\n{"rootCause":"x","confidence":-2,"explanation":"y","patches":[]}\n```';
    expect(parseAnalysisOutput(raw2).confidence).toBe(0);
  });

  it("no JSON block → fallback values", () => {
    const result = parseAnalysisOutput("Just plain text analysis");
    expect(result.rootCause).toContain("Analysis completed");
    expect(result.confidence).toBe(0.5);
    expect(result.patches).toHaveLength(0);
  });

  it("normalizes patch filePath (strips leading slash)", () => {
    const raw = '```json\n{"rootCause":"x","confidence":0.8,"explanation":"y","patches":[{"filePath":"/src/foo.ts","action":"modify"}]}\n```';
    expect(parseAnalysisOutput(raw).patches[0]!.filePath).toBe("src/foo.ts");
  });
});

describe("buildAnalysisPrompt", () => {
  it("includes title, source, severity", () => {
    const prompt = buildAnalysisPrompt(makeIssue());
    expect(prompt).toContain("TypeError in auth module");
    expect(prompt).toContain("vercel-runtime");
    expect(prompt).toContain("error");
  });

  it("includes stack trace when present", () => {
    const prompt = buildAnalysisPrompt(makeIssue({ stackTrace: "at handler (src/api.ts:10)" }));
    expect(prompt).toContain("Stack Trace");
    expect(prompt).toContain("at handler");
  });

  it("includes file path when present", () => {
    const prompt = buildAnalysisPrompt(makeIssue({ filePath: "src/auth.ts", lineNumber: 42 }));
    expect(prompt).toContain("src/auth.ts:42");
  });

  it("includes context when present", () => {
    const prompt = buildAnalysisPrompt(makeIssue({ context: { statusCode: 500 } }));
    expect(prompt).toContain("500");
  });
});

describe("buildSystemPrompt", () => {
  const cfg = { safety: { excludePaths: ["migrations/", ".env"] } } as SelfHealingConfig;

  it("includes exclude patterns", () => {
    const prompt = buildSystemPrompt(cfg, cfg.safety.excludePaths);
    expect(prompt).toContain("migrations/");
    expect(prompt).toContain(".env");
  });

  it("includes safety rules", () => {
    const prompt = buildSystemPrompt(cfg, []);
    expect(prompt).toContain("NEVER modify");
    expect(prompt).toContain("Output Format");
  });
});

describe("buildPRBody", () => {
  it("includes all issue details", () => {
    const body = buildPRBody(makeIssue(), {
      rootCause: "Missing null check",
      confidence: 0.85,
      explanation: "Added guard clause",
      patches: [{ filePath: "src/auth.ts", action: "modify" }],
    });
    expect(body).toContain("TypeError in auth module");
    expect(body).toContain("Missing null check");
    expect(body).toContain("85%");
    expect(body).toContain("src/auth.ts");
  });
});
