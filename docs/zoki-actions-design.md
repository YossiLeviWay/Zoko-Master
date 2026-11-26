# Zoki actions: design and phased plan

Phase 0 only. This document does not change Firestore rules, Cloud Functions, or the Worker, and nothing here is deployed.

The goal is that a person can ask Zoki to do anything they can already do by hand, and nothing they cannot. Every write is shown first and runs only after they click. The write uses that person's own Firebase login, so `firestore.rules` is the same gate as the screen.

## Recommendation

Execute confirmed actions in the browser, by calling the same repository functions the screens already call (`createOrganizationTask`, `saveAttendanceCell`, `createClass`, `createSchoolTeam`, and the rest). The user's ID token is what Firestore sees. Rules reject a write the screen would reject. There is no new service-account path and no new privileged callable.

The Worker may propose a tool call. It must not perform the write. A proposal is not permission.

Some actions already go through `functions/src/callables/zokiActions.js`. Those handlers use the Admin SDK, re-check `permissionEngine`, rate-limit, and write an audit row. That is a second, privileged path. It already exists in the repo. This plan does not add to it. New actions stay on the client. Moving the existing callables onto the client, or adding a forge-proof audit log, is a separate change Yossi has to approve before any functions or rules deploy.

Why not let the Worker write with the service account:

- The service account bypasses `firestore.rules`. A missed check is a write the screen could not do.
- The rules already encode the hard parts: who may create a class, which task fields may change, which attendance cell may be written, and that role assignments cannot be written from the browser at all.
- Duplicating that logic in the Worker will drift the first time a screen check changes.

The client path has one gap the rules do not close: a durable audit row the user cannot edit. `auditLogs` are server-managed today (`docs/security/permissions-model.md`). Section "Changes that need approval" lists the smallest way to add that later. v1 does not block on it. The confirmation card and the document itself (`createdBy` / `updatedBy` / `requestId`) are the record until then.

## What the chat already does

`ZokiPage` already renders a confirmation card and runs the write only on click. The click calls a callable, not the screen's repository:

| Card | Callable | Writes with the Admin SDK |
| --- | --- | --- |
| Task status, assignees, details | `executeZokiTaskStatus`, `executeZokiTaskAssignment`, `executeZokiTaskDetails` | `schools/{schoolId}/tasks`, `tasks_{schoolId}`, or `users/{uid}/personalTasks` |
| Attendance cell | `executeZokiAttendance` | attendance records under the sheet file |
| Calendar create / update / cancel | `executeZokiCalendarEvent*` | `events_{schoolId}` |
| Team create, membership, manager | `executeZokiTeamCreate`, `executeZokiTeamMembership`, `executeZokiTeamManager` | `schools/{schoolId}/teams` and `teams_{schoolId}` |
| Contact, grade, student note, track, transfer | matching `executeZoki*` | student, gradebook, contacts |
| Resource create / rename / move / access, role assignment, direct permission | matching `executeZoki*` | files, folders, and server-only role records |

`functions/src/roleAgents.js` maps the model tool `create_task` to capability `tasks.create`. The Worker (`worker/src/claude.js`) may only propose tools. The browser is what executes them.

v1 should keep that card, and point the click at the repository function the screen uses. Where a callable already does the same write, the card keeps working. New kinds of write do not get a new callable.

## How a write is allowed

A manual action is allowed only when all of these agree:

1. The account is active and belongs to the school (`actorFor` / `isSchoolMember` in rules).
2. The UI checks a capability from `functions/src/permissionCatalog.js`, often through the legacy alias in `PERMISSION_COMPATIBILITY_ALIASES` and `src/hooks/usePermissions.js`. Principals and institution managers are treated as allowed in the screens (`isAdmin`).
3. `functions/src/schoolRoleCatalog.js` is a template of those capabilities for a job (רכז שכבה, מחנך, and so on). It does not grant anything by itself. `MANAGER_ONLY` (appointing roles, institution settings, audit, permission preview) is never on a catalog role.
4. `firestore.rules` checks the same capability, or a legacy key such as `tasks_edit` or `teams_edit`, and also checks field shape (`validClassCreate`, `safeOrganizationTaskUpdate`, `validAttendanceRecordWrite`).

