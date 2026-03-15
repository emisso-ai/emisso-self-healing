/**
 * Self-Healing Pipeline — Orchestrates the full detect -> fix -> test -> PR -> notify flow
 *
 * This is the core of @emisso/self-healing. It ties together all modules
 * into a single pipeline that processes detected issues.
 */

import type {
  AnalysisResult,
  CostEstimate,
  DetectedIssue,
  HealingEvent,
  HealingEventListener,
  HealingNotification,
  HealingStatus,
  PRResult,
  SelfHealingConfig,
  TestResult,
} from "./types";
import { DeduplicationWindow } from "./ingestion/dedup";
import { triageIssue } from "./analysis/triage";
import { analyzeIssue } from "./analysis/claude-analyzer";
import { testFixInSandbox } from "./sandbox/runner";
import { createFixPR } from "./repair/github";
import { notifyAll } from "./notify";

/** Rate limiter state */
interface RateLimitState {
  prCount: number;
  windowStart: number;
}

/**
 * The self-healing pipeline. Processes detected issues through
 * the full analysis -> fix -> test -> PR -> notify cycle.
 */
export class HealingPipeline {
  private config: SelfHealingConfig;
  private dedup: DeduplicationWindow;
  private rateLimit: RateLimitState;
  private listeners: HealingEventListener[] = [];

  constructor(config: SelfHealingConfig) {
    this.config = config;
    this.dedup = new DeduplicationWindow();
    this.rateLimit = { prCount: 0, windowStart: Date.now() };
  }

  /**
   * Process a batch of detected issues through the pipeline.
   *
   * Each issue is triaged, and fixable issues go through the
   * full analysis -> test -> PR -> notify flow.
   */
  async processIssues(
    issues: DetectedIssue[],
    options?: { signal?: AbortSignal; concurrency?: number },
  ): Promise<HealingNotification[]> {
    const concurrency = options?.concurrency ?? 2;
    const notifications: HealingNotification[] = [];

    // Process in batches for controlled concurrency
    for (let i = 0; i < issues.length; i += concurrency) {
      if (options?.signal?.aborted) break;

      const batch = issues.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        batch.map((issue) => this.processIssue(issue, options?.signal)),
      );

      for (const result of results) {
        if (result.status === "fulfilled" && result.value) {
          notifications.push(result.value);
        } else if (result.status === "rejected") {
          this.emit({ type: "pipeline:error", error: result.reason as Error });
        }
      }
    }

    // Cleanup expired dedup entries
    this.dedup.cleanup();

