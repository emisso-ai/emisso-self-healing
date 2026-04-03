import { describe, it, expect } from "vitest";
import { buildSlackMessage, getStatusEmoji, getSeverityColor } from "../src/notify/slack";
import { buildDiscordEmbed, severityToColor } from "../src/notify/discord";
import type { HealingNotification, DetectedIssue, HealingStatus } from "../src/types";

const makeNotification = (overrides: Partial<HealingNotification> = {}): HealingNotification => ({
  issue: {
    id: "i-1",
    title: "Auth error",
    source: "vercel-runtime",
    severity: "error",
    message: "Cannot read property",
    occurrenceCount: 5,
    firstSeen: new Date("2026-01-01"),
    lastSeen: new Date("2026-01-01"),
  },
  status: "detected",
  summary: "Detected: Auth error",
  timestamp: new Date("2026-01-01"),
  ...overrides,
});

describe("buildSlackMessage", () => {
  it("includes header and issue details", () => {
    const msg = buildSlackMessage(makeNotification(), "#ops");
    expect(msg.channel).toBe("#ops");
    expect(msg.text).toBe("Detected: Auth error");
    expect(msg.blocks).toBeDefined();
  });

  it("includes analysis when present", () => {
    const msg = buildSlackMessage(
      makeNotification({
        analysis: {
          issue: makeNotification().issue,
          rootCause: "Missing null check",
          confidence: 0.85,
          fix: [],
          fixExplanation: "Added guard",
          prTitle: "fix: guard",
          prBody: "",
          durationMs: 1000,
          filesExplored: [],
        },
      }),
      "#ops",
    );
    const text = JSON.stringify(msg.blocks);
    expect(text).toContain("Missing null check");
    expect(text).toContain("85%");
  });

  it("includes approve/reject buttons for pr-created status", () => {
    const msg = buildSlackMessage(
      makeNotification({
        status: "pr-created",
        pr: { number: 42, url: "https://github.com/o/r/pull/42", branch: "fix", title: "fix", created: true },
      }),
      "#ops",
    );
    const text = JSON.stringify(msg.blocks);
    expect(text).toContain("Approve & Merge");
    expect(text).toContain("Reject");
  });

  it("includes cost estimate when present", () => {
    const msg = buildSlackMessage(
      makeNotification({
        costEstimate: { claudeApiCost: 0.1, sandboxCost: 0.02, totalCost: 0.12, currency: "USD" },
      }),
      "#ops",
    );
    const text = JSON.stringify(msg.blocks);
    expect(text).toContain("Cost:");
  });
});

describe("getStatusEmoji", () => {
  const cases: Array<[HealingStatus, string]> = [
    ["pr-created", "\u{1F527}"],
    ["test-passed", "\u2705"],
    ["test-failed", "\u274C"],
    ["detected", "\u{1F50D}"],
    ["failed", "\u{1F4A5}"],
  ];
  for (const [status, emoji] of cases) {
    it(`${status} → ${emoji}`, () => {
      expect(getStatusEmoji(status)).toBe(emoji);
    });
  }
});

describe("getSeverityColor", () => {
  it("critical → red circle", () => expect(getSeverityColor("critical")).toBe("\u{1F534}"));
  it("error → orange circle", () => expect(getSeverityColor("error")).toBe("\u{1F7E0}"));
  it("warning → yellow circle", () => expect(getSeverityColor("warning")).toBe("\u{1F7E1}"));
  it("info → blue circle", () => expect(getSeverityColor("info")).toBe("\u{1F535}"));
});

describe("buildDiscordEmbed", () => {
  it("includes title, description, fields", () => {
    const embed = buildDiscordEmbed(makeNotification());
    expect(embed.title).toContain("Auth error");
    expect(embed.description).toContain("Cannot read property");
    expect((embed.fields as unknown[]).length).toBeGreaterThanOrEqual(3);
  });

  it("includes PR link when present", () => {
    const embed = buildDiscordEmbed(
      makeNotification({
        pr: { number: 42, url: "https://github.com/o/r/pull/42", branch: "fix", title: "fix", created: true },
      }),
    );
    const fields = embed.fields as Array<{ name: string; value: string }>;
    expect(fields.some((f) => f.name === "Pull Request")).toBe(true);
  });
});

describe("severityToColor", () => {
  it("critical → red (0xff0000)", () => expect(severityToColor("critical")).toBe(0xff0000));
  it("error → orange", () => expect(severityToColor("error")).toBe(0xffa500));
  it("warning → gold", () => expect(severityToColor("warning")).toBe(0xffd700));
  it("info → blue", () => expect(severityToColor("info")).toBe(0x3498db));
});
