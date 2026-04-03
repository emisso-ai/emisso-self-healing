import { describe, it, expect } from "vitest";
import {
  parseVercelLogs,
  verifyVercelSignature,
  isActionableError,
  extractErrorType,
  extractFilePath,
  extractLineNumber,
  extractStackTrace,
} from "../src/ingestion/vercel-drain";
import { createHmac } from "crypto";
import type { VercelLogEntry } from "../src/types";

const makeEntry = (overrides: Partial<VercelLogEntry> = {}): VercelLogEntry => ({
  id: "log-1",
  message: "Error occurred",
  timestamp: Date.now(),
  source: "lambda",
  projectId: "proj-1",
  deploymentId: "dpl-1",
  level: "error",
  ...overrides,
});

describe("parseVercelLogs", () => {
  it("500 status → produces error issue", () => {
    const issues = parseVercelLogs([
      makeEntry({ proxy: { statusCode: 500, method: "GET", path: "/api/users" } }),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("error");
  });

  it("error level → produces issue", () => {
    const issues = parseVercelLogs([makeEntry({ level: "error", message: "Something failed" })]);
    expect(issues).toHaveLength(1);
  });

  it("build error → detected", () => {
    const issues = parseVercelLogs([
      makeEntry({ source: "build", level: "info", message: "Build Error: Module not found" }),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.source).toBe("vercel-build");
  });

  it("deduplicates same fingerprint", () => {
    const entries = [
      makeEntry({ message: "TypeError: Cannot read property 'x' of null", timestamp: 1000 }),
      makeEntry({ message: "TypeError: Cannot read property 'x' of null", timestamp: 2000 }),
    ];
    const issues = parseVercelLogs(entries);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.occurrenceCount).toBe(2);
  });

  it("extracts error type from message", () => {
    const issues = parseVercelLogs([
      makeEntry({ message: "TypeError: foo is not a function\n  at bar (src/utils.ts:10)" }),
    ]);
    expect(issues[0]!.title).toContain("TypeError");
  });

  it("extracts file path from stack", () => {
    const issues = parseVercelLogs([
      makeEntry({ message: "Error at src/auth/login.ts:42\n  at handler" }),
    ]);
    expect(issues[0]!.filePath).toBe("src/auth/login.ts");
  });

  it("ignores non-actionable entries", () => {
    const issues = parseVercelLogs([
      makeEntry({ level: "info", message: "Request received", source: "lambda" }),
    ]);
    expect(issues).toHaveLength(0);
  });
});

describe("verifyVercelSignature", () => {
  it("valid signature → true", () => {
    const secret = "my-secret";
    const body = '{"test":"data"}';
    const sig = createHmac("sha1", secret).update(body).digest("hex");
    expect(verifyVercelSignature(body, sig, secret)).toBe(true);
  });

  it("invalid signature → false", () => {
    expect(verifyVercelSignature('{"test":"data"}', "0000000000000000000000000000000000000000", "secret")).toBe(false);
  });

  it("missing params → false", () => {
    expect(verifyVercelSignature("", "sig", "secret")).toBe(false);
    expect(verifyVercelSignature("body", "", "secret")).toBe(false);
    expect(verifyVercelSignature("body", "sig", "")).toBe(false);
  });
});

describe("isActionableError", () => {
  it("500 status is actionable", () => {
    expect(isActionableError(makeEntry({ proxy: { statusCode: 500, method: "GET", path: "/" } }))).toBe(true);
  });

  it("200 status + info level is not actionable", () => {
    expect(isActionableError(makeEntry({ level: "info", proxy: { statusCode: 200, method: "GET", path: "/" } }))).toBe(false);
  });

  it("Unhandled in message is actionable", () => {
    expect(isActionableError(makeEntry({ level: "info", message: "Unhandled promise rejection" }))).toBe(true);
  });
});

describe("extractErrorType", () => {
  it("extracts TypeError", () => {
    expect(extractErrorType("TypeError: foo")).toBe("TypeError");
  });

  it("returns undefined for non-error", () => {
    expect(extractErrorType("Something happened")).toBeUndefined();
  });
});

describe("extractFilePath", () => {
  it("extracts src/ path", () => {
    expect(extractFilePath("Error at src/auth.ts:42")).toBe("src/auth.ts");
  });

  it("extracts app/ path", () => {
    expect(extractFilePath("in app/api/route.ts")).toBe("app/api/route.ts");
  });

  it("returns undefined when no path", () => {
    expect(extractFilePath("Generic error")).toBeUndefined();
  });
});

describe("extractLineNumber", () => {
  it("extracts line number from .ts:42", () => {
    expect(extractLineNumber("src/auth.ts:42")).toBe(42);
  });

  it("returns undefined when no line", () => {
    expect(extractLineNumber("no line info")).toBeUndefined();
  });
});

describe("extractStackTrace", () => {
  it("extracts stack starting from 'at'", () => {
    const msg = "Error: bad\n  at foo (src/a.ts:1)\n  at bar (src/b.ts:2)";
    expect(extractStackTrace(msg)).toContain("at foo");
  });

  it("returns undefined when no stack", () => {
    expect(extractStackTrace("Just a message")).toBeUndefined();
  });
});
