import type { HealingNotification, SelfHealingConfig } from "../types.js";
import { sendSlackNotification } from "./slack.js";
import { sendDiscordNotification } from "./discord.js";

export async function notifyAll(
  notification: HealingNotification,
  config: SelfHealingConfig,
): Promise<void> {
  const promises: Promise<void>[] = [];

  if (config.notifications?.slack) {
    promises.push(
      sendSlackNotification(notification, config).catch((err) => {
        console.error("[self-healing] Slack notification failed:", err);
      }),
    );
  }
  if (config.notifications?.discord) {
    promises.push(
      sendDiscordNotification(notification, config).catch((err) => {
        console.error("[self-healing] Discord notification failed:", err);
      }),
    );
  }
  if (config.notifications?.custom) {
    promises.push(
      sendCustomWebhook(notification, config).catch((err) => {
        console.error("[self-healing] Custom webhook failed:", err);
      }),
    );
  }

  await Promise.allSettled(promises);
}

async function sendCustomWebhook(
  notification: HealingNotification,
  config: SelfHealingConfig,
): Promise<void> {
  const customConfig = config.notifications?.custom;
  if (!customConfig) return;

  const response = await fetch(customConfig.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...customConfig.headers },
    body: JSON.stringify(notification),
  });

  if (!response.ok) {
    throw new Error(`Custom webhook failed: ${response.status} ${response.statusText}`);
  }
}

export { sendSlackNotification } from "./slack.js";
export { sendDiscordNotification } from "./discord.js";
