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
