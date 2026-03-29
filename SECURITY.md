# Security Policy

## Reporting a Vulnerability

**Do not open a public issue.** Email **hello@emisso.ai** with:

- Description of the vulnerability
- Steps to reproduce
- Potential impact

We will acknowledge within 48 hours and aim to fix critical issues within 7 days.

## Sensitive Areas

This SDK creates GitHub PRs, executes code in sandboxes, and handles API tokens for multiple services. Issues in these areas are treated with highest priority:

- **Code execution** — the sandbox runner executes AI-generated code (`src/sandbox/`)
- **GitHub access** — PR creation with write permissions (`src/repair/github.ts`)
- **Token handling** — Anthropic, GitHub, Vercel, Supabase, Slack tokens flow through the pipeline
- **Safety guardrails** — any bypass of rate limits, confidence thresholds, or path exclusions (`safety` config)

## Safety Invariants

These must never be weakened without explicit user opt-in:

- Fixes are **never auto-merged** by default
- Migrations, secrets, and `.env` files are **always excluded**
- PRs are **only created after sandbox tests pass**
- Rate limiting caps PRs per hour

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest  | Yes       |
