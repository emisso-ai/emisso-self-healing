import { createHash } from "crypto";

export function createIssueId(source: string, fingerprint: string): string {
  const hash = createHash("sha256")
    .update(`${source}:${fingerprint}`)
    .digest("hex")
    .substring(0, 16);
  return `sh_${hash}`;
}

export class DeduplicationWindow {
  private seen = new Map<string, number>();
  private readonly windowMs: number;

  constructor(windowMs = 60 * 60 * 1000) {
    this.windowMs = windowMs;
  }

  isDuplicate(issueId: string): boolean {
    const lastSeen = this.seen.get(issueId);
    if (!lastSeen) return false;
    return Date.now() - lastSeen < this.windowMs;
  }

  mark(issueId: string): void {
    this.seen.set(issueId, Date.now());
  }

  cleanup(): void {
    const now = Date.now();
    for (const [id, timestamp] of this.seen) {
      if (now - timestamp >= this.windowMs) {
        this.seen.delete(id);
      }
    }
  }

  get size(): number {
    return this.seen.size;
  }

  clear(): void {
    this.seen.clear();
  }
}
