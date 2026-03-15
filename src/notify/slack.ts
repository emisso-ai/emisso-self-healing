/**
 * Slack Notifier — Sends structured messages with interactive approve/reject buttons
 *
 * Uses Slack Block Kit for rich formatting.
 * Docs: https://docs.slack.dev/block-kit/
 */

import type { HealingNotification, HealingStatus, SelfHealingConfig, Severity } from "../types";

/** Slack message payload using Block Kit */
interface SlackMessage {
  channel?: string;
  text: string;
  blocks: SlackBlock[];
}

type SlackBlock =
  | { type: "header"; text: { type: "plain_text"; text: string } }
  | { type: "section"; text: { type: "mrkdwn"; text: string } }
  | { type: "divider" }
  | { type: "actions"; elements: SlackAction[] }
  | { type: "context"; elements: Array<{ type: "mrkdwn"; text: string }> };

type SlackAction = {
  type: "button";
  text: { type: "plain_text"; text: string };
  style?: "primary" | "danger";
  url?: string;
  action_id: string;
  value?: string;
};

/**
 * Send a healing notification to Slack.
 *
 * Supports both:
 *   - Incoming Webhooks (simple, no auth needed)
 *   - Web API (requires bot token, supports interactive components)
 */
export async function sendSlackNotification(
  notification: HealingNotification,
  config: SelfHealingConfig,
): Promise<void> {
  const slackConfig = config.notifications?.slack;
  if (!slackConfig) return;

  const message = buildSlackMessage(notification, slackConfig.channel);

  if (slackConfig.webhookUrl) {
    // Simple webhook — no interactive buttons
    const response = await fetch(slackConfig.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
    if (!response.ok) {
      throw new Error(`Slack webhook failed: ${response.status} ${response.statusText}`);
    }
  } else if (slackConfig.token) {
    // Web API — supports interactive components
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${slackConfig.token}`,
      },
      body: JSON.stringify(message),
    });
    if (!response.ok) {
      throw new Error(`Slack API failed: ${response.status} ${response.statusText}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Message building
// ---------------------------------------------------------------------------

function buildSlackMessage(
  notification: HealingNotification,
  channel: string,
): SlackMessage {
  const { issue, analysis, testResult, pr, status, summary } = notification;
  const statusEmoji = getStatusEmoji(status);
  const severityColor = getSeverityColor(issue.severity);

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${statusEmoji} Self-Healing Alert`,
      },
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `*${issue.title}*`,
          `*Source:* ${issue.source} | *Severity:* ${severityColor} ${issue.severity}`,
          `*Occurrences:* ${issue.occurrenceCount}${issue.affectedUsers ? ` | *Users Affected:* ${issue.affectedUsers}` : ""}`,
        ].join("\n"),
      },
    },
  ];

  // Error details
  if (issue.filePath) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*File:* \`${issue.filePath}${issue.lineNumber ? `:${issue.lineNumber}` : ""}\``,
      },
    });
  }

  // Analysis results
  if (analysis) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          "*Root Cause*",
          analysis.rootCause,
          "",
          "*Fix*",
          analysis.fixExplanation.substring(0, 500),
          "",
          `*Confidence:* ${Math.round(analysis.confidence * 100)}%`,
        ].join("\n"),
      },
    });
  }

  // Test results
  if (testResult) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: testResult.passed
          ? `*Tests:* :white_check_mark: All tests passed (${(testResult.durationMs / 1000).toFixed(1)}s)`
          : `*Tests:* :x: Tests failed (exit code ${testResult.exitCode})`,
      },
    });
  }

  // PR link and actions
  if (pr?.url) {
    const actions: SlackAction[] = [
      {
        type: "button",
        text: { type: "plain_text", text: "View PR" },
        url: pr.url,
        action_id: "view_pr",
      },
    ];

    if (notification.status === "pr-created") {
      actions.unshift(
        {
          type: "button",
          text: { type: "plain_text", text: "Approve & Merge" },
          style: "primary",
          action_id: `approve_${pr.number}`,
          value: String(pr.number),
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Reject" },
          style: "danger",
          action_id: `reject_${pr.number}`,
          value: String(pr.number),
        },
      );
    }

    blocks.push({ type: "actions", elements: actions });
  }

  // Cost estimate
  if (notification.costEstimate) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Cost: $${notification.costEstimate.totalCost.toFixed(4)} | Generated by @emisso/self-healing`,
        },
      ],
    });
  }

  return {
    channel,
    text: summary,
    blocks,
  };
}

function getStatusEmoji(status: HealingStatus): string {
  switch (status) {
    case "pr-created": return "\uD83D\uDD27";
    case "test-passed": return "\u2705";
    case "test-failed": return "\u274C";
    case "detected": return "\uD83D\uDD0D";
    case "analyzing": return "\uD83E\uDDE0";
    case "merged": return "\uD83C\uDF89";
    case "rejected": return "\uD83D\uDEAB";
    case "skipped": return "\u23ED\uFE0F";
    case "failed": return "\uD83D\uDCA5";
    default: return "\uD83D\uDCCB";
  }
}

function getSeverityColor(severity: Severity): string {
  switch (severity) {
    case "critical": return "\uD83D\uDD34";
    case "error": return "\uD83D\uDFE0";
    case "warning": return "\uD83D\uDFE1";
    default: return "\uD83D\uDD35";
  }
}
