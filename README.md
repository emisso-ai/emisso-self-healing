# @emisso/self-healing

Self-healing SDK for Next.js + Supabase + Vercel applications. Monitors production errors, generates AI-powered fixes, tests them in sandboxed environments, and creates PRs with human approval.

## How It Works

```
Production Error → Log Ingestion → AI Analysis → Sandbox Testing → GitHub PR → Slack Notification
```

1. **Detect** — Ingests errors from Vercel log drains and Supabase monitoring
2. **Triage** — Classifies severity and decides whether to auto-fix or alert
3. **Analyze** — Uses Claude Agent SDK to read your codebase and generate a fix
4. **Test** — Runs tests in an isolated Vercel Sandbox (Firecracker microVM)
5. **PR** — Creates a GitHub pull request with detailed context
6. **Notify** — Sends Slack/Discord notification with approve/reject buttons

## Install

```bash
npm install @emisso/self-healing
```

### Peer Dependencies (optional)

```bash
# For AI-powered fix generation
npm install @anthropic-ai/claude-agent-sdk

# For sandboxed testing
npm install @vercel/sandbox

# For GitHub PR creation
npm install octokit
```

## Quick Start

```typescript
import { HealingPipeline, parseVercelLogs, SelfHealingConfigSchema } from "@emisso/self-healing";

const config = SelfHealingConfigSchema.parse({
  github: {
    owner: "your-org",
    repo: "your-app",
    token: process.env.GITHUB_TOKEN,
    baseBranch: "main",
  },
  claude: {
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
  sandbox: {
    testCommand: "npm test -- --run",
  },
  notifications: {
    slack: {
      webhookUrl: process.env.SLACK_WEBHOOK_URL,
      channel: "#ops",
    },
  },
});

const pipeline = new HealingPipeline(config);

// Listen for events
pipeline.on((event) => {
  console.log(`[self-healing] ${event.type}`);
});

// Process Vercel log drain webhook
export async function POST(request: Request) {
  const entries = await request.json();
  const issues = parseVercelLogs(entries);
  const notifications = await pipeline.processIssues(issues);
  return Response.json({ processed: notifications.length });
}
```

## Configuration

```typescript
const config = {
  // Repository
  github: {
    owner: "agency",
    repo: "client-app",
    token: process.env.GITHUB_TOKEN,
    baseBranch: "main",
  },

  // AI Engine
  claude: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: "claude-sonnet-4-6",
    maxTurns: 30,
  },

  // Sandbox Testing
  sandbox: {
    runtime: "node24",
    testCommand: "npm test -- --run",
    buildCommand: "npm run build",
    timeout: 300_000,
    snapshotId: "snap_xxx", // Optional: pre-built snapshot for faster starts
  },

  // Monitoring Sources
  sources: {
    vercel: {
      token: process.env.VERCEL_TOKEN,
      projectId: process.env.VERCEL_PROJECT_ID,
    },
    supabase: {
      url: process.env.SUPABASE_URL,
      serviceKey: process.env.SUPABASE_SERVICE_KEY,
      projectRef: "your-project-ref",
    },
  },

  // Notifications
  notifications: {
    slack: {
      token: process.env.SLACK_BOT_TOKEN,
      channel: "#client-app-ops",
      approvalRequired: true,
    },
    discord: {
      webhookUrl: process.env.DISCORD_WEBHOOK_URL,
    },
  },

  // Safety Guardrails
  safety: {
    maxPRsPerHour: 3,
    minConfidence: 0.8,
    excludePaths: ["migrations/", ".env", "secrets/"],
    requireTests: true,
    autoMerge: false,
    dryRun: false,
  },
};
```

## Modules

### Ingestion

```typescript
import { parseVercelLogs, detectSlowQueries, parseSupabaseWebhook } from "@emisso/self-healing";

// Parse Vercel log drain webhook
const issues = parseVercelLogs(logEntries);

// Detect slow Supabase queries
const slowQueryIssues = await detectSlowQueries(supabaseConfig);

// Parse Supabase database webhook
const issue = parseSupabaseWebhook(webhookPayload);
```

### Analysis

```typescript
import { analyzeIssue, triageIssue } from "@emisso/self-healing";

// Triage before spending API credits
const decision = triageIssue(issue, config);
if (decision.shouldFix) {
  const analysis = await analyzeIssue(issue, config, { cwd: "/app" });
}
```

### Sandbox Testing

```typescript
import { testFixInSandbox } from "@emisso/self-healing";

const testResult = await testFixInSandbox(analysis, config);
if (testResult.passed) {
  // Safe to create PR
}
```

### PR Creation

```typescript
import { createFixPR } from "@emisso/self-healing";

const pr = await createFixPR(analysis, testResult, config);
console.log(`PR created: ${pr.url}`);
```

### Notifications

```typescript
import { sendSlackNotification, notifyAll } from "@emisso/self-healing";

// Send to all configured channels
await notifyAll(notification, config);
```

## Safety

Non-negotiable guardrails:

- **Never auto-merges** — Human approval required by default
- **Never modifies migrations** — Database schema changes are excluded
- **Never touches secrets** — `.env`, `*.key`, `*.pem` are excluded
- **Rate limited** — Max 3 PRs per hour per project (configurable)
- **Confidence threshold** — Only creates PRs above 80% confidence (configurable)
- **Sandbox tested** — Fixes must pass tests before PR creation
- **Dry run mode** — Test the pipeline without creating real PRs

## Cost

| Component | Cost | Notes |
|-----------|------|-------|
| Claude Sonnet 4.6 | ~$0.10-0.50/fix | Input/output tokens |
| Vercel Sandbox | ~$0.005-0.02/test | Active CPU pricing |
| GitHub API | Free | Standard usage |
| Slack API | Free | Bot token |
| **Per fix attempt** | **~$0.10-0.55** | |

Estimated: **$5-50/month** per project depending on error frequency.

## Architecture

```
@emisso/self-healing/
├── src/
│   ├── index.ts              # Main exports
│   ├── types.ts              # All types + Zod config schema
│   ├── pipeline.ts           # Orchestrates the full healing flow
│   ├── edge-function.ts      # Lightweight entrypoint for webhooks
│   ├── ingestion/
│   │   ├── vercel-drain.ts   # Vercel log drain parser
│   │   ├── supabase-monitor.ts # Supabase monitoring
│   │   └── dedup.ts          # Issue deduplication
│   ├── analysis/
│   │   ├── claude-analyzer.ts # Claude Agent SDK integration
│   │   └── triage.ts         # Issue classification
│   ├── sandbox/
│   │   └── runner.ts         # Vercel Sandbox test runner
│   ├── repair/
│   │   └── github.ts         # GitHub PR creation
│   └── notify/
│       ├── slack.ts          # Slack Block Kit messages
│       └── discord.ts        # Discord webhook embeds
```

## License

MIT
