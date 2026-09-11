# Task workspace rollout

The `/tasks` route uses the full shared workspace only when `VITE_TASK_WORKSPACE_ENABLED=true`. With the flag false it uses a Spark-compatible column board after verifying server access to the owner-only preferences document; older rules fall back to the existing board. The Spark adapter uses Firestore directly for private lists, personal tasks, favorites/order and existing global task completion. Shared-list creation and the new per-person completion service remain paused. `/tasks/advanced` preserves existing initiative links and the role-resolution task writer. Task discussions route to `/messages?task=ID&storage=nested|legacy`; the old chat documents are retained. See [browser privacy and free rollout](operations/browser-privacy.md).

## Release order

1. Run unit, functions, security/integration, typecheck and build checks.
2. Deploy the `taskWorkspace` callable, team membership reconciliation triggers and updated Zoki functions together with Firestore rules. No production deployment is performed by the implementation itself.
3. Run `node functions/scripts/migrate-task-workspace.js --school=ID` using the intended project's credentials. This is read-only and prints a report without task content. Resolve conflicts before applying.
4. Back up the target school, then run the same command with `--apply`. Existing completion is marked inherited; no individual is falsely credited with having clicked Complete.
5. After backend deployment succeeds, set the GitHub Actions repository variable `VITE_TASK_WORKSPACE_ENABLED=true` and rebuild the Pages application. The per-school setting `schools/{school}/settings/task_workspace.layout` can be set to `legacy` for staged rollout and changed to `columns` to enable the board. Absent settings use columns. Deploy the web build, then validate with one administrator, two teammates and a worker without a team. Check a real notification and an old task conversation link.

Do not restore direct organization-task status writes as a rollback: completion is per participant. Old interfaces call the new service for organization status updates. Keep the server and rules compatible with v2 data.

## Data contracts

- `schools/{school}/taskLists/{id}`: owner, kind, members, name, archive flag. Client writes are denied; invitation acceptance controls membership.
- `users/{uid}/taskBoardPreferences/{school}`: personal pins, task/lane ranks, placements and last lane. These are owner-only, including against school managers.
- Organization tasks retain their original document identity. `assignmentVersion: 2`, `assignmentSources`, `assignmentExclusions` and `progressBy` distinguish membership from personal progress. `status` is aggregated, never a proxy for one participant's click.
- Personal-to-shared conversion leaves a private redirect and one shared task. Private redirects are hidden by the board and old task links resolve to the shared task.
- Workspace receipts and deterministic notifications make retries idempotent. Receipt payload hashes prevent reuse with a different operation payload.

## Verification

`tests/unit/taskWorkspace.test.js` covers individual completion, inherited completion, direct versus team membership, list placement and rank insertion. Security tests cover private lists/preferences, blocked direct task mutations, invitation acceptance, stale previews and atomic team/task creation.

For isolated UI verification run `node tests/ui/task-workspace/server.mjs` and open the printed localhost address. It renders the actual board component with in-memory sample data; it never connects to Firebase. The fixture is not part of the production route or build entry. Desktop quick-add, details and a 390px viewport were checked using this fixture.

## Operational boundaries

The migration is supplied but has not been run on production. The authenticated production flow, notification delivery and pilot require the release steps above. Existing data continues to load through the compatibility repository. Completed rows are revealed progressively. Organization history pagination is supported behind the per-school `pagingReady: true` setting, enabled only after migration has normalized statuses and timestamps. Deploy the supplied nested-task indexes; legacy collection names require equivalent per-school indexes before enabling this setting. List-wide transactions are bounded by Firestore transaction limits and should be load-tested against the target school's largest list before rollout.

## Production deployment check — 2026-09-11

The production Firebase project is `eduflow-pro-12a90`. The Functions inventory is empty. An attempted deployment of the six workspace/Zoki functions was blocked because the project is on Spark and Cloud Build requires Blaze. No billing upgrade was performed. Keep the build flag disabled until the account owner upgrades the project and the functions are successfully deployed. The source, rules, tests and local sample preview can be released independently. Legacy organization tasks continue to use the existing status-write path while v2 tasks use the per-participant callable.
