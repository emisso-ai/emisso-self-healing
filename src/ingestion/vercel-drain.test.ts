import { describe, it, expect } from "vitest";
import { parseVercelLogs } from "./vercel-drain";
import type { VercelLogEntry } from "../types";

function makeEntry(overrides: Partial<VercelLogEntry> = {}): VercelLogEntry {
  return {
    id: "log_1",
    message: "Internal Server Error",
    timestamp: Date.now(),
    source: "lambda",
    projectId: "prj_123",
    deploymentId: "dpl_456",
    level: "error",
    ...overrides,
  };
}

describe("parseVercelLogs", () => {
  it("parses 5xx error logs into issues", () => {
    const entries: VercelLogEntry[] = [
      makeEntry({
        proxy: {
          statusCode: 500,
          method: "GET",
          path: "/api/products",
        },
      }),
    ];

    const issues = parseVercelLogs(entries);
    expect(issues).toHaveLength(1);
    expect(issues[0].source).toBe("vercel-runtime");
    expect(issues[0].severity).toBe("error");
    expect(issues[0].context).toMatchObject({
      statusCode: 500,
      method: "GET",
      path: "/api/products",
    });
  });

  it("extracts file paths from stack traces", () => {
    const entries: VercelLogEntry[] = [
      makeEntry({
        message:
          "TypeError: Cannot read properties of undefined\n" +
          "    at handler (src/features/products/api.ts:42:10)\n" +
          "    at processRequest (/var/task/node_modules/next/server.js:100:5)",
      }),
    ];

    const issues = parseVercelLogs(entries);
    expect(issues).toHaveLength(1);
    expect(issues[0].filePath).toBe("src/features/products/api.ts");
  });

  it("extracts line numbers", () => {
    const entries: VercelLogEntry[] = [
      makeEntry({
        message:
          "ReferenceError: foo is not defined\n" +
          "    at Object.<anonymous> (src/lib/utils.ts:17:3)",
      }),
    ];

    const issues = parseVercelLogs(entries);
    expect(issues).toHaveLength(1);
    expect(issues[0].lineNumber).toBe(17);
  });

  it("groups duplicate errors by fingerprint (increments occurrenceCount)", () => {
    const entries: VercelLogEntry[] = [
      makeEntry({
        id: "log_1",
        message: "TypeError: Cannot read properties of undefined\n    at handler (src/api/route.ts:10:5)",
        timestamp: 1000,
      }),
      makeEntry({
        id: "log_2",
        message: "TypeError: Cannot read properties of undefined\n    at handler (src/api/route.ts:10:5)",
        timestamp: 2000,
      }),
      makeEntry({
        id: "log_3",
        message: "TypeError: Cannot read properties of undefined\n    at handler (src/api/route.ts:10:5)",
        timestamp: 3000,
      }),
    ];

    const issues = parseVercelLogs(entries);
    expect(issues).toHaveLength(1);
    expect(issues[0].occurrenceCount).toBe(3);
    expect(issues[0].firstSeen).toEqual(new Date(1000));
    expect(issues[0].lastSeen).toEqual(new Date(3000));
  });

  it("ignores non-error logs (200 OK, info level)", () => {
    const entries: VercelLogEntry[] = [
      makeEntry({
        level: "info",
        message: "Request completed successfully",
        proxy: {
          statusCode: 200,
          method: "GET",
          path: "/api/health",
        },
      }),
      makeEntry({
        level: "info",
        message: "Server started on port 3000",
      }),
    ];

    const issues = parseVercelLogs(entries);
    expect(issues).toHaveLength(0);
  });

  it("handles build error logs", () => {
    const entries: VercelLogEntry[] = [
      makeEntry({
        source: "build",
        level: "error",
        message: "Type error: Property 'foo' does not exist on type 'Bar'",
      }),
    ];

    const issues = parseVercelLogs(entries);
    expect(issues).toHaveLength(1);
    expect(issues[0].source).toBe("vercel-build");
  });

  it("maps severity correctly: FATAL = critical, error level = error", () => {
    const fatalEntry = makeEntry({
      id: "log_fatal",
      level: "warning" as VercelLogEntry["level"],
      message: "FATAL: database connection pool exhausted",
    });
    const errorEntry = makeEntry({
      id: "log_error",
      level: "error",
      message: "Something went wrong in the handler",
      proxy: { statusCode: 500, method: "POST", path: "/api/data" },
    });

    const fatalIssues = parseVercelLogs([fatalEntry]);
    expect(fatalIssues).toHaveLength(1);
    expect(fatalIssues[0].severity).toBe("critical");

    const errorIssues = parseVercelLogs([errorEntry]);
    expect(errorIssues).toHaveLength(1);
    expect(errorIssues[0].severity).toBe("error");
  });

  it("extracts stack trace from multi-line messages", () => {
    const entries: VercelLogEntry[] = [
      makeEntry({
        message:
          "TypeError: Cannot read properties of null\n" +
          "    at getUser (src/features/auth/service.ts:55:12)\n" +
          "    at async handler (src/app/api/me/route.ts:8:20)",
      }),
    ];

    const issues = parseVercelLogs(entries);
    expect(issues).toHaveLength(1);
    expect(issues[0].stackTrace).toContain("at getUser");
    expect(issues[0].stackTrace).toContain("at async handler");
  });

  it("produces issues with sh_ prefixed IDs", () => {
    const entries: VercelLogEntry[] = [
      makeEntry({
        proxy: { statusCode: 502, method: "GET", path: "/api/test" },
      }),
    ];

    const issues = parseVercelLogs(entries);
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toMatch(/^sh_/);
  });
});
