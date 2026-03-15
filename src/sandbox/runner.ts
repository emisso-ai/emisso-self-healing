/**
 * Sandbox Runner — Tests AI-generated fixes in Vercel Sandbox
 *
 * Uses @vercel/sandbox to create isolated Firecracker microVMs,
 * clone the repo, apply the fix, and run tests.
 *
 * Pattern borrowed from emisso-app's VercelSandboxService.
 */

import type {
  AnalysisResult,
  FilePatch,
  SelfHealingConfig,
  TestResult,
} from "../types";

/** Timeout for git clone operations */
const CLONE_TIMEOUT_MS = 60_000;
/** Timeout for npm install */
const INSTALL_TIMEOUT_MS = 120_000;

/**
 * Test a fix in an isolated Vercel Sandbox.
 *
 * Flow:
 *   1. Create sandbox (or restore from snapshot)
 *   2. Clone the repository
 *   3. Install dependencies
 *   4. Apply the patches
 *   5. Run build command (if configured)
 *   6. Run test command
 *   7. Stop sandbox and return results
 */
export async function testFixInSandbox(
  analysis: AnalysisResult,
  config: SelfHealingConfig,
  options?: {
    signal?: AbortSignal;
  },
): Promise<TestResult> {
  const startTime = Date.now();

  // Dynamic import — keeps @vercel/sandbox optional
  const { Sandbox } = await import("@vercel/sandbox");

  const sandboxConfig: Record<string, unknown> = {
    runtime: config.sandbox.runtime,
    timeoutMs: config.sandbox.timeout,
  };

  // Use snapshot for faster startup if configured
  if (config.sandbox.snapshotId) {
    sandboxConfig.snapshotId = config.sandbox.snapshotId;
  }

  const sandbox = await Sandbox.create(sandboxConfig);
  const sandboxId = sandbox.sandboxId;

  try {
    // Clone the repository
    const cloneUrl = buildCloneUrl(config);
    const cloneController = new AbortController();
    const cloneTimer = setTimeout(() => cloneController.abort(), CLONE_TIMEOUT_MS);

    try {
      const cloneResult = await sandbox.runCommand({
        cmd: "git",
        args: ["clone", "--depth", "1", "--branch", config.github.baseBranch, cloneUrl, "/app"],
        signal: cloneController.signal,
      });

      if (cloneResult.exitCode !== 0) {
        const stderr = await cloneResult.stderr();
        return makeFailedResult(sandboxId, startTime, "Clone failed", stderr);
      }
    } finally {
      clearTimeout(cloneTimer);
    }

    // Install dependencies
    const installController = new AbortController();
    const installTimer = setTimeout(() => installController.abort(), INSTALL_TIMEOUT_MS);

    try {
      const installResult = await sandbox.runCommand({
        cmd: "npm",
        args: ["install", "--prefer-offline"],
        cwd: "/app",
        signal: installController.signal,
      });

      if (installResult.exitCode !== 0) {
        const stderr = await installResult.stderr();
        return makeFailedResult(sandboxId, startTime, "Install failed", stderr);
      }
    } finally {
      clearTimeout(installTimer);
    }

    // Apply patches
    await applyPatches(sandbox, analysis.fix);

    // Run build (if configured)
    let buildPassed: boolean | undefined;
    if (config.sandbox.buildCommand) {
      const [buildCmd, ...buildArgs] = config.sandbox.buildCommand.split(" ");
      const buildResult = await sandbox.runCommand({
        cmd: buildCmd,
        args: buildArgs,
        cwd: "/app",
        signal: options?.signal,
      });

      buildPassed = buildResult.exitCode === 0;
      if (!buildPassed) {
        const stderr = await buildResult.stderr();
        return {
          passed: false,
          exitCode: buildResult.exitCode,
          output: await buildResult.stdout(),
          errorOutput: stderr,
          durationMs: Date.now() - startTime,
          sandboxId,
          buildPassed: false,
        };
      }
    }

    // Run tests
    const [testCmd, ...testArgs] = config.sandbox.testCommand.split(" ");
    const testResult = await sandbox.runCommand({
      cmd: testCmd,
      args: testArgs,
      cwd: "/app",
      signal: options?.signal,
    });

    return {
      passed: testResult.exitCode === 0,
      exitCode: testResult.exitCode,
      output: await testResult.stdout(),
      errorOutput: await testResult.stderr(),
      durationMs: Date.now() - startTime,
      sandboxId,
      buildPassed,
    };
  } finally {
    await sandbox.stop().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function applyPatches(
  sandbox: {
    writeFiles: (files: Array<{ path: string; content: Buffer }>) => Promise<void>;
    runCommand: (params: { cmd: string; args?: string[]; cwd?: string }) => Promise<{ exitCode: number }>;
  },
  patches: FilePatch[],
): Promise<void> {
  // Write patches that have full content
  const filesToWrite = patches
    .filter((p): p is FilePatch & { content: string } => p.action !== "delete" && p.content != null)
    .map((p) => ({
      path: `/app/${p.filePath}`,
      content: Buffer.from(p.content, "utf-8"),
    }));

  if (filesToWrite.length > 0) {
    await sandbox.writeFiles(filesToWrite);
  }

  // Apply diff-based patches via `git apply`
  const diffPatches = patches.filter((p) => p.action === "modify" && !p.content && p.diff);
  for (const patch of diffPatches) {
    await sandbox.writeFiles([{
      path: "/tmp/fix.patch",
      content: Buffer.from(patch.diff!, "utf-8"),
    }]);
    await sandbox.runCommand({
      cmd: "git",
      args: ["apply", "/tmp/fix.patch"],
      cwd: "/app",
    });
  }
}

function buildCloneUrl(config: SelfHealingConfig): string {
  const { owner, repo, token } = config.github;
  return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
}

function makeFailedResult(
  sandboxId: string,
  startTime: number,
  reason: string,
  errorOutput: string,
): TestResult {
  return {
    passed: false,
    exitCode: 1,
    output: "",
    errorOutput: `${reason}: ${errorOutput}`,
    durationMs: Date.now() - startTime,
    sandboxId,
  };
}