Default storage mode is legacy (`VITE_FIRESTORE_DATA_MODE`, `src/services/firestore/paths.js`). A logical "classes" write is `classes_{schoolId}` unless the mode is nested, in which case it is `schools/{schoolId}/classes`. The same split exists for tasks, teams, students, files, events, and holidays. Rules cover both: nested matches under `schools/{schoolId}/…`, and top-level `match /{legacyCollection}/{documentId}` for `tasks_…`, `teams_…`, `classes_…`, and the rest.

Zoki must call the repository, which already picks the path. It must not invent a collection name.

## Inventory

"Screen gate" is the check in the component. "Catalog" is the capability a role template may include. "Rules" are the match that actually allows the client write. Deletes and bulk replaces are listed so v1 can exclude them.

### Tasks (v1)

| Action | Screen | Repository | Path and fields | Screen gate | Catalog | Rules |
| --- | --- | --- | --- | --- | --- | --- |
| Create personal task | Tasks (`TaskBoard` / workspace) | `createPersonalTask` | `users/{uid}/personalTasks/{id}`: `title`, `description`, `dueDate`, `priority`, `scope: personal`, `ownerId`, `schoolId`, `createdBy` | `tasks.create` (basic grant for every signed-in member in `accessCatalog.js`) | `tasks.create` | `users/{uid}/personalTasks` create by that uid |
| Create school task | Tasks | `createOrganizationTask` | `tasks_{schoolId}` or `schools/{schoolId}/tasks`: `title`, `scope` (`team` / `assigned` / `institution`), `assigneeIds` (one), `teamId`, `participantIds` (max 50), `createdBy` | `tasks.create`; assigning others also needs `tasks.assign` | `tasks.create`, `tasks.assign` | `validOrganizationTaskCreate` |
| Edit title, description, due date, priority | Tasks | `updateTask` | same task doc, editable fields only; assignment-version 2 goes through `workspaceAction` | owner, or `tasks.editAll` | `tasks.editAll` | `safeOrganizationTaskUpdate` or ACL `edit` |
| Change status | Tasks | `updateTaskStatus` | `status`, `completedAt`, `updatedBy` | assignee or `tasks.editAll` | `tasks.editAll` | same update rule, affected keys limited |
| Add or remove one assignee | Tasks | `updateTaskAssignee` | `assigneeIds` | `tasks.assign` | `tasks.assign` | same update rule |
| Chat on a task | Task card | `sendTaskChatMessage` | `…/tasks/{id}/chat/{messageId}`: `authorId`, text | anyone who can see the task | `tasks.viewOwn` / `tasks.viewTeam` | create if `authorId` is the caller |
| Delete task | Tasks | `deleteTask` | deletes the doc | `tasks.deleteAll` or owner, with extra checks for mandatory tasks | `tasks.deleteAll` | delete rule | **not in v1** |
| Pin, follow-up, link to an initiative | Tasks | `toggleTaskPin`, `createPersonalFollowUp`, `linkTaskToInitiative` | narrow field updates | owner / participant | varies | update rule | later |

### Attendance (v1, one cell at a time)

Sheets are files. The UI is `AttendanceSheetEditor` / `FileManager`. The repository is `src/services/firestore/attendanceRepository.js`.

| Action | Path | Fields | Screen gate | Catalog | Rules |
| --- | --- | --- | --- | --- | --- |
| Mark one student on one date | `schools/{schoolId}/files/{fileId}/attendanceRecords/{studentId}__{dateKey}` (legacy twin under `files_{schoolId}`) | `primaryStatusId`, `actionIds`, `note` (max 2000), `studentId`, `dateKey`, `classId`, `updatedBy` | `attendance_edit` on that class | `attendance_edit` (רכז שכבה, מחנך) | `validAttendanceRecordWrite`; the member and the day must already exist |
| History row for that mark | `…/attendanceHistory/{id}` | `createdBy` | same | same | create only, no update |
| Create a sheet | `schools/{schoolId}/files/{fileId}` plus members and days | sheet metadata, one member per student | `attendance_create` | `attendance_create` | file create plus `canInitializeAttendance` | later than the single-cell edit |
| Legend item, block a day, archive a sheet, delete a legend item | legend / days / file | various | `attendance_manage_legend`, `attendance_manage_dates`, `attendance_block_days` | those keys | matching child rules | **not in v1** (legend delete is a delete) |

