import { describe, it, expect } from "vitest";
import { SelfHealingConfigSchema } from "../src/types";

const validConfig = {
  github: { owner: "org", repo: "app", token: "ghp_test" },
  claude: { apiKey: "sk-test" },
  sandbox: {},
  sources: {},
};

describe("SelfHealingConfigSchema", () => {
  it("minimal valid config parses", () => {
    const parsed = SelfHealingConfigSchema.parse(validConfig);
    expect(parsed.github.owner).toBe("org");
    expect(parsed.github.repo).toBe("app");
  });

  it("applies defaults", () => {
    const parsed = SelfHealingConfigSchema.parse(validConfig);
    expect(parsed.github.baseBranch).toBe("main");
    expect(parsed.claude.model).toBe("claude-sonnet-4-6");
    expect(parsed.claude.maxTurns).toBe(30);
    expect(parsed.sandbox.runtime).toBe("node24");
    expect(parsed.sandbox.testCommand).toBe("npm test -- --run");
    expect(parsed.sandbox.timeout).toBe(300_000);
  });

  it("safety defaults", () => {
    const parsed = SelfHealingConfigSchema.parse(validConfig);
    expect(parsed.safety.maxPRsPerHour).toBe(3);
    expect(parsed.safety.minConfidence).toBe(0.8);
    expect(parsed.safety.requireTests).toBe(true);
    expect(parsed.safety.autoMerge).toBe(false);
    expect(parsed.safety.dryRun).toBe(false);
  });

  it("excludePaths default includes critical patterns", () => {
    const parsed = SelfHealingConfigSchema.parse(validConfig);
    expect(parsed.safety.excludePaths).toContain("migrations/");
    expect(parsed.safety.excludePaths).toContain(".env");
    expect(parsed.safety.excludePaths).toContain("*.key");
    expect(parsed.safety.excludePaths).toContain("*.pem");
  });

  it("missing github → throws", () => {
    expect(() => SelfHealingConfigSchema.parse({ claude: { apiKey: "k" }, sandbox: {}, sources: {} })).toThrow();
  });

  it("missing claude → throws", () => {
    expect(() => SelfHealingConfigSchema.parse({ github: { owner: "o", repo: "r", token: "t" }, sandbox: {}, sources: {} })).toThrow();
  });

  it("optional notifications accepted", () => {
    const parsed = SelfHealingConfigSchema.parse({
      ...validConfig,
      notifications: { slack: { channel: "#ops" }, discord: { webhookUrl: "https://discord.com/hook" } },
    });
    expect(parsed.notifications?.slack?.channel).toBe("#ops");
    expect(parsed.notifications?.discord?.webhookUrl).toBe("https://discord.com/hook");
  });

  it("optional sources accepted", () => {
    const parsed = SelfHealingConfigSchema.parse({
      ...validConfig,
      sources: { vercel: { token: "vt", projectId: "pid" } },
    });
    expect(parsed.sources.vercel?.token).toBe("vt");
  });
});
