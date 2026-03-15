import { describe, it, expect, vi, afterEach } from "vitest";
import { createIssueId, DeduplicationWindow } from "./dedup";

describe("createIssueId", () => {
  it("produces deterministic IDs (same input = same output)", () => {
    const a = createIssueId("vercel", "TypeError|src/foo.ts|500");
    const b = createIssueId("vercel", "TypeError|src/foo.ts|500");
    expect(a).toBe(b);
  });

  it("produces different IDs for different inputs", () => {
    const a = createIssueId("vercel", "TypeError|src/foo.ts|500");
    const b = createIssueId("vercel", "ReferenceError|src/bar.ts|502");
    expect(a).not.toBe(b);
  });

  it("produces different IDs for different sources with same fingerprint", () => {
    const a = createIssueId("vercel", "same-fingerprint");
    const b = createIssueId("supabase", "same-fingerprint");
    expect(a).not.toBe(b);
  });

  it("has the sh_ prefix", () => {
    const id = createIssueId("vercel", "some-fingerprint");
    expect(id).toMatch(/^sh_[a-f0-9]{16}$/);
  });
});

describe("DeduplicationWindow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("isDuplicate returns false for new issues", () => {
    const window = new DeduplicationWindow();
    expect(window.isDuplicate("sh_abc123")).toBe(false);
  });

  it("isDuplicate returns true for recently seen issues", () => {
    const window = new DeduplicationWindow();
    window.mark("sh_abc123");
    expect(window.isDuplicate("sh_abc123")).toBe(true);
  });

  it("isDuplicate returns false for expired issues", () => {
    const window = new DeduplicationWindow(1000); // 1 second window
    const now = Date.now();

    // Mark at time T
    vi.spyOn(Date, "now").mockReturnValue(now);
    window.mark("sh_abc123");

    // Check at T + 2s (past the 1s window)
    vi.spyOn(Date, "now").mockReturnValue(now + 2000);
    expect(window.isDuplicate("sh_abc123")).toBe(false);
  });

  it("cleanup removes expired entries", () => {
    const window = new DeduplicationWindow(1000);
    const now = Date.now();

    vi.spyOn(Date, "now").mockReturnValue(now);
    window.mark("sh_expired");
    window.mark("sh_fresh");

    // Advance time past the window for the first entry only
    vi.spyOn(Date, "now").mockReturnValue(now + 1500);
    // Re-mark the fresh one so it stays within window
    window.mark("sh_fresh");

    window.cleanup();
    expect(window.size).toBe(1);
    expect(window.isDuplicate("sh_expired")).toBe(false);
    expect(window.isDuplicate("sh_fresh")).toBe(true);
  });

  it("size tracks count", () => {
    const window = new DeduplicationWindow();
    expect(window.size).toBe(0);
    window.mark("sh_1");
    expect(window.size).toBe(1);
    window.mark("sh_2");
    expect(window.size).toBe(2);
    // Marking the same ID again doesn't increase size
    window.mark("sh_1");
    expect(window.size).toBe(2);
  });

  it("clear resets everything", () => {
    const window = new DeduplicationWindow();
    window.mark("sh_1");
    window.mark("sh_2");
    window.mark("sh_3");
    expect(window.size).toBe(3);

    window.clear();
    expect(window.size).toBe(0);
    expect(window.isDuplicate("sh_1")).toBe(false);
    expect(window.isDuplicate("sh_2")).toBe(false);
    expect(window.isDuplicate("sh_3")).toBe(false);
  });
});