    return notifications;
  }

  /**
   * Process a single issue through the pipeline.
   */
  async processIssue(issue: DetectedIssue, signal?: AbortSignal): Promise<HealingNotification | null> {
    // Deduplication
    if (this.dedup.isDuplicate(issue.id)) {
      return null;
    }
    this.dedup.mark(issue.id);

    this.emit({ type: "issue:detected", issue });

    // Triage
    const decision = triageIssue(issue, this.config);

    if (!decision.shouldFix && !decision.shouldNotify) {
      this.emit({ type: "issue:skipped", issue, reason: decision.reason });
      return null;
    }

    // If only notification (no fix), send alert and return
    if (!decision.shouldFix) {
      const notification = this.buildNotification(issue, "detected",
        `Detected: ${issue.title}`);
      await notifyAll(notification, this.config);
      this.emit({ type: "notification:sent", channel: "all" });
      return notification;
    }

    // Rate limit check
    if (this.isRateLimited()) {
      this.emit({ type: "issue:skipped", issue, reason: "Rate limit exceeded" });
      const notification = this.buildNotification(issue, "skipped",
        `Rate limited — ${issue.title}`);
      await notifyAll(notification, this.config);
      return notification;
    }

    // Analysis
    this.emit({ type: "analysis:started", issue });
    let analysis: AnalysisResult;
    try {
      analysis = await analyzeIssue(issue, this.config, { signal });
      this.emit({ type: "analysis:completed", result: analysis });
    } catch (error) {
      this.emit({ type: "analysis:failed", issue, error: error as Error });
      const notification = this.buildNotification(issue, "failed",
        `Analysis failed for: ${issue.title}`);
      await notifyAll(notification, this.config);
      return notification;
    }

    // Confidence check
    if (analysis.confidence < this.config.safety.minConfidence) {
      this.emit({
        type: "issue:skipped",
        issue,
        reason: `Low confidence: ${Math.round(analysis.confidence * 100)}% < ${Math.round(this.config.safety.minConfidence * 100)}%`,
      });
      const notification = this.buildNotification(issue, "skipped",
        `Low confidence fix (${Math.round(analysis.confidence * 100)}%) for: ${issue.title}`,
        analysis);
      await notifyAll(notification, this.config);
      return notification;
    }

    // No patches generated
    if (analysis.fix.length === 0) {
      const notification = this.buildNotification(issue, "failed",
        `No fix generated for: ${issue.title}`, analysis);
      await notifyAll(notification, this.config);
      return notification;
    }

    // Sandbox testing
    let testResult: TestResult | undefined;
    if (this.config.safety.requireTests) {
      this.emit({ type: "test:started", analysis });
      try {
        testResult = await testFixInSandbox(analysis, this.config, { signal });
        this.emit({ type: "test:completed", result: testResult });
      } catch (error) {
        this.emit({ type: "test:failed", error: error as Error });
        const notification = this.buildNotification(issue, "failed",
          `Test execution failed for: ${issue.title}`, analysis);
        await notifyAll(notification, this.config);
        return notification;
      }

      if (!testResult.passed) {
        const notification = this.buildNotification(issue, "test-failed",
          `Tests failed for fix: ${issue.title}`, analysis, testResult);
        await notifyAll(notification, this.config);
        return notification;
      }
    }

    // Create PR
    let pr: PRResult | undefined;
    try {
      pr = await createFixPR(analysis, testResult, this.config);
      this.incrementRateLimit();
      this.emit({ type: "pr:created", pr });
    } catch (error) {
      this.emit({ type: "pr:failed", error: error as Error });
      const notification = this.buildNotification(issue, "failed",
        `PR creation failed for: ${issue.title}`, analysis, testResult);
      await notifyAll(notification, this.config);
      return notification;
    }

    // Success notification
    const notification = this.buildNotification(
      issue,
      "pr-created",
      `Fix PR created for: ${issue.title}`,
      analysis,
      testResult,
      pr,
    );
    await notifyAll(notification, this.config);
    this.emit({ type: "pipeline:completed", notification });

    return notification;
  }

  /** Register an event listener */
  on(listener: HealingEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private emit(event: HealingEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Don't let listener errors break the pipeline
      }
    }
  }

  private isRateLimited(): boolean {
    const hourMs = 60 * 60 * 1000;
    if (Date.now() - this.rateLimit.windowStart > hourMs) {
      this.rateLimit = { prCount: 0, windowStart: Date.now() };
    }
    return this.rateLimit.prCount >= this.config.safety.maxPRsPerHour;
  }

  private incrementRateLimit(): void {
    this.rateLimit.prCount += 1;
  }

  private buildNotification(
    issue: DetectedIssue,
    status: HealingStatus,
    summary: string,
    analysis?: AnalysisResult,
    testResult?: TestResult,
    pr?: PRResult,
  ): HealingNotification {
    return {
      issue,
      analysis,
      testResult,
      pr,
      status,
      summary,
      timestamp: new Date(),
      costEstimate: analysis ? this.estimateCost(analysis, testResult) : undefined,
    };
  }

  private estimateCost(
    analysis: AnalysisResult,
    testResult?: TestResult,
  ): CostEstimate {
    let claudeApiCost = 0;
    if (analysis.tokenUsage) {
      // Approximate Sonnet 4.6 pricing
      claudeApiCost +=
        (analysis.tokenUsage.inputTokens / 1_000_000) * 3;
      claudeApiCost +=
        (analysis.tokenUsage.outputTokens / 1_000_000) * 15;
    }

    let sandboxCost = 0;
    if (testResult) {
      const hours = testResult.durationMs / (1000 * 60 * 60);
      sandboxCost = hours * 2 * 0.13 * 0.25; // 2 vCPU, 25% utilization
    }

    return {
      claudeApiCost: Math.round(claudeApiCost * 1_000_000) / 1_000_000,
      sandboxCost: Math.round(sandboxCost * 1_000_000) / 1_000_000,
      totalCost:
        Math.round((claudeApiCost + sandboxCost) * 1_000_000) / 1_000_000,
      currency: "USD",
    };
  }
}
