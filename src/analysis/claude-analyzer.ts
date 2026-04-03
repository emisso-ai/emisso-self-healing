import type { DetectedIssue, SelfHealingConfig, AnalysisResult, FilePatch, TokenUsage } from "../types.js";

export async function analyzeIssue(
  issue: DetectedIssue,
  config: SelfHealingConfig,
  options?: { cwd?: string; signal?: AbortSignal },
): Promise<AnalysisResult> {
  const startTime = Date.now();
  const { query } = await import("@anthropic-ai/claude-agent-sdk");

  const prompt = buildAnalysisPrompt(issue);
  const excludePatterns = config.safety.excludePaths;
  let rawOutput = "";
  let tokenUsage: TokenUsage | undefined;
  const filesExplored: string[] = [];

  for await (const message of query({
    prompt,
    options: {
      allowedTools: ["Read", "Glob", "Grep", "Edit", "Write", "Bash"],
      cwd: options?.cwd,
      model: config.claude.model,
      maxTurns: config.claude.maxTurns,
      systemPrompt: buildSystemPrompt(config, excludePatterns),
    },
  })) {
    if (message.type === "assistant" && message.message.content) {
      for (const block of message.message.content) {
        if (block.type === "text") rawOutput += block.text;
        if (block.type === "tool_use") {
          const input = block.input as Record<string, string>;
          const filePath = input.file_path ?? input.path;
          if (filePath) filesExplored.push(filePath);
        }
      }
    }
    if (message.type === "result" && message.usage) {
      tokenUsage = {
        inputTokens: message.usage.input_tokens ?? 0,
        outputTokens: message.usage.output_tokens ?? 0,
        cacheReadTokens: message.usage.cache_read_input_tokens,
        cacheCreationTokens: message.usage.cache_creation_input_tokens,
      };
    }
  }

  const parsed = parseAnalysisOutput(rawOutput);

  return {
    issue,
    rootCause: parsed.rootCause,
    confidence: parsed.confidence,
    fix: parsed.patches,
    fixExplanation: parsed.explanation,
    prTitle: parsed.prTitle || `fix: ${issue.title.substring(0, 60)}`,
    prBody: buildPRBody(issue, parsed),
    tokenUsage,
    durationMs: Date.now() - startTime,
    filesExplored: [...new Set(filesExplored)],
  };
}

/** @internal Exported for testing */
export function buildSystemPrompt(_config: SelfHealingConfig, excludePatterns: string[]): string {
  return `You are a senior software engineer analyzing and fixing production errors in a Next.js + Supabase + Vercel application.

## Rules
1. Read the relevant source files to understand the codebase context.
2. Identify the root cause — don't just patch symptoms.
3. Generate minimal, targeted fixes. Change as few files as possible.
4. NEVER modify files matching these patterns: ${excludePatterns.join(", ")}
5. NEVER modify database migration files.
6. NEVER modify .env files or anything containing secrets.
7. NEVER introduce breaking API changes.
8. Add or update tests if the test framework is present.
9. Keep your fix explanation concise but thorough.

## Output Format
After analyzing and creating the fix, output a JSON block with this exact structure:

\`\`\`json
{
  "rootCause": "Explanation of why this error occurs",
  "confidence": 0.85,
  "explanation": "What the fix does and why",
  "prTitle": "fix(scope): brief description",
  "patches": [
    {
      "filePath": "src/path/to/file.ts",
      "action": "modify",
      "diff": "unified diff of changes"
    }
  ]
}
\`\`\`

The confidence score (0-1) reflects how certain you are that this fix resolves the issue without side effects.`;
}

/** @internal Exported for testing */
export function buildAnalysisPrompt(issue: DetectedIssue, _config?: SelfHealingConfig): string {
  let prompt = `## Production Error to Fix

**Title:** ${issue.title}
**Source:** ${issue.source}
**Severity:** ${issue.severity}
**Occurrences:** ${issue.occurrenceCount}

**Error Message:**
${issue.message}`;

  if (issue.stackTrace) {
    prompt += `\n\n**Stack Trace:**\n\`\`\`\n${issue.stackTrace}\n\`\`\``;
  }
  if (issue.filePath) {
    prompt += `\n\n**Suspected File:** ${issue.filePath}${issue.lineNumber ? `:${issue.lineNumber}` : ""}`;
  }
  if (issue.context) {
    prompt += `\n\n**Context:**\n\`\`\`json\n${JSON.stringify(issue.context, null, 2)}\n\`\`\``;
  }

  prompt += `\n\nPlease:
1. Read the relevant source files (start with the suspected file if provided)
2. Understand the codebase patterns and conventions
3. Identify the root cause
4. Create a minimal fix using the Edit or Write tools
5. Output the structured JSON analysis`;

  return prompt;
}

/** @internal Exported for testing */
export function parseAnalysisOutput(rawOutput: string): {
  rootCause: string;
  confidence: number;
  explanation: string;
  prTitle: string;
  patches: FilePatch[];
} {
  const jsonMatch = rawOutput.match(/```json\s*\n([\s\S]*?)\n\s*```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]!);
      return {
        rootCause: parsed.rootCause ?? "Unable to determine root cause",
        confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.5)),
        explanation: parsed.explanation ?? rawOutput,
        prTitle: parsed.prTitle ?? "",
        patches: (parsed.patches ?? []).map(normalizePatch),
      };
    } catch {
      // Fall through to default
    }
  }

  return {
    rootCause: "Analysis completed — see explanation",
    confidence: 0.5,
    explanation: rawOutput,
    prTitle: "",
    patches: [],
  };
}

function normalizePatch(patch: { filePath: string; action?: string; content?: string; diff?: string }): FilePatch {
  return {
    filePath: patch.filePath.replace(/^\//, ""),
    action: (patch.action as FilePatch["action"]) ?? "modify",
    content: patch.content,
    diff: patch.diff,
  };
}

/** @internal Exported for testing */
export function buildPRBody(
  issue: DetectedIssue,
  analysis: { rootCause: string; confidence: number; explanation: string; patches: FilePatch[] },
): string {
  return `## Self-Healing Fix

**Issue:** ${issue.title}
**Source:** ${issue.source}
**Severity:** ${issue.severity}
**Occurrences:** ${issue.occurrenceCount}

### Root Cause
${analysis.rootCause}

### Fix
${analysis.explanation}

### Confidence: ${Math.round(analysis.confidence * 100)}%

### Files Changed
${analysis.patches.map((p) => `- \`${p.filePath}\` (${p.action})`).join("\n")}

---
*Generated by [@emisso/self-healing](https://github.com/emisso-ai/emisso-self-healing)*`;
}
