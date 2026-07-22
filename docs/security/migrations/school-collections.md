# School collection migration runbook

The migration script is present but was not run during hardening. It uses Firebase Admin only, never deletes legacy data, preserves document IDs, copies task-chat subcollections, and skips an existing target document rather than overwriting it.

## Safety controls

- Dry-run is the default; writing requires `--execute`.
- Execution also requires the exact matching `--approved-project`, `--backup-complete`, and an approval reference.
- The script stops before migration if it finds a dynamic legacy collection whose school suffix does not match a current `schools/{schoolId}` document.
- Reports contain collection-level counts and error codes only. Document content and document IDs are never printed or written to the report.
- Existing target documents are compared in memory. Conflicts are counted and skipped, never overwritten.
- Legacy collections are never deleted or modified.

## Approved dry run

Do not run this command against staging or production without explicit approval, because even dry-run reads live data.

```bash
cd functions
GOOGLE_APPLICATION_CREDENTIALS=/secure/outside/repo/credential.json \
  node scripts/migrate-school-collections.js \
  --project APPROVED_STAGING_PROJECT \
  --report migration-reports/staging-dry-run.json
```

Review source counts, existing target counts, would-copy counts, conflicts, ambiguous collections, and task-chat counts.

## Approved execution

Only after a verified backup and an explicit approval:

```bash
cd functions
GOOGLE_APPLICATION_CREDENTIALS=/secure/outside/repo/credential.json \
  node scripts/migrate-school-collections.js \
  --project APPROVED_PROJECT \
  --approved-project APPROVED_PROJECT \
  --approval-reference CHANGE_TICKET_OR_APPROVAL_ID \
  --backup-complete \
  --execute \
  --report migration-reports/approved-execution.json
```

After copying, keep legacy collections readable during verification. Move them to read-only Rules only after record-count comparison, permission testing for every role, and explicit approval. Deletion is a separate future decision and is not implemented by this script.