`markAttendanceDate` writes every student on a date. That is a bulk write. It stays out of v1.

### Classes and teams (v1)

| Action | Screen | Repository | Path and fields | Screen gate | Catalog | Rules |
| --- | --- | --- | --- | --- | --- | --- |
| Create class | `ClassManagement` inside Students | `createClass` | `classes_{schoolId}/{id}` or `schools/{schoolId}/classes/{id}`: `name`, `normalizedName`, `academicYear`, `academicYearId`, `grade`, `teacherId`, `staffIds`, `createdBy`. Id is derived from name + year. Duplicate throws `CLASS_EXISTS` | `classes_create` / `classes.create` | `classes.create` | `validClassCreate`; client delete is `false` |
| Update class name, year, grade, teacher | `ClassManagement` | `updateClass` | same doc; a teacher change also appends `classes/…/history` (`type: teacher_changed`) | `classes_update`, and `classes_assign_teacher` for the teacher | `classes.update`, `classes.assignTeacher` | `safeClassUpdate`; history create if `classes_update` or `classes_assign_teacher` |
| Archive class | `ClassManagement` | status update | `status` | `classes_archive` | `classes.archive` | update rule | **not in v1** |
| Create team (קבוצה / צוות) | `Teams` | `createSchoolTeam` | `teams_{schoolId}` or `schools/{schoolId}/teams`: `name` (2–120), `description` (max 500), `memberIds` (max 50), `managerIds: [caller]`, `createdById` | `teams_edit` | not a `schoolRoleCatalog` capability; legacy key `teams_edit` only. Principals pass the screen check | `hasPermission(schoolId, 'teams_edit')` or `legacyTeamWriteAllowed` |
| Add members | `Teams` | `addSchoolTeamMembers` | `memberIds` array-union only | `teams_edit` or a manager of that team | same | update rule | v1 may add members, not replace the whole array |
| Delete team | `Teams` | `deleteDoc` | — | `teams_edit` | — | delete allowed by the same key | **not in v1** |

There is no `teams.create` in `permissionCatalog.js`. The screen and the rules both use `teams_edit`. v1 must use that same key, not invent `teams.create`.

### Already proposed by Zoki, kept as they are until a client migration is approved

Calendar (`GanttChart`, `events_{schoolId}`, `calendar.create` / `calendar.edit`, rules `calendarActionAllowed`), contacts, one grade cell, one student note, track, class transfer, file rename/move/share, team manager. These already have cards and callables. v1 does not reimplement them. It does not add deletes (`executeZokiCalendarEventCancel` stays as it is and is not a pattern for new deletes).

### Files (v2)

| Action | Screen | Path | Gate | Rules |
| --- | --- | --- | --- | --- |
| Upload / create file | `FileManager` | Storage object plus `files_{schoolId}` or `schools/{schoolId}/files` | `files.create` / `files_upload` | file create; attendance and gradebook files are special and must not be created by a generic upload |
| Create folder | `FileManager` | `folders_{schoolId}` or `schools/{schoolId}/folders` | `files.create` | `validClassFolderCreate` or `files_upload` |
| Rename, move, share | `FileManager` | file or folder fields, `resourceAcls` | `files.edit`, `files.share`, `files.managePermissions` | update rules; ACL documents are `allow write: if false` and only a callable may change them |
| Trash / delete | `FileManager` | trash fields or delete | `files.delete` | delete rule, with attendance and gradebook files excluded | **not in v2's first slice** |

Upload is two writes (Storage and Firestore) and an ACL. That is why it is v2.

### Everything else (after v2)

