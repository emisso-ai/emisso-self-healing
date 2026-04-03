import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createIssueId, DeduplicationWindow } from "../src/ingestion/dedup";

describe("createIssueId", () => {
  it("produces consistent IDs for same input", () => {
    const id1 = createIssueId("vercel", "TypeError|src/auth.ts");
    const id2 = createIssueId("vercel", "TypeError|src/auth.ts");
    expect(id1).toBe(id2);
  });

  it("produces different IDs for different inputs", () => {
    const id1 = createIssueId("vercel", "fp1");
    const id2 = createIssueId("vercel", "fp2");
    expect(id1).not.toBe(id2);
  });

  it("starts with sh_ prefix", () => {
    expect(createIssueId("s", "f")).toMatch(/^sh_/);
  });

  it("has consistent length (sh_ + 16 hex chars = 19)", () => {
    expect(createIssueId("source", "fingerprint")).toHaveLength(19);
  });
});

describe("DeduplicationWindow", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("isDuplicate returns false for new issue", () => {
    const w = new DeduplicationWindow();
    expect(w.isDuplicate("issue-1")).toBe(false);
  });

  it("isDuplicate returns true after mark within window", () => {
    const w = new DeduplicationWindow();
    w.mark("issue-1");
    expect(w.isDuplicate("issue-1")).toBe(true);
  });

  it("isDuplicate returns false after window expires", () => {
    const w = new DeduplicationWindow(1000); // 1 second window
    w.mark("issue-1");
    vi.advanceTimersByTime(1001);
    expect(w.isDuplicate("issue-1")).toBe(false);
  });

  it("size reflects tracked count", () => {
    const w = new DeduplicationWindow();
    w.mark("a");
    w.mark("b");
    expect(w.size).toBe(2);
  });

  it("cleanup removes expired entries", () => {
    const w = new DeduplicationWindow(1000);
    w.mark("a");
    vi.advanceTimersByTime(1001);
    w.cleanup();
    expect(w.size).toBe(0);
  });

  it("clear empties everything", () => {
    const w = new DeduplicationWindow();
    w.mark("a");
    w.mark("b");
    w.clear();
    expect(w.size).toBe(0);
  });
});
