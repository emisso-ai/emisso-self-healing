import type { HealingNotification, SelfHealingConfig, Severity } from "../types.js";

export async function sendDiscordNotification(
  notification: HealingNotification,
  config: SelfHealingConfig,
): Promise<void> {
  const discordConfig = config.notifications?.discord;
  if (!discordConfig) return;

  const embed = buildDiscordEmbed(notification);
  const response = await fetch(discordConfig.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: notification.summary, embeds: [embed] }),
  });

  if (!response.ok) {
    throw new Error(`Discord webhook failed: ${response.status} ${response.statusText}`);
  }
}

/** @internal Exported for testing */
export function buildDiscordEmbed(notification: HealingNotification): Record<string, unknown> {
  const { issue, analysis, testResult, pr } = notification;

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: "Source", value: issue.source, inline: true },
    { name: "Severity", value: issue.severity, inline: true },
    { name: "Occurrences", value: String(issue.occurrenceCount), inline: true },
  ];

  if (issue.filePath) {
    fields.push({ name: "File", value: `\`${issue.filePath}\`` });
  }
  if (analysis) {
    fields.push(
      { name: "Root Cause", value: analysis.rootCause.substring(0, 256) },
      { name: "Confidence", value: `${Math.round(analysis.confidence * 100)}%`, inline: true },
    );
  }
  if (testResult) {
    fields.push({ name: "Tests", value: testResult.passed ? "\u2705 Passed" : "\u274C Failed", inline: true });
  }
  if (pr?.url) {
    fields.push({ name: "Pull Request", value: `[#${pr.number}](${pr.url})` });
  }

  return {
    title: `Self-Healing: ${issue.title.substring(0, 100)}`,
    description: issue.message.substring(0, 500),
    color: severityToColor(issue.severity),
    fields,
    footer: { text: "@emisso/self-healing" },
    timestamp: notification.timestamp.toISOString(),
  };
}

/** @internal Exported for testing */
export function severityToColor(severity: Severity): number {
  switch (severity) {
    case "critical": return 0xff0000;
    case "error": return 0xffa500;
    case "warning": return 0xffd700;
    default: return 0x3498db;
  }
}
