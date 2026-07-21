# Phase 1 security inventory

Date: 2026-07-21

This document records the application as it existed before the security-hardening changes. It intentionally contains no credentials, Firebase configuration values, access tokens, or personal data.

## Baseline

- Branch: `security-hardening`, created from `main` before any code changes.
- Client: React/Vite using Firebase Authentication, Firestore, and Storage directly from the browser.
- Backend: no Cloud Functions directory or Firebase Admin SDK was present.
- Firebase configuration: no `firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json`, or `storage.rules` was present in the working tree or visible repository history.
- Tests: no Emulator Suite or Firebase Rules tests were present.
- CI: the only workflow built and deployed GitHub Pages from `main`/`master`; it did not run lint, rules tests, emulator tests, or secret scanning.

## Known credential and privilege findings

- `src/contexts/AuthContext.jsx` contained a fixed shared administrator password and `loginAsAdmin`.
- The administrator flow could sign in or create an Authentication account and then create a `global_admin` Firestore document from the browser.
- `buildFallbackUserData` elevated one hard-coded email address to `global_admin`.
- A missing user document was created by the client from fallback data.
- `_authPassword` and `_pendingPassword` were read and written in Firestore.
- `src/components/Staff/StaffManagement.jsx` used a secondary Firebase Auth instance to sign in as other users, change their email/password, and delete their Authentication account.
- `README.md` published the shared administrator password.
- No additional tracked fixed credential, private key, service-account file, or token was found by the baseline tracked-file scan. The ignored local environment file was checked only for variable names and was not printed or added to Git.
- The exposed administrator password must be considered compromised even after removal from the current tree; Git history rewriting is deliberately outside this phase.

## Firestore collection inventory

### Global collections

| Path | Purpose | Current client access |
| --- | --- | --- |
| `users/{uid}` | Profiles, system role, school membership, permissions, teams, presence, dashboard preferences | Broad reads and direct profile, role, membership, permission, team, presence, and password-field writes |
| `schools/{schoolId}` | School directory and principal assignment | Public registration reads all schools; administrators create/update/delete and assign principals directly |
| `conversations/{conversationId}` | Conversation metadata and participants | Participants are filtered in UI; creation, pinning, unread state, participant metadata, and deletion occur directly |
| `conversations/{conversationId}/messages/{messageId}` | Chat messages and image links | Direct participant UI reads/writes/deletes; authorization is not enforced in repository Rules |
| `announcements/{announcementId}` | Cross-school or school-targeted announcements | All announcements are queried and then filtered in the UI; creation occurs directly |
| `notifications/{notificationId}` | User notifications | Any feature can create recipient notifications from the client; recipients read/update/delete directly |
| `resource_permissions/{type_id}` | Per-resource viewer/editor user/team lists | Principals/global administrators manage directly; resources are often fetched before UI filtering |
| `holidays_global/{holidayId}` | Legacy/global holiday fallback | Referenced when a global administrator has no selected school |

### Legacy school-scoped collections

The school identifier is embedded in each top-level collection name. This prevents reusable Rules and makes collection discovery and migration error-prone.

| Legacy path | Purpose | Proposed nested path |
| --- | --- | --- |
| `tasks_{schoolId}/{taskId}` | Tasks | `schools/{schoolId}/tasks/{taskId}` |
| `tasks_{schoolId}/{taskId}/chat/{messageId}` | Task chat | `schools/{schoolId}/tasks/{taskId}/chat/{messageId}` |
| `students_{schoolId}/{studentId}` | Sensitive student records | `schools/{schoolId}/students/{studentId}` |
| `files_{schoolId}/{fileId}` | Uploaded/in-app file metadata and rich document content | `schools/{schoolId}/files/{fileId}` |
| `file_history_{schoolId}/{entryId}` | File edit history | `schools/{schoolId}/fileHistory/{entryId}` |
| `folders_{schoolId}/{folderId}` | File folders and visibility fields | `schools/{schoolId}/folders/{folderId}` |
| `teams_{schoolId}/{teamId}` | Teams, members, and managers | `schools/{schoolId}/teams/{teamId}` |
| `events_{schoolId}/{eventId}` | Calendar events | `schools/{schoolId}/events/{eventId}` |
| `holidays_{schoolId}/{holidayId}` | Holidays/vacations | `schools/{schoolId}/holidays/{holidayId}` |
| `categories_{schoolId}/{categoryId}` | Calendar categories | `schools/{schoolId}/categories/{categoryId}` |
| `roles_{schoolId}/{roleId}` | Custom permission roles | `schools/{schoolId}/roles/{roleId}` |
| `tracks_{schoolId}/{trackId}` | Student learning tracks and requirements | `schools/{schoolId}/tracks/{trackId}` |
| `settings_{schoolId}/calendar` | Calendar visible-day settings | `schools/{schoolId}/settings/calendar` |
| `settings_{schoolId}/class_permissions` | Class/teacher/team access mapping | `schools/{schoolId}/settings/class_permissions` |
| `sheets_{schoolId}/{sheetId}` | Data-mapping spreadsheets and sharing lists | `schools/{schoolId}/sheets/{sheetId}` |
| `announcements_{schoolId}` | Legacy staff activity lookup only | Compatibility read only; canonical data is `announcements` |
| `messages_{schoolId}` | Legacy staff activity lookup only | Compatibility read only; canonical data is conversation messages |

`categories`, `sheets`, `file_history`, and task chat were not in the initial target list but are active application data and must be included in the nested model, Rules, tests, and migration.

## Storage inventory

