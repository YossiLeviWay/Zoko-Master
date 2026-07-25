# Platform Admin bootstrap and MFA

Platform Admin is a support identity, not a school-wide superuser. Its `platform_admin` custom claim is assigned only with Firebase Admin SDK. Firestore and Storage rules deliberately deny this identity access to students, grades, attendance, school files, tasks, calendars, conversations, personal files, CVs and individual outcome results.

## Before running anything

1. Use a dedicated Firebase Auth account with no shared password.
2. Enable a supported second factor for the account in Firebase Authentication and require the operator to enroll it.
3. Keep the service-account JSON outside this repository and point `GOOGLE_APPLICATION_CREDENTIALS` to it locally.
4. Test on staging first and obtain explicit production approval.

The command is dry-run by default:

```bash
node functions/scripts/bootstrap-platform-admin.js --uid EXPLICIT_UID --project STAGING_PROJECT_ID
```

After reviewing the target UID and project, an approved execution is:

```bash
node functions/scripts/bootstrap-platform-admin.js --uid EXPLICIT_UID --project STAGING_PROJECT_ID --execute --acknowledge-production-risk
```

The script preserves unrelated custom claims, records a platform audit entry and never reads or prints credentials. After assignment, revoke old refresh tokens and sign in again with MFA so the client receives a fresh ID token. Sensitive support actions also require a recent MFA authentication time (ten minutes).

## Deployment order

Deploy the Functions, Firestore rules, indexes and Storage rules to staging together. Run the emulator and staging acceptance tests before production. The client must not be published before the matching callable Functions and rules are available, because graduation, outcomes, forum access, support and Platform Admin actions are server-only.
