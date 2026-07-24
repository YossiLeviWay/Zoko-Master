# Permission and resource access model

This release introduces a layered authorization model. A successful decision requires all applicable layers to allow the operation:

1. **Account and tenant boundary** — the actor must be active and a member of the requested school.
2. **System role** — protected roles such as `institution_manager` are assigned only by trusted server code.
3. **Capability** — fixed capability keys describe the operation, for example `students.bulkImport`, `files.share`, or `roles.delegateAssignments`.
4. **Scope** — a grant may be limited to the school, the actor, classes, grades, tracks, teams, or named resources.
5. **Resource ACL** — files, folders, and tasks may grant or deny access to a user, team, role, or class. An explicit deny wins over an ordinary grant. A child may inherit its parent folder policy.

The canonical server evaluator is `functions/src/services/permissionEngine.js`. Sensitive callables build their decision context from Firestore and never trust a client-provided role, school membership, or permission list. Decisions include a structured reason and source for audit and preview screens.

## Server-managed records

The browser cannot write the following authorization records directly:

- `schools/{schoolId}/roleDefinitions`
- `schools/{schoolId}/roleAssignments`
- `schools/{schoolId}/permissionDelegations`
- `schools/{schoolId}/resourceAcls`
- `schools/{schoolId}/resourceAclPolicies`
- `schools/{schoolId}/permissionPreviewSessions`
- `auditLogs`

Resource ACL callables materialize a non-sensitive policy document for Firestore and Storage Rules. This keeps browser enforcement consistent with the server decision while preserving deny-by-default behavior.

## Permission preview

Preview sessions are read-only, expire after 15 minutes, and never sign in as the target user or issue a target-user token. The server evaluates a capability from the target user's stored assignments and returns only the decision summary. Starting and using a preview is audited.

## Bulk student import

The import endpoint derives the school from the authenticated actor, validates a maximum of 200 rows, requires `students.bulkImport`, rate-limits requests, and uses `requestId` for idempotency. Student identity numbers are stored only at:

`schools/{schoolId}/students/{studentId}/sensitive/identity`

That document is server-managed and requires `students.viewSensitiveFields` to read. Reports and audit records contain row identifiers and aggregate counts, never identity values.

## Legacy role migration

The compatibility migration is dry-run by default and never deletes records:

```bash
npm --prefix functions run migrate:legacy-roles -- --project=<staging-project-id>
```

Execution requires both guards and must first be approved and tested against staging:

```bash
npm --prefix functions run migrate:legacy-roles -- \
  --project=<staging-project-id> \
  --execute \
  --confirm-project=<staging-project-id>
```

`GOOGLE_APPLICATION_CREDENTIALS` must reference a credential outside the repository. Do not run this command against production without an explicit approval, a verified backup, and a reviewed dry-run count.

## Release boundary

Code in this branch does not activate the new Functions or Rules in Firebase. Follow the staging-first order in `docs/security/operations.md`; do not deploy the client before the matching Functions and Rules are available.
