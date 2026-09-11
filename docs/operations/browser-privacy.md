# Browser privacy and Spark compatibility

## Storage audit (2026-09-11)

| Location | Before | After |
| --- | --- | --- |
| `ZokiPage` / localStorage | Transcript, task proposal and action result; could contain names, grades, files and tasks | No reads or writes. React memory only; reload uses the authorized Firebase conversation |
| Zoki question limiter / localStorage | User ID, school ID and question timestamps in keys/values | Tab memory; reset at logout/school change. Google quota remains authoritative |
| Firebase Auth / IndexedDB or localStorage | SDK persisted login, including profile identifiers and tokens | SDK `setPersistence(inMemoryPersistence)` migrates/removes the current app's stored login before UI renders. Refresh requires signing in again |
| Firestore | Default memory cache; no persistent cache was enabled | Explicit `memoryLocalCache`; task/student/file/grade/conversation data is not written to an offline database |
| SPA redirect / sessionStorage | Full URL (potential record identifiers/query content) | URL fragment handoff followed by history replacement; old redirect key removed |
| Zoki task handoff / history state | Task request, proposal and context | Opaque random handle only; content held in a scoped in-memory map and discarded on consumption or session boundary |
| Theme / localStorage | Theme string | Preserved, restricted to the supported enum |
| Holiday filters / localStorage | Fixed calendar-category IDs | Preserved; no person or institution identifiers |

There are no application-owned IndexedDB databases, Analytics events, external
error-reporting integrations, or persistent offline file caches in `src`/`public`.
Firebase SDKs such as App Check, Installations and Remote Config may retain
technical attestation/installation/configuration metadata in their own databases;
these are not transcript, school-record, or Firebase Auth user-profile caches.
Authorization and App Check remain enabled. No student/grade/file storage rules
were changed by this privacy patch.

## Lifecycle and cleanup

Startup scans key names only in localStorage and sessionStorage and deletes all
`zoko-master:zoki-conversation:` and `zoki-question-window:` versions, across users
and schools. It never reads the stored conversation bodies. Cleanup repeats when
Zoki opens and is idempotent. Browser-denied storage access does not crash the app;
inaccessible keys can only be removed when the browser permits access again.

Each mounted Zoki instance is keyed by authenticated user, institution and private
session revision. Logout invalidates the session before waiting for presence or
sign-out requests. Switching schools unmounts the old conversation, settings and
drafts. Late loads and AI requests cannot update the new scope. Conversation sync
also verifies the expected account and session revision after asynchronous reads.
The existing Firebase synchronization retains only its bounded authorized text
transcript. Pending interactive actions remain temporary.

Firebase SDK console logging is disabled so SDK errors cannot echo document paths
or request details. Application errors use fixed messages; Zoki provider warnings
contain only a mapped error category. Raw provider messages and task-learning
record identifiers are not logged. AI requests themselves remain the existing
authorized functionality, not Analytics; this change does not change provider
data handling or server retention.

## Free deployment

Keep `VITE_TASK_WORKSPACE_ENABLED=false`. The column layout has a Spark adapter
for personal quick-add, private lists, favorites, personal ordering, existing task
editing and existing global completion. Preferences and list names live only in
the owner-only Firestore preferences document, never browser storage. Manager
assignment continues through the existing editor. New shared lists, invitations,
individual shared completion and atomic team/task creation remain paused.

The route checks server permission to the owner-only preferences document before
enabling the Spark board. With older rules it retains the existing board, rather
than showing actions that cannot save. The rules already committed on main contain
this private path. Publishing the complete ruleset to production was rejected by
automatic approval review during this change and has NOT been performed. It needs
explicit approval; there was no billing change, Functions deployment or migration.

## Verification

- `tests/unit/browserPrivacy.test.js`: key-only cleanup, denied storage, retained
  preferences, synchronous session invalidation, private task handoff, storage and
  diagnostic regression checks.
- `tests/unit/zokiConversationPrivacy.test.js`: actual conversation service with
  mocked Firebase reads/writes and throwing browser-storage spies; remote-only
  hydration, no-copy case, bounded save, stale-school load and account-switch save.
- `tests/security/task-workspace.rules.test.js`: Spark private list/task creation,
  retries, owner isolation against manager, and rejection of new shared operations.
- The actual board renders in the isolated UI fixture at `?free`; all sample data
  is in memory. This is not a test of an authenticated production account.
