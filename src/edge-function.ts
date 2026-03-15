/**
 * @emisso/self-healing — Edge Function Entrypoint
 *
 * This module exports handlers designed to run as:
 *   - Supabase Edge Functions (Deno)
 *   - Vercel Serverless Functions
 *   - Any HTTP handler
 *
 * It provides webhook handlers for:
 *   1. Vercel log drain webhooks
 *   2. Supabase database webhooks
 *   3. Manual trigger endpoint
 */

export { parseVercelLogs, verifyVercelSignature } from "./ingestion/vercel-drain";
export { parseSupabaseWebhook } from "./ingestion/supabase-monitor";
export { HealingPipeline } from "./pipeline";
export { SelfHealingConfigSchema } from "./types";
export type { SelfHealingConfig, VercelLogEntry, DetectedIssue } from "./types";
