/**
 * Issue deduplication — prevents duplicate healing attempts
 * for the same underlying error.
 */

import { createHash } from "node:crypto";

/**
 * Create a deterministic issue ID from source and fingerprint.
 * Used to deduplicate issues across ingestion cycles.
 */
export function createIssueId(source: string, fingerprint: string): string {
  const hash = createHash("sha256")
    .update(`${source}:${fingerprint}`)
    .digest("hex")
    .substring(0, 16);
  return `sh_${hash}`;
}

/**
 * In-memory deduplication window.
 *
 * Tracks which issues have already been processed within a configurable
 * time window to avoid duplicate healing attempts.
 */
export class DeduplicationWindow {
  private seen = new Map<string, number>();
  private readonly windowMs: number;

  constructor(windowMs = 60 * 60 * 1000) {
    this.windowMs = windowMs;
  }

  /**
   * Check if an issue has already been seen within the window.
   * Returns true if it's a duplicate (should be skipped).
   */
  isDuplicate(issueId: string): boolean {
    const lastSeen = this.seen.get(issueId);
    if (!lastSeen) return false;
    return Date.now() - lastSeen < this.windowMs;
  }

  /** Mark an issue as seen. */
  mark(issueId: string): void {
    this.seen.set(issueId, Date.now());
  }

  /** Remove expired entries to prevent memory leaks. */
  cleanup(): void {
    const now = Date.now();
    for (const [id, timestamp] of this.seen) {
      if (now - timestamp >= this.windowMs) {
        this.seen.delete(id);
      }
    }
  }

  /** Number of tracked issues (for monitoring). */
  get size(): number {
    return this.seen.size;
  }

  /** Clear all entries. */
  clear(): void {
    this.seen.clear();
  }
}
