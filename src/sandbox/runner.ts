import type { AnalysisResult, SelfHealingConfig, TestResult, FilePatch } from "../types.js";

const CLONE_TIMEOUT_MS = 60_000;
const INSTALL_TIMEOUT_MS = 120_000;

interface SandboxInstance {
  sandboxId: string;
  stop(): Promise<void>;
  writeFiles(files: Array<{ path: string; content: Buffer }>): Promise<void>;
  runCommand(params: {
    cmd: string;
    args?: string[];
    cwd?: string;
    signal?: AbortSignal;
  }): Promise<{ exitCode: number; stdout(): Promise<string>; stderr(): Promise<string> }>;
}

export async function testFixInSandbox(
  analysis: AnalysisResult,
  config: SelfHealingConfig,
  options?: { signal?: AbortSignal },
): Promise<TestResult> {
  const startTime = Date.now();
  const { Sandbox } = await import("@vercel/sandbox");

  const sandboxConfig: Record<string, unknown> = {
    runtime: config.sandbox.runtime,
    timeoutMs: config.sandbox.timeout,
  };
  if (config.sandbox.snapshotId) {
    sandboxConfig.snapshotId = config.sandbox.snapshotId;
  }

  const sandbox = await Sandbox.create(sandboxConfig) as unknown as SandboxInstance;
  const sandboxId = sandbox.sandboxId;

  try {
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

    await applyPatches(sandbox, analysis.fix);

    let buildPassed: boolean | undefined;
    if (config.sandbox.buildCommand) {
      const [buildCmd, ...buildArgs] = config.sandbox.buildCommand.split(" ");
      const buildResult = await sandbox.runCommand({
        cmd: buildCmd!,
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

    const [testCmd, ...testArgs] = config.sandbox.testCommand.split(" ");
    const testResult = await sandbox.runCommand({
      cmd: testCmd!,
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

/** @internal Exported for testing */
export async function applyPatches(
  sandbox: SandboxInstance,
  patches: FilePatch[],
): Promise<void> {
  const filesToWrite = patches
    .filter((p) => p.action !== "delete" && p.content != null)
    .map((p) => ({ path: `/app/${p.filePath}`, content: Buffer.from(p.content!, "utf-8") }));

  if (filesToWrite.length > 0) {
    await sandbox.writeFiles(filesToWrite);
  }

  const diffPatches = patches.filter((p) => p.action === "modify" && !p.content && p.diff);
  for (const patch of diffPatches) {
    await sandbox.writeFiles([{ path: "/tmp/fix.patch", content: Buffer.from(patch.diff!, "utf-8") }]);
    await sandbox.runCommand({ cmd: "git", args: ["apply", "/tmp/fix.patch"], cwd: "/app" });
  }
}

/** @internal Exported for testing */
export function buildCloneUrl(config: SelfHealingConfig): string {
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