| Current path | Current use | Finding | Target path |
| --- | --- | --- | --- |
| `schools/{schoolId}/{folderId}/{filename}` | General file uploads | Filename collision/overwrite is possible; no repository Rules, central validation, or explicit size restriction | `schools/{schoolId}/files/{fileId}/{filename}` |
| `chat_images/{conversationId}/{timestamp_filename}` | Chat images | Client only checks `image/*`; no size limit or server-confirmed conversation membership | `schools/{schoolId}/chat-images/{conversationId}/{filename}` |

No avatar upload path is currently used; avatars are predefined profile values. Rules should still reserve `users/{uid}/avatars/{filename}` for controlled future compatibility without enabling an application feature.

## Direct browser writes

The following security-sensitive operations currently happen in browser code:

- create Authentication users and Firestore profiles;
- update another user's email/password by signing in as that user;
- delete another user's Authentication account and Firestore profile;
- set system roles, custom roles, permissions, school membership, team membership, and principal assignments;
- approve or reject school membership requests;
- create/delete schools and broadcast holidays across every school;
- create/update/delete student records and class access mappings;
- manage tasks, task assignment, task chat, teams, files, folders, file history, spreadsheets, events, categories, tracks, and settings;
- create arbitrary notifications for another UID;
- create announcements and conversation metadata supplied by the client;
- delete conversations and all message documents from the browser;
- upload/delete school files and upload chat images.

Privileged identity, role, membership, notification, audit, cross-school broadcast, and destructive user operations must move to callable server functions. Ordinary school-resource writes may remain client initiated only when Firestore/Storage Rules enforce membership and granular permission checks independently of the UI.

## Current permission calculation

| Area | Current behavior | Security gap |
| --- | --- | --- |
| Authentication/routes | A Firebase Auth session unlocks most routes; pending users are blocked only by React routing | Missing/invalid user documents still receive fallback data; route guards are not backend authorization |
| Global administrator | Derived from Firestore `role`, previously also a shared password and hard-coded email | Client-controlled role document is trusted; no custom claim verification |
| Principal | Firestore `role === principal` grants full client permissions | Membership in the selected school is not consistently verified |
| Feature permissions | `usePermissions` combines viewer defaults, dynamic custom roles, and per-user overrides | Values are read from documents users/clients can currently modify; most screens only hide buttons |
| Navigation | Sidebar visibility and `NavPermissionsPanel` use per-user permission flags | Hidden navigation does not prevent direct reads/writes; bulk permission updates are client-side |
| Tasks | Viewers load all tasks, then UI-filters by assignment; editors use `tasks_edit` | Unauthorized task data reaches the client before filtering |
| Calendar | All school events/tasks/holidays are loaded, then team visibility is UI-filtered | Event/task audience checks are not enforced by Rules |
| Students | All students are loaded, then class permissions are UI-filtered | Sensitive records for other classes reach the client |
| Files | All file metadata is loaded; folder/resource visibility is UI-filtered | Metadata/content and Storage objects need independent Rules; per-file access is not server-enforced |
| Teams | Principal, `teams_edit`, or a listed manager can manage a team | Handlers directly update protected team/user fields |
| Messages | Conversation list query uses participant membership, but announcements are loaded globally then filtered | Participant/audience immutability and message deletion are not enforced by Rules |
| Notifications | Query filters by recipient UID | Creation is unrestricted client behavior; ownership still requires Rules |
| School selector | Global administrator and public registration can query all schools | Non-members can discover the school directory; selected school is client state |

## Operations that require server authority

- `createStaffUser`, `updateStaffUser`, `deleteStaffUser`, and password-reset invitation delivery;
- `setUserRole`, including all `global_admin` changes;
- `approveSchoolMembership` and `removeSchoolMembership`;
- principal assignment and protected user permission/custom-role/team changes;
- trusted notification fan-out and security-sensitive announcements;
- cross-school holiday broadcast and any other cross-tenant bulk operation;
- audit-log creation;
- first global-administrator custom-claim bootstrap;
- any future migration or password-field cleanup.

## Additional security findings

- Rich document HTML is restored with `innerHTML` and exported with `document.write` without sanitization, creating a stored-XSS risk.
- Many errors log Firebase error objects/messages or display internal messages to users.
- Meaningful timestamps are predominantly generated by the browser with local ISO strings instead of server timestamps.
- File uploads lack centralized MIME/extension/size validation and collision-resistant object IDs.
- Public self-registration exposes the school list and lets a registrant choose the requested institution.
- Default Firebase placeholder configuration allows the app to start with an unintended demo project configuration rather than failing closed.
- No App Check initialization, CSP, rate limiting, centralized input validation, audit log, backup/restore policy, access-revocation procedure, staging configuration, or secret-scanning workflow was present.

## Migration and compatibility constraints

- Existing dynamic collections must remain readable during a staged compatibility period.
- Migration must copy without deleting, preserve document IDs, default to dry-run, stop on ambiguous school IDs, and compare source/target counts.
- Nested paths become canonical for new writes only after staging verification and Rules coverage.
- Legacy collections should become read-only only after verified migration and an explicit production approval.

## Immediate implementation order

1. Remove the shared administrator path, email elevation, password fields, secondary Auth, and public self-registration.
2. Add callable Functions for privileged identity/membership operations and switch staff management to them.
3. Add centralized school repositories with legacy-read compatibility.
4. Add deny-by-default Firestore and Storage Rules before treating UI permission controls as authoritative.
5. Add Emulator tests for tenant isolation and privileged Functions.
6. Add dry-run migration/bootstrap tooling and operational documentation without running either tool.
7. Add App Check integration, CSP, error hardening, secret scanning, and CI checks.
