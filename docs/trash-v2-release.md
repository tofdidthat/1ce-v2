# 1CE v2 PR #28 — Trash / R2 permanent deletion release gates

Branch: `feature/v2-trash-r2-safe-purge`. No main merge or deploy until separately authorized.

1. Back up and verify v2 production PostgreSQL; preserve v1.
2. Verify migration 012 in disposable PostgreSQL, including idempotence, reference-protected DELETE and transactional outbox creation. No destructive migration in production.
3. Apply 012 **to v2 production only** in a separately approved maintenance step, before deploying branch code.
4. Verify API test suite and web build on last branch HEAD; perform independent DB/R2 safety review.
5. With explicit release approval, deploy API and frontend together, test owner's Settings → Trash above Terms; Delete → move to Trash → restore; Trash → Empty Trash with text confirmation and R2 deletion.
6. Test: beat still referenced by a live pack, two beats sharing cover, detached beat, staged/pending upload, public/saved project, session ownership, simultaneous writes, R2 DeleteObject 5xx and retry, storage quota, and music player.
7. Check pending jobs and failure rate. If jobs are pending, report partial completion and retry; do not claim R2 deletion occurred.
8. Rollback code if functional regression. A prior hard purge of R2 objects is irreversible even after rolling back code or DB schema. Never run destructive R2 cleanup against v1 or unverified keys.

**Intentional limitation:** Recovery is offered only for 30 days; the app does not schedule expiry-driven purge automatically. Empty Trash deletes selected trashed projects only when the owner explicitly confirms. R2 jobs left from a transient failure are idempotent and retriable by Empty Trash. Unattached READY files outside purged project references are retained, not swept globally; separate audit handles historical orphans.

**Protective invariant:** A verified R2 key must not be deleted while its `library_files` record is still referenced by any beat or pack. FK-restricted metadata retirement and durable outbox must succeed in one transaction before R2 DELETE is attempted.

## Continuation after interrupted Work — 2026-11-03

- Verified PR #28 remains a draft; the previous HEAD `b38670a` passed GitHub workflow `V2 API and frontend checks` (run 41713089166). This does not replace final-HEAD CI or external integration testing.
- Added `history/database/012_trash_and_r2_delete_outbox_safe_psql.sql`, a guarded **psql** script recovered from the 1CE migration work. It verifies S2 schema markers, uses a transaction with a 5-second lock timeout, validates columns/indexes/outbox, and reports six verification booleans. **The script has not been executed against production.** The `\\set` and `\\echo` directives mean run it using **psql**, not a generic SQL-only dashboard.
- Railway inspection identified v2 project `courteous-spontaneity`, production Postgres and `1ce-v2` API service sourced from `tofdidthat/1ce-v2:main`; the legacy `content-empathy` project with `1ce-server` must remain untouched. No public PostgreSQL TCP proxy was found for v2. Do not expose a database merely to run this migration.
- **PENDING:** verify a recoverable backup, arrange an authorized secure DB execution path, apply the guarded 012 against **v2 only**, record six true results, confirm rollback/retry plan, then rerun final-HEAD CI and isolated DB/R2 integration safety tests. PR remains draft; do not merge or deploy without a fresh go/no-go decision.
- **Concurrency audit to complete:** publishing, saving, sharing and beat/pack creation are separate transactions and do not consistently take the per-account Trash advisory lock. Verify races against moving projects to Trash; guard against stale relations after deletion. Also test UI behavior when a beat is hidden in a trashed pack, and when shared covers remain live. Do not treat static tests alone as proof of these invariants.
