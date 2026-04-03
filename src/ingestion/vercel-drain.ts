import { createHmac, timingSafeEqual } from "crypto";
import type { DetectedIssue, IssueSource, Severity, VercelLogEntry } from "../types.js";
import { createIssueId } from "./dedup.js";

export function parseVercelLogs(entries: VercelLogEntry[]): DetectedIssue[] {
  const issueMap = new Map<string, DetectedIssue>();

  for (const entry of entries) {
    if (!isActionableError(entry)) continue;

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

/** @internal Exported for testing */
export function isActionableError(entry: VercelLogEntry): boolean {
  if (entry.proxy?.statusCode && entry.proxy.statusCode >= 500) return true;
  if (entry.level === "error") return true;
  if (entry.source === "build" && entry.message.toLowerCase().includes("error")) return true;
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

/** @internal Exported for testing */
export function extractErrorType(message: string): string | undefined {
  const match = message.match(/^(\w+Error):/);
  return match?.[1];
}

function extractTitle(entry: VercelLogEntry, errorType: string | undefined): string {
  if (errorType) {
    return entry.message.split("\n")[0]!.substring(0, 120);
  }
  if (entry.proxy?.statusCode) {
    return `${entry.proxy.statusCode} on ${entry.proxy.method} ${entry.proxy.path}`;
  }
  return entry.message.split("\n")[0]!.substring(0, 120);
}

/** @internal Exported for testing */
export function extractStackTrace(message: string): string | undefined {
  const lines = message.split("\n");
  const stackStart = lines.findIndex((l) => l.trim().startsWith("at "));
  if (stackStart === -1) return undefined;
  return lines.slice(stackStart).join("\n");
}

/** @internal Exported for testing */
export function extractFilePath(message: string): string | undefined {
  const match = message.match(
    /(?:\/|^|\s|\()((?:src|app|pages|lib|components|features)\/[\w/.-]+\.(?:ts|tsx|js|jsx))/,
  );
  return match?.[1];
}

/** @internal Exported for testing */
export function extractLineNumber(message: string): number | undefined {
  const match = message.match(/\.(?:ts|tsx|js|jsx):(\d+)/);
  return match ? parseInt(match[1]!, 10) : undefined;
}

function mapSource(source: VercelLogEntry["source"]): IssueSource {
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
