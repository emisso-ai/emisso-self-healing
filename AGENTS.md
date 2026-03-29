# @emisso/self-healing

> Self-healing SDK for Next.js + Supabase + Vercel applications — monitors production errors, generates AI-powered fixes, tests them in sandboxed environments, and creates PRs with human approval.

## Overview

@emisso/self-healing automates the error-to-fix cycle: detect production errors from Vercel log drains or Supabase monitoring, triage severity, use Claude Agent SDK to analyze your codebase and generate a fix, test the fix in a Vercel Sandbox microVM, create a GitHub PR, and notify via Slack/Discord.

## Architecture

```
Production Error → Log Ingestion → AI Analysis → Sandbox Testing → GitHub PR → Slack Notification
```

Single package with modular internals:

- **Ingestion** — Vercel log drain parser, Supabase monitoring, deduplication
- **Analysis** — Claude Agent SDK integration, severity triage
- **Sandbox** — Vercel Sandbox (Firecracker microVM) test runner
- **Repair** — GitHub PR creation with context
- **Notify** — Slack Block Kit, Discord webhook embeds
- **Pipeline** — Orchestrates the full flow with safety guardrails

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Public API exports |
| `src/types.ts` | Zod config schema + TypeScript types |
| `src/pipeline.ts` | Main healing pipeline orchestrator |
| `src/edge-function.ts` | Lightweight webhook entrypoint |
| `src/ingestion/vercel-drain.ts` | Vercel log drain parser |
| `src/ingestion/supabase-monitor.ts` | Supabase monitoring |
| `src/ingestion/dedup.ts` | Issue deduplication |
| `src/analysis/claude-analyzer.ts` | Claude Agent SDK integration |
| `src/analysis/triage.ts` | Issue classification + severity |
| `src/sandbox/runner.ts` | Vercel Sandbox test runner |
| `src/repair/github.ts` | GitHub PR creation |
| `src/notify/slack.ts` | Slack Block Kit messages |
| `src/notify/discord.ts` | Discord webhook embeds |

## Safety Invariants

These are non-negotiable and must never be weakened:

- **Never auto-merges** — human approval required by default
- **Never modifies migrations** — database schema changes excluded
- **Never touches secrets** — `.env`, `*.key`, `*.pem` excluded
- **Rate limited** — max 3 PRs/hour per project
- **Confidence threshold** — only creates PRs above 80% confidence
- **Sandbox tested** — fixes must pass tests before PR creation

## Development

```bash
pnpm install              # Install dependencies
pnpm build                # Build (tsup)
pnpm test                 # Run tests (vitest, watch mode)
pnpm test:run             # Run tests (CI mode)
pnpm lint                 # Typecheck (tsc --noEmit)
```

## Code Conventions

- TypeScript strict mode, Zod for all config validation
- Safety guardrails are sacred — never weaken defaults
- Conventional Commits for git messages
- Changesets for versioning
