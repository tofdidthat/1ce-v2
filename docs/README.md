# 1CE v2 — Documentation index

Use this page to find the right reference. Historical checklists and progress logs are intentionally retained; their old `draft`, `not merged` or `not deployed` statements describe the state **when written**, not necessarily the repository today.

## Repository snapshot

Verified on **2026-11-04 (UTC)** against `main` commit `9f0bd2c89e49a3d332e11e805799c07710a47ace`:

- [PR #27 — upload security](https://github.com/tofdidthat/1ce-v2/pull/27) was merged on 2026-11-03 (UTC).
- [PR #28 — Settings Trash](https://github.com/tofdidthat/1ce-v2/pull/28) was merged on 2026-11-04 (UTC).
- The [main-branch CI run 41757434555](https://github.com/tofdidthat/1ce-v2/actions/runs/41757434555) completed successfully for that commit.
- Migration 012, a verified private PostgreSQL backup, an isolated full restore and a disposable-bucket R2 deletion canary are documented in the [Trash release evidence](trash-v2-release.md).
- **Not established by this source audit:** which API/frontend revision is currently deployed, final independent security sign-off, or full application-level Trash → Restore → Empty Trash acceptance with disposable media. Verify these separately before asserting release readiness.

This is a dated **source-control and evidence snapshot**, not a live production dashboard. Refresh it when a release changes.

## Start here

| Document | Role |
| --- | --- |
| [Root README](../README.md) | Monorepo structure, local setup, validation commands and safety rules |
| [System overview](system-overview.md) | Short current code-level architecture, data boundaries and release protocol |
| [Architecture ledger](architecture.md) | Detailed cumulative decisions and implementation history; **not** a live status page |
| [v1-to-v2 reference guide](../1CE-GUIA-V1-ARQUITETURA-V2.md) | v1 lookup map and historical v2 planning; v1 stays read-only |

## Operations and release evidence

| Document | Scope |
| --- | --- |
| [Trash / R2 release evidence](trash-v2-release.md) | Migration 012, verified database backup/restore, R2 canary and outstanding application-level checks; contains pre-merge notes |
| [S2 upload-security log](release-s2-upload-security.md) | PR #27 design, migration 010/011 evidence, security checks and historical rollout gates |
| [S1 production checklist](release-s1-production-checklist.md) | Historical baseline and rollback procedures; revalidate before reuse |
| [Authentication deployment notes](auth-deployment.md) | Historical initial-login setup; may not match today's implemented OAuth or runtime configuration |
| [Settings identity rollout](settings-v2-rollout.md) | Historical identity/avatar rollout contract and ordering |

## Implementation references

| Document | Scope |
| --- | --- |
| [Refactor Phase A inventory](refactor-phase-a-inventory.md) | Dated API/media inventory, assumptions and risk register |
| [Reactive refresh](reactive-refresh-v2.md) | Frontend refresh behavior and tests |
| [Shared playback](shared-playback-v2.md) | Cross-account media permissions and playback integration notes |

## Documentation maintenance

1. Prefer updating this index and the short [system overview](system-overview.md) over growing the historical architecture ledger indefinitely.
2. Keep historical command outputs and decisions intact. Add a **dated clarification** rather than rewriting old evidence to appear current.
3. Identify **source implemented**, **merged**, **migration applied**, **deployed**, and **manually verified** as separate statuses.
4. Never place credentials, signed URLs, private user media or database dumps in Markdown or Git.
5. Documentation-only housekeeping must not rename migrations, move imported files, change CI/deployment configuration, or initiate a production deploy.