| Area | Screen | Path | Gate | Client write? |
| --- | --- | --- | --- | --- |
| Students create / edit | Students | `students_{schoolId}`, `schools/{schoolId}/students` | `students.create`, `students.edit` | yes, `validStudentCreate` / `safeStudentUpdate` |
| Student lifecycle (transfer, graduate, withdraw, restore) | Students | student plus `studentEnrollments` and history | `students.transferClass`, `students.markGraduate`, `students.markWithdrawn`, `students.restore` | yes, but several are bulk or status changes; not v1 |
| Bulk import | Students | callable only | `students.bulkImport` | **no.** Rules deny `studentImportJobs` writes. Max 200 rows, idempotent `requestId`. Stays a callable |
| Notes | Student profile | `students/…/notes` | `students.addNotes`; sensitive notes need `students.viewSensitiveNotes` | yes |
| Grades | gradebook UI | `gradebooks/…/grades/{studentId}` | `grades.edit` | yes, one cell |
| Gradebook structure | gradebook UI | `gradebooks` | `gradebooks.manage` | yes | later |
| Staff invite, edit, remove | Staff | users and `schools/…/invitations`, `memberships` | `staff.invite`, `staff.edit`, `staff.remove` | invitations and memberships are partly server-only |
| Role assign | `RolesManager` | `roleAssignments`, `roleDefinitions` | `roles.assign`, and only the institution manager | **no.** Rules are `write: if false`. Callable only |
| Direct permission grant | Staff | user permission map | `permissions.delegate` | callable only (`MANAGER_ONLY`) |
| Initiatives and milestones | Initiatives | `schools/{schoolId}/initiatives/…` | `initiatives.create`, `initiatives.edit`, `initiatives.createMilestones` | yes | later |
| Contacts | Contacts | `contactDirectory/…/items` | `contacts.create`, `contacts.edit` | yes | later. `contacts.merge` is a bulk write |
| Email drafts | Messages / communication | `communicationDrafts`, `communicationEvents` | `communications.create` | yes, draft only; sending mail is a callable | later |
| Holidays, calendar categories | Holidays, Gantt category manager | `holidays_{schoolId}`, `categories_{schoolId}` | `holidays_edit`, `categories_edit` | yes | later |
| Messages between staff | Messages | message threads | `messages_send` | yes | later. `messages_delete` is a delete |
| Forum | Forum | forum collections | `forum.createThread`, `forum.reply`, … | mixed; several moderations are callables | later |
| Support ticket | Support | support tickets | `support.create` | callable | later |
| Academic year | Settings | `academicYears` | `academicYears.manage` | yes | later, easy to damage enrollments |
| Institution settings | Settings | `schools/{schoolId}`, `settings_{schoolId}` | `institution.settings` | manager only | not a Zoki action |
| Collective brain | Collective brain | `collectiveBrainBoards` | `collectiveBrain.manage` | yes | later |
| Outcomes, CV, personal file | student tabs | nested under the student | `outcomes.*`, `cv.*`, `personalFile.*` | many writes are `allow write: if false` and go through callables | later, and only the ones rules already allow from the client |

## Architecture

```
user message
  -> Worker proposes one tool call (name + fields). It does not write.
  -> browser checks the capability the screen checks. If it fails, the card says so and has no confirm button.
  -> card shows the collection, the id if it is an update, and every field that will change
  -> user clicks
  -> repository function used by that screen (client SDK, user token)
  -> rules accept or deny
  -> card shows saved, or the rules error, in the same words the screen uses
```

The model never receives a tool result that means "I already wrote it". The tool result on the Worker side is only "proposal". Execution is the click.

Prompt injection: text from a file, a task, a student note, or the school brain is context for the answer. It is not a user message. The Worker system prompt already says not to send messages and not to invent a procedure. The code gate is stronger: a tool call is built only from the latest user message's intent, and document excerpts are not scanned for tool calls. A phrase inside a file cannot confirm a card. Only the click can.

One proposal per turn in v1. No chain ("create the class and then the attendance sheet and then mark everyone present").

## Safety

