/**
 * Vercel Log Drain — Ingests runtime/build logs from Vercel deployments
 *
 * Vercel sends log data to a configured webhook endpoint. This module
 * parses those payloads and extracts actionable errors.
 *
 * Docs: https://vercel.com/docs/drains
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { DetectedIssue, VercelLogEntry, Severity } from "../types";
import { createIssueId } from "./dedup";

/**
 * Parse a Vercel log drain webhook payload into detected issues.
 *
 * Log drains send batches of log entries. We filter for errors (5xx,
 * uncaught exceptions, build failures) and group them by fingerprint.
 */
export function parseVercelLogs(entries: VercelLogEntry[]): DetectedIssue[] {
  const issueMap = new Map<string, DetectedIssue>();

  for (const entry of entries) {
    if (!isActionableError(entry)) continue;

    // Pre-extract values to avoid duplicate regex work
    const errorType = extractErrorType(entry.message);
    const filePath = extractFilePath(entry.message);
    const fingerprint = computeFingerprint(entry, errorType, filePath);
    const existing = issueMap.get(fingerprint);
    const timestamp = new Date(entry.timestamp);

    if (existing) {
      existing.occurrenceCount += 1;
      existing.lastSeen = timestamp;
    } else {
      issueMap.set(fingerprint, {
        id: createIssueId("vercel", fingerprint),
        title: extractTitle(entry, errorType),
        source: mapSource(entry.source),
        severity: mapSeverity(entry),
        message: entry.message,
        stackTrace: extractStackTrace(entry.message),
        filePath,
        lineNumber: extractLineNumber(entry.message),
        occurrenceCount: 1,
        firstSeen: timestamp,
        lastSeen: timestamp,
        rawData: entry,
        context: {
          deploymentId: entry.deploymentId,
          projectId: entry.projectId,
          ...(entry.proxy && {
            statusCode: entry.proxy.statusCode,
            method: entry.proxy.method,
            path: entry.proxy.path,
          }),
        },
      });
    }
  }

  return Array.from(issueMap.values());
}

/**
 * Verify the Vercel log drain webhook signature.
 *
 * Vercel signs payloads with HMAC SHA1 using the integration secret.
 * The signature is sent in the `x-vercel-signature` header.
 */
export function verifyVercelSignature(
  body: string,
  signature: string,
  secret: string,
): boolean {
  if (!body || !signature || !secret) return false;

  try {
    const expected = createHmac("sha1", secret).update(body).digest("hex");
    const sigBuffer = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");

    if (sigBuffer.length !== expectedBuffer.length) return false;
    return timingSafeEqual(sigBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isActionableError(entry: VercelLogEntry): boolean {
  // Runtime errors (5xx status codes)
  if (entry.proxy?.statusCode && entry.proxy.statusCode >= 500) return true;

  // Error-level logs
  if (entry.level === "error") return true;

  // Build failures
  if (entry.source === "build" && entry.message.toLowerCase().includes("error")) return true;

  // Uncaught exceptions / unhandled rejections
  if (
    entry.message.includes("Unhandled") ||
    entry.message.includes("TypeError") ||
    entry.message.includes("ReferenceError") ||
    entry.message.includes("FATAL")
  ) {
    return true;
  }

  return false;
}

function computeFingerprint(
  entry: VercelLogEntry,
  errorType: string | undefined,
  filePath: string | undefined,
): string {
  const parts: string[] = [];

  if (errorType) parts.push(errorType);
  if (filePath) parts.push(filePath);

  if (entry.proxy?.statusCode) parts.push(String(entry.proxy.statusCode));
  if (entry.proxy?.path) parts.push(entry.proxy.path);

  if (parts.length === 0) parts.push(entry.message.substring(0, 100));

  return parts.join("|");
}

function extractErrorType(message: string): string | undefined {
  const match = message.match(/^(\w+Error):/);
  return match?.[1];
}

function extractTitle(entry: VercelLogEntry, errorType: string | undefined): string {
  if (errorType) {
    const firstLine = entry.message.split("\n")[0].substring(0, 120);
    return firstLine;
  }
  if (entry.proxy?.statusCode) {
    return `${entry.proxy.statusCode} on ${entry.proxy.method} ${entry.proxy.path}`;
  }
  return entry.message.split("\n")[0].substring(0, 120);
}

function extractStackTrace(message: string): string | undefined {
  const lines = message.split("\n");
  const stackStart = lines.findIndex((l) => l.trim().startsWith("at "));
  if (stackStart === -1) return undefined;
  return lines.slice(stackStart).join("\n");
}

function extractFilePath(message: string): string | undefined {
  // Match common patterns: /src/foo/bar.ts:42:10 or (src/foo/bar.ts:42)
  const match = message.match(/(?:\/|^|\s|\()((?:src|app|pages|lib|components|features)\/[\w/.-]+\.(?:ts|tsx|js|jsx))/);
  return match?.[1];
}

function extractLineNumber(message: string): number | undefined {
  const match = message.match(/\.(?:ts|tsx|js|jsx):(\d+)/);
  return match ? parseInt(match[1], 10) : undefined;
}

function mapSource(source: VercelLogEntry["source"]): DetectedIssue["source"] {
  switch (source) {
    case "lambda": return "vercel-runtime";
    case "edge": return "vercel-edge";
    case "build": return "vercel-build";
    case "static": return "vercel-runtime";
    default: return "vercel-runtime";
  }
}

function mapSeverity(entry: VercelLogEntry): Severity {
  if (entry.proxy?.statusCode && entry.proxy.statusCode >= 500) return "error";
  if (entry.message.includes("FATAL")) return "critical";
  if (entry.level === "error") return "error";
  if (entry.level === "warning") return "warning";
  return "info";
}
