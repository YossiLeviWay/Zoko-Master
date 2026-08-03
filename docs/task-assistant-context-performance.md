# Task assistant context and performance

## Baseline found before the change

The task page loaded the two compatible staff queries serially. Their network
wait was therefore approximately `schoolIds query + legacy schoolId query`.
Team, class and holiday listeners were started without waiting for staff, but
there was no shared context cache and no stage-level timing. Roles and calendar
events were not part of the assistant context.

The assistant sent the user request to Gemini before resolving simple school
entities locally. A slow or unavailable model blocked the proposal form, and
the configured client timeout defaulted to 12 seconds.

## Current pipeline

1. The UI immediately reports that teams, roles and the calendar are being
   checked.
2. The two staff queries run together with `Promise.all`. Firestore listeners
   for teams, roles, classes, events and holidays are also started independently.
3. `schoolContextResolver` builds an in-memory, two-minute context cache keyed
   by `schoolId`, a content version and a user-permission version.
4. The local resolver identifies the domain, grade, matching teams, authorized
   team members, role holders, homeroom teachers, blocked dates and related work.
5. Gemini receives only a bounded allowlist of institutional labels and dates.
   It does not receive Firestore documents, record IDs or the locally resolved
   staff list.
6. The model returns short structured output. Its output is merged with the
   deterministic local result.
7. After eight seconds, or on any Gemini availability error, the editable local
   proposal is shown instead. Model failure does not block task creation.

## Authorization and privacy

Firestore Security Rules remain the server-side authorization boundary for all
source reads. The resolver performs an additional capability filter before data
enters the context cache. The cache is memory-only and is neither persisted to
local storage nor shared between schools or permission versions.

The Gemini context allowlist contains only domain, grade, team/role/class
labels, blocked dates, related initiative labels and approved institutional
rules. Identity numbers, medical data, grades, student-file data, student
notes, private addresses, phone numbers and unrelated file contents are not
accepted by the prompt builder.

## Measurements

`taskAssistantPerformance` stores numeric durations only in process memory. It
never stores request text, staff names, student data or Firestore payloads. The
following stages are measured independently:

- `staffLoad`
- `teamsLoad`
- `rolesLoad`
- `classesLoad`
- `calendarLoad`
- `promptBuild`
- `geminiCall`
- `responseProcessing`
- `nameMatching`
- `proposalDisplay`

The snapshot API returns sample count, latest duration and average duration.
This keeps diagnostics available to tests and an authorized developer without
printing sensitive data to the browser console. The structural improvement is
also covered by a concurrency test: independent context loaders must start
before any of them is released, changing the expected wait from the sum of
independent reads to their maximum.