- Schema: each action has a fixed field list and the same limits the repository already enforces (`title` length, `memberIds` max 50, attendance `note` max 2000, class name required). Unknown fields are dropped before the write. The card displays the payload that will actually be sent.
- Updates are narrow. v1 may set status, one assignee, one attendance cell, class name/grade/teacher, or team membership by array-union. It may not replace a whole document, change `createdBy`, or touch a different school.
- No deletes, no archive, no bulk ("mark the whole class", "import these students", "merge contacts") in v1.
- Duplicates: `createClass` already fails with `CLASS_EXISTS`. Personal tasks already accept a `requestId` and recover if the same id exists. Every Zoki create gets a `requestId` derived from the card id, so a double click writes once.
- Rate: the chat already limits questions (`reserveZokiQuestion`, default 4 a minute, from `schools/{schoolId}/settings/zoki_agent`). v1 adds a separate in-memory cap of 10 confirmed writes per 10 minutes per user and school, cleared on logout with the other session maps. A cap that survives refresh needs a server counter; that is listed below and is not required for v1.
- Undo, where it is cheap: the card keeps the previous value of each updated field. "בטל" sends one more narrow update back to that value. It is not offered for creates in v1 (that would be a delete). It is not offered if the document changed after the write (`updatedAt` mismatch), same idea as the task card's "the task changed" check.
- Audit until a rules change exists: the card text stays in the chat transcript (`zokiAgents/{uid}/conversations/{schoolId}`), and the written document already stores `createdBy` / `updatedBy`. That is not forge-proof. A real audit row is in the approval list.
- Harm to existing data: the repository functions reject a missing id, a cross-school id, and an empty title. Rules reject a shape the function forgot. The card is the third check, because the user sees the name of the class or the student before anything is written.

## Phases

Sizes are which code moves, not a schedule.

### v1 — tasks, one attendance cell, classes, teams

- Add tool names for: create personal task, create school task, update task fields, set status, set assignee, save one attendance cell, create class, update class (name, grade, teacher), create team, add team members.
- Map each tool to the capability above. Hide confirm when the capability is missing.
- On confirm, call the existing repository function. Do not add a callable.
- Tests: one unit test per tool that a valid payload reaches the repository arguments and an extra field is stripped; one test that a missing capability yields a card with no confirm; one test that `CLASS_EXISTS` and a rules-denied error are shown and not described as saved. The repositories already have their own tests. No emulator test is required for the design to be implemented, because the write is the one the screen already runs.
- Roughly: the tool table in `roleAgents.js` / `worker/src/claude.js`, the card branch in `ZokiPage.jsx`, and a small adapter next to `zokiWorkerProvider.js`. No rules file.

### v2 — files

- Create folder, upload one file, rename, move inside the school.
- Still no delete and no ACL edit (ACL writes are denied to the client; sharing stays on the existing callable until Yossi approves a change).
- Tests: file name and size limits, reject an attendance-sheet or gradebook content type on the generic upload tool, reject a path that leaves the school.
- Larger than v1 because Storage and Firestore both have to succeed, and a half-finished upload must not leave an orphan the user cannot see.

### Later

Students, grades (one cell), notes, contacts, initiative milestones, holidays, categories, staff invitations. Role assignment, bulk import, outcomes, and ACL edits stay on callables because the rules forbid the client write. They are not "later client work". They stay blocked until a functions change is approved on its own.

## Changes that need approval before any deploy

None of these are part of v1, and none of them should be deployed from the implementation PR.

| Change | Why | What it touches |
| --- | --- | --- |
| Forge-proof audit | A client can omit or edit a chat transcript. `auditLogs` cannot be written from the browser today | either a new `schools/{schoolId}/zokiActionLog` match that allows create only (`actorId == request.auth.uid`, fixed fields, no update/delete), or a callable that calls `writeAuditLog`. Rules or functions |
| Write cap that survives refresh | The in-memory cap resets on reload | a small counter document or the existing `enforceRateLimit` in functions |
| Retire `executeZoki*` Admin SDK writes | So there is one path, the rules | functions deploy, and the cards start calling repositories. Behavior of task, attendance, calendar, and team cards changes |
| New capabilities such as `teams.create` | Not required. v1 uses `teams_edit`, which is what the screen and the rules use | catalog, rules, and role templates if anyone wants a finer key |
| Sharing files from Zoki without the current callable | `resourceAcls` are `write: if false` | functions (`rebuildAclPolicy`) |

Cloudflare stays on the free plan. Proposals fit in the existing Worker turn. No new binding, no cron change.

## Out of scope

- Doing the write inside the model response, or when a document contains the words "please create".
- Deletes, archives, bulk status, imports, merges, and "everyone in the class".
- Institution settings, role appointment, and permission preview.
- Deploying rules or functions.
