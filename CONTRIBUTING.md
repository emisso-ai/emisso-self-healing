# Contributing to @emisso/self-healing

Thanks for your interest in contributing!

## Getting Started

```bash
git clone https://github.com/emisso-ai/emisso-self-healing.git
cd emisso-self-healing
pnpm install
pnpm build
pnpm test:run
pnpm lint
```

## Project Structure

```
src/
  index.ts              Main exports
  types.ts              Zod config schema + types
  pipeline.ts           Full healing flow orchestrator
  edge-function.ts      Lightweight webhook entrypoint
  ingestion/            Vercel log drain, Supabase monitoring, dedup
  analysis/             Claude Agent SDK integration, triage
  sandbox/              Vercel Sandbox test runner
  repair/               GitHub PR creation
  notify/               Slack Block Kit, Discord webhooks
```

## Development Workflow

1. **Fork** and create a branch from `main`
2. **Make changes** following the conventions below
3. **Add a changeset**: `pnpm changeset`
4. **Verify**: `pnpm build && pnpm lint && pnpm test:run`
5. **Open a PR**

## Conventions

- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) — `feat(sandbox):`, `fix(triage):`, etc.
- **TypeScript strict**, Zod at boundaries
- **Safety guardrails are sacred** — never weaken default safety settings (no auto-merge, path exclusions, rate limits)
- **Tests:** Vitest

## Safety Rules for Contributors

Any PR that touches the safety module must:

1. Preserve all default guardrails
2. Never allow auto-merge without explicit `autoMerge: true` in config
3. Never allow modifications to excluded paths (migrations, secrets, .env)
4. Include tests verifying guardrails still hold

## Ideas Welcome

- New monitoring sources (Sentry, Datadog, CloudWatch)
- Additional notification channels (Teams, email, PagerDuty)
- Smarter triage heuristics
- Fix confidence scoring improvements
- Documentation and examples

## Reporting Issues

- **Bugs:** Include steps to reproduce and your environment
- **Features:** Describe the use case
- **Security:** Email hello@emisso.ai (see [SECURITY.md](./SECURITY.md))

## License

By contributing, you agree your contributions are licensed under [MIT](./LICENSE).
